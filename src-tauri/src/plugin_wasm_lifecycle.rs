//! Core-private lifecycle coordinator for admitted executable-plugin Wasm.
//!
//! This is the only layer that composes compiler admission, app-owned bundle
//! storage, monotonic portfolio authority, and identity-bound sessions. It has
//! no Tauri command and accepts no arbitrary execution request from a package.

use std::{
    collections::{BTreeSet, HashMap},
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
};

use semver::Version;
use serde::Serialize;
use serde_json::Value;

use crate::{
    plugin_compute_policy::ISOLATED_COMPUTE_POLICY_V1,
    plugin_ui_protocol::{validate_plugin_ui_input_json, validate_plugin_ui_reduction_json},
    plugin_wasm_admission::{
        validate_admission_receipt, NativeWasmAdmission, WasmAdmissionError,
        WasmAdmissionErrorCode, WasmAdmissionReceipt,
    },
    plugin_wasm_data_plane::{
        validate_compute_request, validate_compute_result, WasmComputeRequest, WasmComputeResult,
        WasmDataPlaneError, WasmDataPlaneErrorCode, WasmDataPlaneGrants,
        PORTFOLIO_READ_SCOPED_CAPABILITY, PROPOSAL_CREATE_CAPABILITY,
    },
    plugin_wasm_session::{
        validate_wasm_plugin_identity, NemotoWasmSessionManager, WasmInvocationRequest,
        WasmInvocationResponse, WasmPluginIdentity, WasmSessionError, WasmSessionErrorCode,
        WasmSessionHandle, ISOLATED_COMPUTE_CAPABILITY,
    },
    plugin_wasm_storage::{
        load_current_wasm_bundle, remove_wasm_plugin_storage, rollback_wasm_bundle,
        store_wasm_bundle, validate_plugin_wasm_entrypoint, PluginWasmEntrypoint, WasmStorageError,
        WasmStorageErrorCode,
    },
};

pub const NEMOTO_WASM_INSTALL_CANDIDATE_SCHEMA: &str = "axiom.wasm-install-candidate";
pub const NEMOTO_WASM_INSTALL_CANDIDATE_SCHEMA_VERSION: u32 = 1;
pub const NEMOTO_WASM_LIFECYCLE_AUTHORITY_SCHEMA: &str = "axiom.wasm-lifecycle-authority";
pub const NEMOTO_WASM_LIFECYCLE_AUTHORITY_SCHEMA_VERSION: u32 = 1;

pub trait WasmAdmissionProvider: Send + Sync {
    fn admit(
        &self,
        identity: &WasmPluginIdentity,
        module_bytes: &[u8],
    ) -> Result<WasmAdmissionReceipt, WasmAdmissionError>;
}

impl WasmAdmissionProvider for NativeWasmAdmission {
    fn admit(
        &self,
        identity: &WasmPluginIdentity,
        module_bytes: &[u8],
    ) -> Result<WasmAdmissionReceipt, WasmAdmissionError> {
        NativeWasmAdmission::admit(self, identity, module_bytes)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WasmInstallCandidate {
    pub schema: String,
    pub schema_version: u32,
    pub identity: WasmPluginIdentity,
    pub capability: String,
    pub entrypoint: PluginWasmEntrypoint,
    pub module_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WasmLifecycleAuthority {
    pub schema: String,
    pub schema_version: u32,
    pub authority_scope_id: String,
    pub identity: WasmPluginIdentity,
    pub installed: bool,
    pub active: bool,
    pub compatible: bool,
    pub isolated_compute_granted: bool,
    pub portfolio_read_scoped_granted: bool,
    pub proposal_create_granted: bool,
    pub granted_capabilities: BTreeSet<String>,
}

impl WasmLifecycleAuthority {
    fn authorizes_compute(&self) -> bool {
        self.installed && self.active && self.compatible && self.isolated_compute_granted
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WasmInstallOutcome {
    pub identity: WasmPluginIdentity,
    pub module_sha256: String,
    pub reused_existing: bool,
    pub invalidated_sessions: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WasmAuthorityOutcome {
    pub authority_scope_id: String,
    pub identity: WasmPluginIdentity,
    pub authority_generation: u64,
    pub authorized: bool,
    pub invalidated_sessions: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WasmUninstallOutcome {
    pub plugin_id: String,
    pub removed_storage: bool,
    pub invalidated_sessions: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WasmLifecycleErrorCode {
    InvalidCandidate,
    InvalidAuthority,
    AdmissionFailed,
    StorageFailed,
    SessionFailed,
    UpdateRejected,
    IdentityContentConflict,
    InstalledIdentityMismatch,
    DataPlaneRejected,
    StateUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmLifecycleError {
    pub code: WasmLifecycleErrorCode,
    pub message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admission_code: Option<WasmAdmissionErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_code: Option<WasmStorageErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_code: Option<WasmSessionErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_plane_code: Option<WasmDataPlaneErrorCode>,
}

impl WasmLifecycleError {
    fn new(code: WasmLifecycleErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            admission_code: None,
            storage_code: None,
            session_code: None,
            data_plane_code: None,
        }
    }

    fn admission(error: WasmAdmissionError) -> Self {
        Self {
            code: WasmLifecycleErrorCode::AdmissionFailed,
            message: "The executable plugin did not pass native admission.",
            admission_code: Some(error.code),
            storage_code: None,
            session_code: None,
            data_plane_code: None,
        }
    }

    fn storage(error: WasmStorageError) -> Self {
        Self {
            code: WasmLifecycleErrorCode::StorageFailed,
            message: "The executable plugin bundle storage is unavailable or invalid.",
            admission_code: None,
            storage_code: Some(error.code),
            session_code: None,
            data_plane_code: None,
        }
    }

    fn session(error: WasmSessionError) -> Self {
        Self {
            code: WasmLifecycleErrorCode::SessionFailed,
            message: "The executable plugin session transition failed.",
            admission_code: None,
            storage_code: None,
            session_code: Some(error.code),
            data_plane_code: None,
        }
    }

    fn data_plane(error: WasmDataPlaneError) -> Self {
        Self {
            code: WasmLifecycleErrorCode::DataPlaneRejected,
            message: "The executable plugin data-plane transition was rejected.",
            admission_code: None,
            storage_code: None,
            session_code: None,
            data_plane_code: Some(error.code),
        }
    }
}

impl std::fmt::Display for WasmLifecycleError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for WasmLifecycleError {}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct LifecycleAuthorityKey {
    authority_scope_id: String,
    plugin_id: String,
}

#[derive(Debug, Clone)]
struct LifecycleAuthorityRecord {
    generation: u64,
    authority: Option<WasmLifecycleAuthority>,
}

#[derive(Default)]
struct LifecycleState {
    authorities: HashMap<LifecycleAuthorityKey, LifecycleAuthorityRecord>,
}

pub struct NemotoWasmLifecycle<A: WasmAdmissionProvider> {
    admission: A,
    storage_root: PathBuf,
    sessions: NemotoWasmSessionManager,
    state: Mutex<LifecycleState>,
}

impl NemotoWasmLifecycle<NativeWasmAdmission> {
    pub fn native(storage_root: PathBuf) -> Result<Self, WasmLifecycleError> {
        let admission = NativeWasmAdmission::new().map_err(WasmLifecycleError::admission)?;
        Self::with_admission(storage_root, admission)
    }
}

impl<A: WasmAdmissionProvider> NemotoWasmLifecycle<A> {
    pub fn with_admission(storage_root: PathBuf, admission: A) -> Result<Self, WasmLifecycleError> {
        Ok(Self {
            admission,
            storage_root,
            sessions: NemotoWasmSessionManager::new().map_err(WasmLifecycleError::session)?,
            state: Mutex::new(LifecycleState::default()),
        })
    }

    pub fn install(
        &self,
        candidate: WasmInstallCandidate,
    ) -> Result<WasmInstallOutcome, WasmLifecycleError> {
        validate_install_candidate(&candidate)?;
        let current = self.load_current_if_present(&candidate.identity.plugin_id)?;
        if let Some(current) = current {
            if current.receipt.identity == candidate.identity {
                if current.entrypoint == candidate.entrypoint
                    && current.module_bytes == candidate.module_bytes
                {
                    return Ok(WasmInstallOutcome {
                        identity: current.receipt.identity,
                        module_sha256: current.receipt.module_sha256,
                        reused_existing: true,
                        invalidated_sessions: 0,
                    });
                }
                return Err(WasmLifecycleError::new(
                    WasmLifecycleErrorCode::IdentityContentConflict,
                    "The installed plugin identity is already bound to different executable content.",
                ));
            }
            validate_forward_update(&current.receipt.identity, &candidate.identity)?;
        }

        let receipt = self
            .admission
            .admit(&candidate.identity, &candidate.module_bytes)
            .map_err(WasmLifecycleError::admission)?;
        validate_admission_receipt(&receipt, &candidate.identity, &candidate.module_bytes)
            .map_err(WasmLifecycleError::admission)?;

        let invalidated_sessions = self.revoke_plugin_authorities(&candidate.identity.plugin_id)?;
        store_wasm_bundle(
            &self.storage_root,
            &candidate.entrypoint,
            &receipt,
            &candidate.identity,
            &candidate.module_bytes,
        )
        .map_err(WasmLifecycleError::storage)?;

        Ok(WasmInstallOutcome {
            identity: candidate.identity,
            module_sha256: receipt.module_sha256,
            reused_existing: false,
            invalidated_sessions,
        })
    }

    pub fn synchronize_authority(
        &self,
        authority: WasmLifecycleAuthority,
    ) -> Result<WasmAuthorityOutcome, WasmLifecycleError> {
        validate_lifecycle_authority(&authority)?;
        if authority.installed {
            let current =
                load_current_wasm_bundle(&self.storage_root, &authority.identity.plugin_id)
                    .map_err(WasmLifecycleError::storage)?;
            if current.receipt.identity != authority.identity {
                return Err(WasmLifecycleError::new(
                    WasmLifecycleErrorCode::InstalledIdentityMismatch,
                    "The requested executable authority does not match the current installed bundle.",
                ));
            }
        }

        let key = LifecycleAuthorityKey {
            authority_scope_id: authority.authority_scope_id.clone(),
            plugin_id: authority.identity.plugin_id.clone(),
        };
        let mut state = self.lock_state()?;
        if let Some(current) = state.authorities.get(&key) {
            if current.authority.as_ref() == Some(&authority) {
                let authorized = authority.authorizes_compute();
                return Ok(WasmAuthorityOutcome {
                    authority_scope_id: authority.authority_scope_id,
                    identity: authority.identity,
                    authority_generation: current.generation,
                    authorized,
                    invalidated_sessions: 0,
                });
            }
        }
        let generation = next_generation(state.authorities.get(&key))?;
        let authorized = authority.authorizes_compute();
        let invalidated_sessions = if authorized {
            let mut granted_capabilities = authority.granted_capabilities.clone();
            granted_capabilities.insert(ISOLATED_COMPUTE_CAPABILITY.to_owned());
            if authority.portfolio_read_scoped_granted {
                granted_capabilities.insert(PORTFOLIO_READ_SCOPED_CAPABILITY.to_owned());
            }
            if authority.proposal_create_granted {
                granted_capabilities.insert(PROPOSAL_CREATE_CAPABILITY.to_owned());
            }
            self.sessions
                .synchronize_authority(crate::plugin_wasm_session::WasmAuthoritySnapshot {
                    authority_scope_id: authority.authority_scope_id.clone(),
                    authority_generation: generation,
                    identity: authority.identity.clone(),
                    installed: true,
                    active: true,
                    compatible: true,
                    granted_capabilities,
                })
                .map_err(WasmLifecycleError::session)?
        } else {
            self.sessions
                .revoke_authority(
                    &authority.authority_scope_id,
                    &authority.identity.plugin_id,
                    generation,
                )
                .map_err(WasmLifecycleError::session)?
        };
        state.authorities.insert(
            key,
            LifecycleAuthorityRecord {
                generation,
                authority: Some(authority.clone()),
            },
        );
        Ok(WasmAuthorityOutcome {
            authority_scope_id: authority.authority_scope_id,
            identity: authority.identity,
            authority_generation: generation,
            authorized,
            invalidated_sessions,
        })
    }

    pub fn open_session(
        &self,
        authority_scope_id: &str,
        identity: WasmPluginIdentity,
    ) -> Result<WasmSessionHandle, WasmLifecycleError> {
        validate_wasm_plugin_identity(&identity).map_err(|_| invalid_authority())?;
        let current = load_current_wasm_bundle(&self.storage_root, &identity.plugin_id)
            .map_err(WasmLifecycleError::storage)?;
        if current.receipt.identity != identity {
            return Err(WasmLifecycleError::new(
                WasmLifecycleErrorCode::InstalledIdentityMismatch,
                "The requested executable session does not match the current installed bundle.",
            ));
        }
        self.sessions
            .open_session(
                authority_scope_id,
                identity,
                Arc::from(current.module_bytes),
            )
            .map_err(WasmLifecycleError::session)
    }

    pub fn execute(
        &self,
        request: WasmInvocationRequest,
    ) -> Result<WasmInvocationResponse, WasmLifecycleError> {
        self.sessions
            .execute(request)
            .map_err(WasmLifecycleError::session)
    }

    /// Executes one Core-authored bounded request and validates the correlated
    /// result before it can reach the proposal-review boundary.
    pub fn execute_compute(
        &self,
        session: &WasmSessionHandle,
        sequence: u64,
        operation: impl Into<String>,
        request: WasmComputeRequest,
    ) -> Result<WasmComputeResult, WasmLifecycleError> {
        let grants = self.data_plane_grants_for_session(session)?;
        validate_compute_request(&request, grants).map_err(WasmLifecycleError::data_plane)?;
        let payload = serde_json::to_value(&request).map_err(|_| {
            WasmLifecycleError::data_plane(WasmDataPlaneError {
                code: WasmDataPlaneErrorCode::InvalidRequest,
                message: "The Core-authored executable compute request is invalid.",
            })
        })?;
        let response = self.execute(session.invocation(sequence, operation, payload))?;
        match validate_compute_result(response.result, &request, grants) {
            Ok(result) => Ok(result),
            Err(error) => {
                let _ = self.close_session(&session.session_id);
                Err(WasmLifecycleError::data_plane(error))
            }
        }
    }

    /// Executes one contribution-bound UI reduction. The guest receives only
    /// the fixed UI input document; native session identity and authority stay
    /// outside the guest-controlled wire value.
    pub fn execute_ui_reduction(
        &self,
        session: &WasmSessionHandle,
        operation: impl Into<String>,
        input: Value,
        declared_primitives: &[String],
        declared_effects: &[String],
    ) -> Result<Value, WasmLifecycleError> {
        #[cfg(feature = "runtime-security-harness")]
        let _timing = crate::commands::runtime_security_harness::TimingSpan::new("lifecycle.ui-reduction");
        let input_bytes = serde_json::to_vec(&input).map_err(|_| {
            WasmLifecycleError::new(
                WasmLifecycleErrorCode::DataPlaneRejected,
                "The Core-authored plugin UI input is invalid.",
            )
        })?;
        if validate_plugin_ui_input_json(&input_bytes).is_err() {
            return Err(WasmLifecycleError::new(
                WasmLifecycleErrorCode::DataPlaneRejected,
                "The Core-authored plugin UI input is invalid.",
            ));
        }
        let expected_input = input_bytes.clone();
        let primitives = declared_primitives.to_vec();
        let effects = declared_effects.to_vec();
        let response = self
            .sessions
            .execute_payload_json(session.invocation(1, operation, input), move |output| {
                validate_plugin_ui_reduction_json(&expected_input, output, &primitives, &effects)
                    .is_ok()
            })
            .map_err(WasmLifecycleError::session)?;
        Ok(response.result)
    }

    pub fn close_session(&self, session_id: &str) -> Result<bool, WasmLifecycleError> {
        self.sessions
            .close_session(session_id)
            .map_err(WasmLifecycleError::session)
    }

    fn data_plane_grants_for_session(
        &self,
        session: &WasmSessionHandle,
    ) -> Result<WasmDataPlaneGrants, WasmLifecycleError> {
        let key = LifecycleAuthorityKey {
            authority_scope_id: session.authority_scope_id.clone(),
            plugin_id: session.identity.plugin_id.clone(),
        };
        let state = self.lock_state()?;
        let authority = state
            .authorities
            .get(&key)
            .filter(|record| record.generation == session.authority_generation)
            .and_then(|record| record.authority.as_ref())
            .filter(|authority| authority.identity == session.identity)
            .filter(|authority| authority.authorizes_compute())
            .ok_or_else(invalid_authority)?;
        let mut capabilities = BTreeSet::new();
        if authority.portfolio_read_scoped_granted {
            capabilities.insert(PORTFOLIO_READ_SCOPED_CAPABILITY.to_owned());
        }
        if authority.proposal_create_granted {
            capabilities.insert(PROPOSAL_CREATE_CAPABILITY.to_owned());
        }
        Ok(WasmDataPlaneGrants::from_capabilities(&capabilities))
    }

    pub fn current_identity(
        &self,
        plugin_id: &str,
    ) -> Result<Option<WasmPluginIdentity>, WasmLifecycleError> {
        self.load_current_if_present(plugin_id)
            .map(|bundle| bundle.map(|value| value.receipt.identity))
    }

    /// Revokes every live authority and session for one installed plugin
    /// without changing its immutable runtime storage.
    pub fn revoke_plugin_authority(&self, plugin_id: &str) -> Result<usize, WasmLifecycleError> {
        self.revoke_plugin_authorities(plugin_id)
    }

    pub fn rollback(
        &self,
        expected_identity: &WasmPluginIdentity,
    ) -> Result<WasmInstallOutcome, WasmLifecycleError> {
        validate_wasm_plugin_identity(expected_identity).map_err(|_| invalid_candidate())?;
        let invalidated_sessions = self.revoke_plugin_authorities(&expected_identity.plugin_id)?;
        let bundle = rollback_wasm_bundle(&self.storage_root, expected_identity)
            .map_err(WasmLifecycleError::storage)?;
        Ok(WasmInstallOutcome {
            identity: bundle.receipt.identity,
            module_sha256: bundle.receipt.module_sha256,
            reused_existing: false,
            invalidated_sessions,
        })
    }

    pub fn uninstall(&self, plugin_id: &str) -> Result<WasmUninstallOutcome, WasmLifecycleError> {
        let invalidated_sessions = self.revoke_plugin_authorities(plugin_id)?;
        let removed_storage = remove_wasm_plugin_storage(&self.storage_root, plugin_id)
            .map_err(WasmLifecycleError::storage)?;
        Ok(WasmUninstallOutcome {
            plugin_id: plugin_id.to_owned(),
            removed_storage,
            invalidated_sessions,
        })
    }

    fn load_current_if_present(
        &self,
        plugin_id: &str,
    ) -> Result<Option<crate::plugin_wasm_storage::StoredWasmBundle>, WasmLifecycleError> {
        let plugin_directory = self.storage_root.join(plugin_id);
        if !plugin_directory.exists() {
            return Ok(None);
        }
        load_current_wasm_bundle(&self.storage_root, plugin_id)
            .map(Some)
            .map_err(WasmLifecycleError::storage)
    }

    fn revoke_plugin_authorities(&self, plugin_id: &str) -> Result<usize, WasmLifecycleError> {
        let mut state = self.lock_state()?;
        let keys = state
            .authorities
            .keys()
            .filter(|key| key.plugin_id == plugin_id)
            .cloned()
            .collect::<Vec<_>>();
        let mut invalidated_sessions = 0;
        for key in keys {
            let generation = next_generation(state.authorities.get(&key))?;
            invalidated_sessions += self
                .sessions
                .revoke_authority(&key.authority_scope_id, &key.plugin_id, generation)
                .map_err(WasmLifecycleError::session)?;
            state.authorities.insert(
                key,
                LifecycleAuthorityRecord {
                    generation,
                    authority: None,
                },
            );
        }
        Ok(invalidated_sessions)
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, LifecycleState>, WasmLifecycleError> {
        self.state.lock().map_err(|_| {
            WasmLifecycleError::new(
                WasmLifecycleErrorCode::StateUnavailable,
                "The executable plugin lifecycle state is unavailable.",
            )
        })
    }
}

fn validate_install_candidate(candidate: &WasmInstallCandidate) -> Result<(), WasmLifecycleError> {
    if candidate.schema != NEMOTO_WASM_INSTALL_CANDIDATE_SCHEMA
        || candidate.schema_version != NEMOTO_WASM_INSTALL_CANDIDATE_SCHEMA_VERSION
        || candidate.capability != ISOLATED_COMPUTE_CAPABILITY
        || candidate.module_bytes.is_empty()
        || candidate.module_bytes.len() > ISOLATED_COMPUTE_POLICY_V1.max_module_bytes
        || validate_wasm_plugin_identity(&candidate.identity).is_err()
        || validate_plugin_wasm_entrypoint(&candidate.entrypoint).is_err()
    {
        return Err(invalid_candidate());
    }
    Ok(())
}

fn validate_lifecycle_authority(
    authority: &WasmLifecycleAuthority,
) -> Result<(), WasmLifecycleError> {
    if authority.schema != NEMOTO_WASM_LIFECYCLE_AUTHORITY_SCHEMA
        || authority.schema_version != NEMOTO_WASM_LIFECYCLE_AUTHORITY_SCHEMA_VERSION
        || validate_wasm_plugin_identity(&authority.identity).is_err()
        || (!authority.installed
            && (authority.active
                || authority.compatible
                || authority.isolated_compute_granted
                || authority.portfolio_read_scoped_granted
                || authority.proposal_create_granted))
    {
        return Err(invalid_authority());
    }
    Ok(())
}

fn validate_forward_update(
    current: &WasmPluginIdentity,
    candidate: &WasmPluginIdentity,
) -> Result<(), WasmLifecycleError> {
    let current_version =
        Version::parse(&current.plugin_version).map_err(|_| invalid_candidate())?;
    let candidate_version =
        Version::parse(&candidate.plugin_version).map_err(|_| invalid_candidate())?;
    if current.plugin_id != candidate.plugin_id
        || candidate_version <= current_version
        || candidate.data_version < current.data_version
    {
        return Err(WasmLifecycleError::new(
            WasmLifecycleErrorCode::UpdateRejected,
            "Executable plugin updates must move forward in version without lowering the data version.",
        ));
    }
    Ok(())
}

fn next_generation(current: Option<&LifecycleAuthorityRecord>) -> Result<u64, WasmLifecycleError> {
    current
        .map_or(Some(1), |record| record.generation.checked_add(1))
        .ok_or_else(|| {
            WasmLifecycleError::new(
                WasmLifecycleErrorCode::StateUnavailable,
                "The executable plugin authority generation is exhausted.",
            )
        })
}

fn invalid_candidate() -> WasmLifecycleError {
    WasmLifecycleError::new(
        WasmLifecycleErrorCode::InvalidCandidate,
        "The executable plugin install candidate is invalid.",
    )
}

fn invalid_authority() -> WasmLifecycleError {
    WasmLifecycleError::new(
        WasmLifecycleErrorCode::InvalidAuthority,
        "The executable plugin lifecycle authority is invalid.",
    )
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::{
        plugin_wasm_admission::{
            module_sha256, NEMOTO_WASM_ADMISSION_SCHEMA, NEMOTO_WASM_ADMISSION_SCHEMA_VERSION,
            WASM_COMPILER_CPU_TIME_LIMIT_MS, WASM_COMPILER_MEMORY_LIMIT_BYTES,
            WASM_COMPILER_WALL_DEADLINE_MS,
        },
        plugin_wasm_host::{NEMOTO_WASM_ABI_NAME, NEMOTO_WASM_ABI_VERSION, WASMTIME_ENGINE_VERSION},
        plugin_wasm_storage::{
            NEMOTO_PLUGIN_WASM_RUNTIME_SCHEMA, NEMOTO_PLUGIN_WASM_RUNTIME_SCHEMA_VERSION,
        },
    };

    const SCOPE_ID: &str = "portfolio:lifecycle-test";
    const PLUGIN_ID: &str = "org.axiom.lifecycle-fixture";

    #[derive(Default)]
    struct FakeAdmission {
        calls: AtomicUsize,
    }

    impl WasmAdmissionProvider for FakeAdmission {
        fn admit(
            &self,
            identity: &WasmPluginIdentity,
            module_bytes: &[u8],
        ) -> Result<WasmAdmissionReceipt, WasmAdmissionError> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            if module_bytes == b"reject" {
                return Err(WasmAdmissionError::new(
                    WasmAdmissionErrorCode::CompilationRejected,
                    "The WebAssembly module did not pass native admission.",
                ));
            }
            Ok(test_receipt(identity, module_bytes))
        }
    }

    fn identity(version: &str, data_version: u32) -> WasmPluginIdentity {
        WasmPluginIdentity {
            plugin_id: PLUGIN_ID.to_owned(),
            plugin_version: version.to_owned(),
            data_version,
        }
    }

    fn entrypoint() -> PluginWasmEntrypoint {
        PluginWasmEntrypoint {
            schema: NEMOTO_PLUGIN_WASM_RUNTIME_SCHEMA.to_owned(),
            schema_version: NEMOTO_PLUGIN_WASM_RUNTIME_SCHEMA_VERSION,
            abi: NEMOTO_WASM_ABI_NAME.to_owned(),
            module: "runtime/plugin.wasm".to_owned(),
        }
    }

    fn candidate(identity: WasmPluginIdentity, module_bytes: Vec<u8>) -> WasmInstallCandidate {
        WasmInstallCandidate {
            schema: NEMOTO_WASM_INSTALL_CANDIDATE_SCHEMA.to_owned(),
            schema_version: NEMOTO_WASM_INSTALL_CANDIDATE_SCHEMA_VERSION,
            identity,
            capability: ISOLATED_COMPUTE_CAPABILITY.to_owned(),
            entrypoint: entrypoint(),
            module_bytes,
        }
    }

    fn authority(identity: WasmPluginIdentity) -> WasmLifecycleAuthority {
        WasmLifecycleAuthority {
            schema: NEMOTO_WASM_LIFECYCLE_AUTHORITY_SCHEMA.to_owned(),
            schema_version: NEMOTO_WASM_LIFECYCLE_AUTHORITY_SCHEMA_VERSION,
            authority_scope_id: SCOPE_ID.to_owned(),
            identity,
            installed: true,
            active: true,
            compatible: true,
            isolated_compute_granted: true,
            portfolio_read_scoped_granted: false,
            proposal_create_granted: false,
            granted_capabilities: BTreeSet::from([ISOLATED_COMPUTE_CAPABILITY.to_owned()]),
        }
    }

    fn echo_module() -> Vec<u8> {
        wat::parse_str(
            r#"(module
                (memory (export "memory") 1 1024)
                (global $heap (mut i32) (i32.const 1024))
                (func (export "axiom_abi_version") (result i32) i32.const 1)
                (func (export "axiom_alloc") (param $len i32) (result i32)
                    global.get $heap
                    global.get $heap
                    local.get $len
                    i32.add
                    global.set $heap)
                (func (export "axiom_run") (param $ptr i32) (param $len i32) (result i64)
                    local.get $ptr
                    i64.extend_i32_u
                    i64.const 32
                    i64.shl
                    local.get $len
                    i64.extend_i32_u
                    i64.or))"#,
        )
        .unwrap()
    }

    fn test_receipt(identity: &WasmPluginIdentity, module_bytes: &[u8]) -> WasmAdmissionReceipt {
        WasmAdmissionReceipt {
            schema: NEMOTO_WASM_ADMISSION_SCHEMA.to_owned(),
            schema_version: NEMOTO_WASM_ADMISSION_SCHEMA_VERSION,
            identity: identity.clone(),
            module_sha256: module_sha256(module_bytes),
            module_bytes: module_bytes.len() as u64,
            compiled_artifact_bytes: 4096,
            abi_name: NEMOTO_WASM_ABI_NAME.to_owned(),
            abi_version: NEMOTO_WASM_ABI_VERSION,
            compute_policy_version: ISOLATED_COMPUTE_POLICY_V1.policy_version,
            engine: "wasmtime".to_owned(),
            engine_version: WASMTIME_ENGINE_VERSION.to_owned(),
            helper_memory_limit_bytes: WASM_COMPILER_MEMORY_LIMIT_BYTES as u64,
            helper_cpu_time_limit_ms: WASM_COMPILER_CPU_TIME_LIMIT_MS,
            helper_wall_deadline_ms: WASM_COMPILER_WALL_DEADLINE_MS,
        }
    }

    #[test]
    fn install_authorize_execute_update_rollback_and_uninstall_are_one_revoking_chain() {
        let directory = tempfile::tempdir().unwrap();
        let lifecycle = NemotoWasmLifecycle::with_admission(
            directory.path().to_path_buf(),
            FakeAdmission::default(),
        )
        .unwrap();
        let first_identity = identity("1.0.0", 1);
        let second_identity = identity("1.1.0", 2);
        let module = echo_module();

        lifecycle
            .install(candidate(first_identity.clone(), module.clone()))
            .unwrap();
        let first_authority = lifecycle
            .synchronize_authority(authority(first_identity.clone()))
            .unwrap();
        assert_eq!(first_authority.authority_generation, 1);
        let first_session = lifecycle
            .open_session(SCOPE_ID, first_identity.clone())
            .unwrap();
        let response = lifecycle
            .execute(first_session.invocation(
                1,
                "analysis.echo",
                serde_json::json!({ "value": 42 }),
            ))
            .unwrap();
        assert_eq!(response.result["payload"]["value"], 42);

        let update = lifecycle
            .install(candidate(second_identity.clone(), module.clone()))
            .unwrap();
        assert_eq!(update.invalidated_sessions, 1);
        assert_eq!(
            lifecycle
                .execute(first_session.invocation(2, "analysis.echo", serde_json::json!({})))
                .unwrap_err()
                .session_code,
            Some(WasmSessionErrorCode::UnknownSession)
        );
        let second_authority = lifecycle
            .synchronize_authority(authority(second_identity.clone()))
            .unwrap();
        assert!(second_authority.authority_generation > first_authority.authority_generation);
        let second_session = lifecycle
            .open_session(SCOPE_ID, second_identity.clone())
            .unwrap();

        let rollback = lifecycle.rollback(&first_identity).unwrap();
        assert_eq!(rollback.invalidated_sessions, 1);
        assert_eq!(
            lifecycle
                .execute(second_session.invocation(1, "analysis.echo", serde_json::json!({})))
                .unwrap_err()
                .session_code,
            Some(WasmSessionErrorCode::UnknownSession)
        );
        lifecycle
            .synchronize_authority(authority(first_identity.clone()))
            .unwrap();
        let rolled_back_session = lifecycle.open_session(SCOPE_ID, first_identity).unwrap();

        let uninstall = lifecycle.uninstall(PLUGIN_ID).unwrap();
        assert!(uninstall.removed_storage);
        assert_eq!(uninstall.invalidated_sessions, 1);
        assert_eq!(
            lifecycle
                .execute(rolled_back_session.invocation(1, "analysis.echo", serde_json::json!({}),))
                .unwrap_err()
                .session_code,
            Some(WasmSessionErrorCode::UnknownSession)
        );
    }

    #[test]
    fn admission_failure_and_invalid_updates_preserve_the_current_authorized_session() {
        let directory = tempfile::tempdir().unwrap();
        let lifecycle = NemotoWasmLifecycle::with_admission(
            directory.path().to_path_buf(),
            FakeAdmission::default(),
        )
        .unwrap();
        let first_identity = identity("1.0.0", 1);
        let module = echo_module();
        lifecycle
            .install(candidate(first_identity.clone(), module.clone()))
            .unwrap();
        lifecycle
            .synchronize_authority(authority(first_identity.clone()))
            .unwrap();
        let session = lifecycle
            .open_session(SCOPE_ID, first_identity.clone())
            .unwrap();

        let rejected = lifecycle
            .install(candidate(identity("1.1.0", 1), b"reject".to_vec()))
            .unwrap_err();
        assert_eq!(rejected.code, WasmLifecycleErrorCode::AdmissionFailed);
        let conflict = lifecycle
            .install(candidate(first_identity.clone(), b"different".to_vec()))
            .unwrap_err();
        assert_eq!(
            conflict.code,
            WasmLifecycleErrorCode::IdentityContentConflict
        );
        let downgrade = lifecycle
            .install(candidate(identity("0.9.0", 1), module))
            .unwrap_err();
        assert_eq!(downgrade.code, WasmLifecycleErrorCode::UpdateRejected);

        let response = lifecycle
            .execute(session.invocation(
                1,
                "analysis.echo",
                serde_json::json!({ "still": "authorized" }),
            ))
            .unwrap();
        assert_eq!(response.result["payload"]["still"], "authorized");
    }

    #[test]
    fn backup_identity_requires_explicit_rollback_before_authorization() {
        let directory = tempfile::tempdir().unwrap();
        let lifecycle = NemotoWasmLifecycle::with_admission(
            directory.path().to_path_buf(),
            FakeAdmission::default(),
        )
        .unwrap();
        let first_identity = identity("1.0.0", 1);
        let second_identity = identity("1.1.0", 1);
        let module = echo_module();
        lifecycle
            .install(candidate(first_identity.clone(), module.clone()))
            .unwrap();
        lifecycle
            .install(candidate(second_identity, module))
            .unwrap();

        assert_eq!(
            lifecycle
                .synchronize_authority(authority(first_identity.clone()))
                .unwrap_err()
                .code,
            WasmLifecycleErrorCode::InstalledIdentityMismatch
        );
        lifecycle.rollback(&first_identity).unwrap();
        assert!(
            lifecycle
                .synchronize_authority(authority(first_identity))
                .unwrap()
                .authorized
        );
    }

    #[test]
    fn lifecycle_owns_idempotent_monotonic_authority_and_revokes_on_disable() {
        let directory = tempfile::tempdir().unwrap();
        let lifecycle = NemotoWasmLifecycle::with_admission(
            directory.path().to_path_buf(),
            FakeAdmission::default(),
        )
        .unwrap();
        let plugin_identity = identity("1.0.0", 1);
        lifecycle
            .install(candidate(plugin_identity.clone(), echo_module()))
            .unwrap();
        let enabled = authority(plugin_identity.clone());
        let first = lifecycle.synchronize_authority(enabled.clone()).unwrap();
        let repeated = lifecycle.synchronize_authority(enabled.clone()).unwrap();
        assert_eq!(repeated.authority_generation, first.authority_generation);
        assert_eq!(repeated.invalidated_sessions, 0);
        let session = lifecycle
            .open_session(SCOPE_ID, plugin_identity.clone())
            .unwrap();

        let mut disabled = enabled;
        disabled.active = false;
        let revoked = lifecycle.synchronize_authority(disabled).unwrap();
        assert!(revoked.authority_generation > first.authority_generation);
        assert!(!revoked.authorized);
        assert_eq!(revoked.invalidated_sessions, 1);
        assert_eq!(
            lifecycle
                .execute(session.invocation(1, "analysis.echo", serde_json::json!({})))
                .unwrap_err()
                .session_code,
            Some(WasmSessionErrorCode::UnknownSession)
        );
        assert_eq!(
            lifecycle
                .open_session(SCOPE_ID, plugin_identity)
                .unwrap_err()
                .session_code,
            Some(WasmSessionErrorCode::AuthorityDenied)
        );
    }

    #[test]
    fn invalid_compute_results_close_the_bound_session() {
        let directory = tempfile::tempdir().unwrap();
        let lifecycle = NemotoWasmLifecycle::with_admission(
            directory.path().to_path_buf(),
            FakeAdmission::default(),
        )
        .unwrap();
        let plugin_identity = identity("1.0.0", 1);
        lifecycle
            .install(candidate(plugin_identity.clone(), echo_module()))
            .unwrap();
        lifecycle
            .synchronize_authority(authority(plugin_identity.clone()))
            .unwrap();
        let session = lifecycle.open_session(SCOPE_ID, plugin_identity).unwrap();
        let error = lifecycle
            .execute_compute(
                &session,
                1,
                "analysis.echo",
                WasmComputeRequest {
                    schema: crate::plugin_wasm_data_plane::NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA
                        .to_owned(),
                    schema_version:
                        crate::plugin_wasm_data_plane::NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA_VERSION,
                    request_id: "compute:invalid-result:1".to_owned(),
                    base_revision: "portfolio-revision-aabbccdd".to_owned(),
                    portfolio_revision: 1,
                    snapshots: Vec::new(),
                    parameters: serde_json::json!({ "value": 42 }),
                },
            )
            .unwrap_err();
        assert_eq!(error.code, WasmLifecycleErrorCode::DataPlaneRejected);
        assert_eq!(
            error.data_plane_code,
            Some(WasmDataPlaneErrorCode::InvalidResult)
        );
        assert_eq!(
            lifecycle
                .execute(session.invocation(2, "analysis.echo", serde_json::json!({})))
                .unwrap_err()
                .session_code,
            Some(WasmSessionErrorCode::UnknownSession)
        );
    }
}
