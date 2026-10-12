//! Core-owned identity and live-authority sessions for native plugin compute.
//!
//! This layer deliberately has no Tauri command. Trusted Core code supplies
//! already-validated installed-package and portfolio activation state. The
//! session manager binds that authority to one immutable module and rechecks it
//! immediately before dispatch and again before releasing a guest result.

use std::{
    collections::{BTreeSet, HashMap},
    fmt,
    sync::{Arc, Mutex, MutexGuard},
};

use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    plugin_compute_policy::ISOLATED_COMPUTE_POLICY_V1,
    plugin_wasm_host::{NemotoWasmHost, WasmHostError, WasmHostErrorCode},
};

pub const NEMOTO_WASM_INVOCATION_SCHEMA: &str = "axiom.wasm-invocation";
pub const NEMOTO_WASM_INVOCATION_SCHEMA_VERSION: u32 = 1;
pub const ISOLATED_COMPUTE_CAPABILITY: &str = "compute.isolated";
pub const MAX_NATIVE_WASM_SESSIONS: usize = 64;
pub const MAX_NATIVE_WASM_SESSION_MODULE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmPluginIdentity {
    pub plugin_id: String,
    pub plugin_version: String,
    pub data_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmAuthoritySnapshot {
    pub authority_scope_id: String,
    pub authority_generation: u64,
    pub identity: WasmPluginIdentity,
    pub installed: bool,
    pub active: bool,
    pub compatible: bool,
    pub granted_capabilities: BTreeSet<String>,
}

impl WasmAuthoritySnapshot {
    fn authorizes_isolated_compute(&self) -> bool {
        self.installed
            && self.active
            && self.compatible
            && self
                .granted_capabilities
                .contains(ISOLATED_COMPUTE_CAPABILITY)
    }

    fn key(&self) -> AuthorityKey {
        AuthorityKey {
            authority_scope_id: self.authority_scope_id.clone(),
            plugin_id: self.identity.plugin_id.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSessionHandle {
    pub session_id: String,
    pub authority_scope_id: String,
    pub authority_generation: u64,
    pub capability: String,
    pub identity: WasmPluginIdentity,
    pub first_sequence: u64,
}

impl WasmSessionHandle {
    pub fn invocation(
        &self,
        sequence: u64,
        operation: impl Into<String>,
        payload: Value,
    ) -> WasmInvocationRequest {
        WasmInvocationRequest {
            schema: NEMOTO_WASM_INVOCATION_SCHEMA.to_owned(),
            schema_version: NEMOTO_WASM_INVOCATION_SCHEMA_VERSION,
            session_id: self.session_id.clone(),
            sequence,
            authority_scope_id: self.authority_scope_id.clone(),
            authority_generation: self.authority_generation,
            capability: self.capability.clone(),
            identity: self.identity.clone(),
            operation: operation.into(),
            payload,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmInvocationRequest {
    pub schema: String,
    pub schema_version: u32,
    pub session_id: String,
    pub authority_scope_id: String,
    pub authority_generation: u64,
    pub capability: String,
    pub identity: WasmPluginIdentity,
    pub sequence: u64,
    pub operation: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmInvocationResponse {
    pub session_id: String,
    pub authority_scope_id: String,
    pub authority_generation: u64,
    pub capability: String,
    pub identity: WasmPluginIdentity,
    pub sequence: u64,
    pub result: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WasmSessionErrorCode {
    InvalidAuthority,
    StaleAuthorityGeneration,
    AuthorityDenied,
    SessionCapacityReached,
    UnknownSession,
    SessionRevoked,
    IdentityMismatch,
    SequenceMismatch,
    SessionBusy,
    InvalidInvocation,
    SessionUnavailable,
    HostExecutionFailed,
    InvalidGuestOutput,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmSessionError {
    pub code: WasmSessionErrorCode,
    pub message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_code: Option<WasmHostErrorCode>,
}

impl WasmSessionError {
    fn new(code: WasmSessionErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            host_code: None,
        }
    }

    fn host(error: WasmHostError) -> Self {
        Self {
            code: WasmSessionErrorCode::HostExecutionFailed,
            message: "The isolated plugin execution failed.",
            host_code: Some(error.code),
        }
    }
}

impl fmt::Display for WasmSessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for WasmSessionError {}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct AuthorityKey {
    authority_scope_id: String,
    plugin_id: String,
}

#[derive(Debug, Clone)]
struct AuthorityRecord {
    generation: u64,
    snapshot: Option<WasmAuthoritySnapshot>,
}

#[derive(Clone)]
struct SessionRecord {
    key: AuthorityKey,
    identity: WasmPluginIdentity,
    authority_generation: u64,
    module: Arc<[u8]>,
    next_sequence: u64,
    in_flight: bool,
}

#[derive(Default)]
struct SessionState {
    authorities: HashMap<AuthorityKey, AuthorityRecord>,
    sessions: HashMap<String, SessionRecord>,
}

struct Dispatch {
    module: Arc<[u8]>,
}

/// Owns native compute sessions and their live authority state.
///
/// Callers must synchronize this registry from trusted installed-package,
/// portfolio activation, compatibility, and grant state. A generation is
/// monotonic per `(authority_scope_id, plugin_id)` and must change whenever any
/// of those inputs changes.
pub struct NemotoWasmSessionManager {
    host: NemotoWasmHost,
    state: Mutex<SessionState>,
}

impl NemotoWasmSessionManager {
    pub fn new() -> Result<Self, WasmSessionError> {
        Ok(Self {
            host: NemotoWasmHost::new().map_err(WasmSessionError::host)?,
            state: Mutex::new(SessionState::default()),
        })
    }

    /// Installs a complete authoritative snapshot. Equal generations are only
    /// accepted when the snapshot is byte-for-byte idempotent. Every advancing
    /// generation invalidates existing sessions for the same scope and plugin.
    pub fn synchronize_authority(
        &self,
        snapshot: WasmAuthoritySnapshot,
    ) -> Result<usize, WasmSessionError> {
        validate_authority_snapshot(&snapshot)?;
        let key = snapshot.key();
        let mut state = self.lock_state()?;

        if let Some(current) = state.authorities.get(&key) {
            if snapshot.authority_generation < current.generation
                || (snapshot.authority_generation == current.generation
                    && current.snapshot.as_ref() != Some(&snapshot))
            {
                return Err(stale_authority());
            }
            if snapshot.authority_generation == current.generation {
                return Ok(0);
            }
        }

        let generation = snapshot.authority_generation;
        state.authorities.insert(
            key.clone(),
            AuthorityRecord {
                generation,
                snapshot: Some(snapshot),
            },
        );
        Ok(invalidate_sessions_for_key(&mut state, &key))
    }

    /// Records uninstall/disable-style revocation without retaining a stale
    /// authorized snapshot. The generation cannot be rolled back.
    pub fn revoke_authority(
        &self,
        authority_scope_id: &str,
        plugin_id: &str,
        authority_generation: u64,
    ) -> Result<usize, WasmSessionError> {
        validate_stable_contract_id(authority_scope_id)?;
        validate_plugin_id(plugin_id)?;
        if authority_generation == 0 {
            return Err(invalid_authority());
        }

        let key = AuthorityKey {
            authority_scope_id: authority_scope_id.to_owned(),
            plugin_id: plugin_id.to_owned(),
        };
        let mut state = self.lock_state()?;
        if let Some(current) = state.authorities.get(&key) {
            if authority_generation < current.generation
                || (authority_generation == current.generation && current.snapshot.is_some())
            {
                return Err(stale_authority());
            }
            if authority_generation == current.generation {
                return Ok(0);
            }
        }

        state.authorities.insert(
            key.clone(),
            AuthorityRecord {
                generation: authority_generation,
                snapshot: None,
            },
        );
        Ok(invalidate_sessions_for_key(&mut state, &key))
    }

    /// Opens a session for the exact current authority identity and permanently
    /// binds it to the supplied immutable module bytes.
    pub fn open_session(
        &self,
        authority_scope_id: &str,
        identity: WasmPluginIdentity,
        module: Arc<[u8]>,
    ) -> Result<WasmSessionHandle, WasmSessionError> {
        validate_stable_contract_id(authority_scope_id)?;
        validate_wasm_plugin_identity(&identity)?;
        if module.is_empty() || module.len() > ISOLATED_COMPUTE_POLICY_V1.max_module_bytes {
            return Err(WasmSessionError::new(
                WasmSessionErrorCode::InvalidInvocation,
                "The bound plugin module is empty or exceeds the allowed size.",
            ));
        }

        let key = AuthorityKey {
            authority_scope_id: authority_scope_id.to_owned(),
            plugin_id: identity.plugin_id.clone(),
        };
        let mut state = self.lock_state()?;
        let snapshot = state
            .authorities
            .get(&key)
            .and_then(|record| record.snapshot.as_ref())
            .filter(|snapshot| snapshot.authorizes_isolated_compute())
            .filter(|snapshot| snapshot.identity == identity)
            .cloned()
            .ok_or_else(authority_denied)?;

        if state.sessions.len() >= MAX_NATIVE_WASM_SESSIONS {
            return Err(WasmSessionError::new(
                WasmSessionErrorCode::SessionCapacityReached,
                "The native plugin session capacity has been reached.",
            ));
        }
        let retained_module_bytes = state
            .sessions
            .values()
            .try_fold(0_usize, |total, session| {
                total.checked_add(session.module.len())
            })
            .and_then(|total| total.checked_add(module.len()))
            .ok_or_else(session_capacity_reached)?;
        if retained_module_bytes > MAX_NATIVE_WASM_SESSION_MODULE_BYTES {
            return Err(session_capacity_reached());
        }

        let session_id = loop {
            let candidate = format!("wasm-session:{}", Uuid::new_v4().simple());
            if !state.sessions.contains_key(&candidate) {
                break candidate;
            }
        };
        let handle = WasmSessionHandle {
            session_id: session_id.clone(),
            authority_scope_id: authority_scope_id.to_owned(),
            authority_generation: snapshot.authority_generation,
            capability: ISOLATED_COMPUTE_CAPABILITY.to_owned(),
            identity: identity.clone(),
            first_sequence: 1,
        };
        state.sessions.insert(
            session_id,
            SessionRecord {
                key,
                identity,
                authority_generation: snapshot.authority_generation,
                module,
                next_sequence: 1,
                in_flight: false,
            },
        );
        Ok(handle)
    }

    pub fn close_session(&self, session_id: &str) -> Result<bool, WasmSessionError> {
        Ok(self.lock_state()?.sessions.remove(session_id).is_some())
    }

    pub fn execute(
        &self,
        request: WasmInvocationRequest,
    ) -> Result<WasmInvocationResponse, WasmSessionError> {
        self.validate_before_encoding(&request)?;
        let encoded_request = serde_json::to_vec(&request).map_err(|_| {
            WasmSessionError::new(
                WasmSessionErrorCode::InvalidInvocation,
                "The plugin invocation could not be encoded as JSON.",
            )
        })?;
        self.execute_encoded_with_post_dispatch_hook(request, encoded_request, |_| true, || {})
    }

    /// Executes an operation-bound session while exposing only its payload to
    /// the guest. The operation, identity, grants, session and authority
    /// generation remain native-owned correlation data.
    pub fn execute_payload_json<F>(
        &self,
        request: WasmInvocationRequest,
        validate_output: F,
    ) -> Result<WasmInvocationResponse, WasmSessionError>
    where
        F: FnOnce(&[u8]) -> bool,
    {
        self.validate_before_encoding(&request)?;
        let encoded_payload = serde_json::to_vec(&request.payload).map_err(|_| {
            WasmSessionError::new(
                WasmSessionErrorCode::InvalidInvocation,
                "The plugin payload could not be encoded as JSON.",
            )
        })?;
        self.execute_encoded_with_post_dispatch_hook(
            request,
            encoded_payload,
            validate_output,
            || {},
        )
    }

    fn execute_encoded_with_post_dispatch_hook<F, H>(
        &self,
        request: WasmInvocationRequest,
        encoded_request: Vec<u8>,
        validate_output: F,
        post_dispatch_hook: H,
    ) -> Result<WasmInvocationResponse, WasmSessionError>
    where
        F: FnOnce(&[u8]) -> bool,
        H: FnOnce(),
    {
        if let Err(error) = validate_invocation(&request) {
            if let Ok(mut state) = self.state.lock() {
                state.sessions.remove(&request.session_id);
            }
            return Err(error);
        }
        let dispatch = self.authorize_dispatch(&request)?;
        let execution = if request.payload["schema"] == "axiom.plugin-ui-input" {
            self.host
                .execute_ui_json(&dispatch.module, &encoded_request)
        } else {
            self.host.execute_json(&dispatch.module, &encoded_request)
        };
        post_dispatch_hook();

        let mut state = self.lock_state()?;
        let still_authorized = state
            .sessions
            .get(&request.session_id)
            .is_some_and(|session| session_matches_request(session, &request))
            && state
                .sessions
                .get(&request.session_id)
                .is_some_and(|session| session_is_live(&state, session));
        if !still_authorized {
            state.sessions.remove(&request.session_id);
            return Err(session_revoked());
        }

        let output = match execution {
            Ok(output) => output,
            Err(error) => {
                state.sessions.remove(&request.session_id);
                return Err(WasmSessionError::host(error));
            }
        };
        if !validate_output(&output) {
            state.sessions.remove(&request.session_id);
            return Err(WasmSessionError::new(
                WasmSessionErrorCode::InvalidGuestOutput,
                "The plugin returned an invalid operation result.",
            ));
        }
        if let Some(session) = state.sessions.get_mut(&request.session_id) {
            session.in_flight = false;
        }
        drop(state);

        let result = serde_json::from_slice(&output).map_err(|_| {
            WasmSessionError::new(
                WasmSessionErrorCode::InvalidGuestOutput,
                "The plugin returned an invalid JSON result.",
            )
        })?;
        Ok(WasmInvocationResponse {
            session_id: request.session_id,
            authority_scope_id: request.authority_scope_id,
            authority_generation: request.authority_generation,
            capability: request.capability,
            identity: request.identity,
            sequence: request.sequence,
            result,
        })
    }

    fn authorize_dispatch(
        &self,
        request: &WasmInvocationRequest,
    ) -> Result<Dispatch, WasmSessionError> {
        let mut state = self.lock_state()?;
        let Some(session) = state.sessions.get(&request.session_id).cloned() else {
            return Err(WasmSessionError::new(
                WasmSessionErrorCode::UnknownSession,
                "The native plugin session is unknown or closed.",
            ));
        };
        if !session_matches_request(&session, request) {
            state.sessions.remove(&request.session_id);
            return Err(WasmSessionError::new(
                WasmSessionErrorCode::IdentityMismatch,
                "The invocation identity does not match the bound session.",
            ));
        }
        if !session_is_live(&state, &session) {
            state.sessions.remove(&request.session_id);
            return Err(session_revoked());
        }
        if session.in_flight {
            return Err(WasmSessionError::new(
                WasmSessionErrorCode::SessionBusy,
                "The native plugin session already has an invocation in flight.",
            ));
        }
        if request.sequence != session.next_sequence {
            state.sessions.remove(&request.session_id);
            return Err(WasmSessionError::new(
                WasmSessionErrorCode::SequenceMismatch,
                "The invocation sequence was repeated or arrived out of order.",
            ));
        }
        let Some(next_sequence) = session.next_sequence.checked_add(1) else {
            state.sessions.remove(&request.session_id);
            return Err(WasmSessionError::new(
                WasmSessionErrorCode::SequenceMismatch,
                "The invocation sequence is exhausted.",
            ));
        };
        let active_session = state
            .sessions
            .get_mut(&request.session_id)
            .expect("the authorized session must remain present");
        active_session.next_sequence = next_sequence;
        active_session.in_flight = true;

        Ok(Dispatch {
            module: session.module,
        })
    }

    fn validate_before_encoding(
        &self,
        request: &WasmInvocationRequest,
    ) -> Result<(), WasmSessionError> {
        if let Err(error) = validate_invocation(request) {
            if let Ok(mut state) = self.state.lock() {
                state.sessions.remove(&request.session_id);
            }
            return Err(error);
        }
        Ok(())
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, SessionState>, WasmSessionError> {
        self.state.lock().map_err(|_| {
            WasmSessionError::new(
                WasmSessionErrorCode::SessionUnavailable,
                "The native plugin session registry is unavailable.",
            )
        })
    }
}

fn session_matches_request(session: &SessionRecord, request: &WasmInvocationRequest) -> bool {
    request.schema == NEMOTO_WASM_INVOCATION_SCHEMA
        && request.schema_version == NEMOTO_WASM_INVOCATION_SCHEMA_VERSION
        && request.authority_scope_id == session.key.authority_scope_id
        && request.authority_generation == session.authority_generation
        && request.capability == ISOLATED_COMPUTE_CAPABILITY
        && request.identity == session.identity
}

fn session_is_live(state: &SessionState, session: &SessionRecord) -> bool {
    state
        .authorities
        .get(&session.key)
        .filter(|authority| authority.generation == session.authority_generation)
        .and_then(|authority| authority.snapshot.as_ref())
        .is_some_and(|snapshot| {
            snapshot.identity == session.identity && snapshot.authorizes_isolated_compute()
        })
}

fn invalidate_sessions_for_key(state: &mut SessionState, key: &AuthorityKey) -> usize {
    let before = state.sessions.len();
    state.sessions.retain(|_, session| &session.key != key);
    before - state.sessions.len()
}

fn validate_authority_snapshot(snapshot: &WasmAuthoritySnapshot) -> Result<(), WasmSessionError> {
    validate_stable_contract_id(&snapshot.authority_scope_id)?;
    validate_wasm_plugin_identity(&snapshot.identity)?;
    if snapshot.authority_generation == 0
        || snapshot.granted_capabilities.len() > 32
        || snapshot.granted_capabilities.iter().any(|capability| {
            capability.is_empty()
                || capability.len() > 120
                || !capability
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
        })
    {
        return Err(invalid_authority());
    }
    Ok(())
}

pub(crate) fn validate_wasm_plugin_identity(
    identity: &WasmPluginIdentity,
) -> Result<(), WasmSessionError> {
    validate_plugin_id(&identity.plugin_id)?;
    if identity.plugin_version.len() > 80
        || Version::parse(&identity.plugin_version).is_err()
        || identity.data_version == 0
    {
        return Err(invalid_authority());
    }
    Ok(())
}

fn validate_plugin_id(value: &str) -> Result<(), WasmSessionError> {
    let valid = (3..=160).contains(&value.len())
        && value.contains('.')
        && value.split('.').all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
                && segment
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && segment
                    .as_bytes()
                    .last()
                    .is_some_and(u8::is_ascii_alphanumeric)
        });
    if valid {
        Ok(())
    } else {
        Err(invalid_authority())
    }
}

pub(crate) fn validate_stable_contract_id(value: &str) -> Result<(), WasmSessionError> {
    let bytes = value.as_bytes();
    let valid = (1..=240).contains(&bytes.len())
        && bytes.first().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.iter().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'@' | b'/' | b'-')
        });
    if valid {
        Ok(())
    } else {
        Err(invalid_authority())
    }
}

fn validate_invocation(request: &WasmInvocationRequest) -> Result<(), WasmSessionError> {
    if request.schema != NEMOTO_WASM_INVOCATION_SCHEMA
        || request.schema_version != NEMOTO_WASM_INVOCATION_SCHEMA_VERSION
        || request.sequence == 0
        || request.authority_generation == 0
        || request.capability != ISOLATED_COMPUTE_CAPABILITY
        || validate_stable_contract_id(&request.session_id).is_err()
        || validate_stable_contract_id(&request.authority_scope_id).is_err()
        || validate_stable_contract_id(&request.operation).is_err()
        || validate_wasm_plugin_identity(&request.identity).is_err()
    {
        return Err(WasmSessionError::new(
            WasmSessionErrorCode::InvalidInvocation,
            "The native plugin invocation envelope is invalid.",
        ));
    }
    Ok(())
}

fn invalid_authority() -> WasmSessionError {
    WasmSessionError::new(
        WasmSessionErrorCode::InvalidAuthority,
        "The native plugin authority snapshot is invalid.",
    )
}

fn stale_authority() -> WasmSessionError {
    WasmSessionError::new(
        WasmSessionErrorCode::StaleAuthorityGeneration,
        "The native plugin authority generation is stale or conflicting.",
    )
}

fn authority_denied() -> WasmSessionError {
    WasmSessionError::new(
        WasmSessionErrorCode::AuthorityDenied,
        "The plugin is not authorized for isolated compute in this scope.",
    )
}

fn session_capacity_reached() -> WasmSessionError {
    WasmSessionError::new(
        WasmSessionErrorCode::SessionCapacityReached,
        "The native plugin session module budget has been reached.",
    )
}

fn session_revoked() -> WasmSessionError {
    WasmSessionError::new(
        WasmSessionErrorCode::SessionRevoked,
        "The native plugin session was revoked before its result could be released.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCOPE_ID: &str = "portfolio:test";
    const PLUGIN_ID: &str = "com.axiom.test";

    fn identity(version: &str, data_version: u32) -> WasmPluginIdentity {
        WasmPluginIdentity {
            plugin_id: PLUGIN_ID.to_owned(),
            plugin_version: version.to_owned(),
            data_version,
        }
    }

    fn authority(generation: u64) -> WasmAuthoritySnapshot {
        WasmAuthoritySnapshot {
            authority_scope_id: SCOPE_ID.to_owned(),
            authority_generation: generation,
            identity: identity("1.2.3", 4),
            installed: true,
            active: true,
            compatible: true,
            granted_capabilities: BTreeSet::from([ISOLATED_COMPUTE_CAPABILITY.to_owned()]),
        }
    }

    fn echo_module() -> Arc<[u8]> {
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
        .into()
    }

    fn authorized_manager() -> (NemotoWasmSessionManager, WasmSessionHandle) {
        let manager = NemotoWasmSessionManager::new().unwrap();
        manager.synchronize_authority(authority(1)).unwrap();
        let handle = manager
            .open_session(SCOPE_ID, identity("1.2.3", 4), echo_module())
            .unwrap();
        (manager, handle)
    }

    #[test]
    fn binds_identity_authority_module_and_sequence_into_each_invocation() {
        let (manager, handle) = authorized_manager();
        let response = manager
            .execute(handle.invocation(1, "analysis.echo", serde_json::json!({ "value": 42 })))
            .unwrap();

        assert_eq!(response.identity, identity("1.2.3", 4));
        assert_eq!(response.authority_scope_id, SCOPE_ID);
        assert_eq!(response.authority_generation, 1);
        assert_eq!(response.capability, ISOLATED_COMPUTE_CAPABILITY);
        assert_eq!(response.sequence, 1);
        assert_eq!(
            response.result,
            serde_json::json!({
                "schema": NEMOTO_WASM_INVOCATION_SCHEMA,
                "schemaVersion": 1,
                "sessionId": handle.session_id,
                "authorityScopeId": SCOPE_ID,
                "authorityGeneration": 1,
                "capability": ISOLATED_COMPUTE_CAPABILITY,
                "identity": {
                    "pluginId": PLUGIN_ID,
                    "pluginVersion": "1.2.3",
                    "dataVersion": 4
                },
                "sequence": 1,
                "operation": "analysis.echo",
                "payload": { "value": 42 }
            })
        );
    }

    #[test]
    fn refuses_missing_lifecycle_compatibility_or_grant_authority() {
        for mutate in [
            |snapshot: &mut WasmAuthoritySnapshot| snapshot.installed = false,
            |snapshot: &mut WasmAuthoritySnapshot| snapshot.active = false,
            |snapshot: &mut WasmAuthoritySnapshot| snapshot.compatible = false,
            |snapshot: &mut WasmAuthoritySnapshot| snapshot.granted_capabilities.clear(),
        ] {
            let manager = NemotoWasmSessionManager::new().unwrap();
            let mut denied = authority(1);
            mutate(&mut denied);
            manager.synchronize_authority(denied).unwrap();
            assert_eq!(
                manager
                    .open_session(SCOPE_ID, identity("1.2.3", 4), echo_module())
                    .unwrap_err()
                    .code,
                WasmSessionErrorCode::AuthorityDenied
            );
        }
    }

    #[test]
    fn rejects_identity_and_authority_forgery_and_closes_the_session() {
        type Forgery = (fn(&mut WasmInvocationRequest), WasmSessionErrorCode);
        let forgeries: &[Forgery] = &[
            (
                |request| request.identity.plugin_id = "com.axiom.other".to_owned(),
                WasmSessionErrorCode::IdentityMismatch,
            ),
            (
                |request| request.identity.plugin_version = "9.0.0".to_owned(),
                WasmSessionErrorCode::IdentityMismatch,
            ),
            (
                |request| request.identity.data_version = 9,
                WasmSessionErrorCode::IdentityMismatch,
            ),
            (
                |request| request.authority_scope_id = "portfolio:other".to_owned(),
                WasmSessionErrorCode::IdentityMismatch,
            ),
            (
                |request| request.authority_generation = 2,
                WasmSessionErrorCode::IdentityMismatch,
            ),
            (
                |request| request.capability = "read.entities".to_owned(),
                WasmSessionErrorCode::InvalidInvocation,
            ),
        ];

        for (forge, expected_code) in forgeries {
            let (manager, handle) = authorized_manager();
            let mut forged = handle.invocation(1, "analysis.echo", Value::Null);
            forge(&mut forged);

            assert_eq!(manager.execute(forged).unwrap_err().code, *expected_code);
            assert_eq!(
                manager
                    .execute(handle.invocation(1, "analysis.echo", Value::Null))
                    .unwrap_err()
                    .code,
                WasmSessionErrorCode::UnknownSession
            );
        }
    }

    #[test]
    fn rejects_replayed_or_out_of_order_sequences_and_closes_the_session() {
        let (manager, handle) = authorized_manager();
        manager
            .execute(handle.invocation(1, "analysis.echo", Value::Null))
            .unwrap();

        assert_eq!(
            manager
                .execute(handle.invocation(1, "analysis.echo", Value::Null))
                .unwrap_err()
                .code,
            WasmSessionErrorCode::SequenceMismatch
        );
        assert_eq!(
            manager
                .execute(handle.invocation(2, "analysis.echo", Value::Null))
                .unwrap_err()
                .code,
            WasmSessionErrorCode::UnknownSession
        );
    }

    #[test]
    fn advancing_authority_invalidates_sessions_and_stale_state_cannot_restore_them() {
        let (manager, handle) = authorized_manager();
        assert_eq!(manager.synchronize_authority(authority(2)).unwrap(), 1);
        assert_eq!(
            manager
                .execute(handle.invocation(1, "analysis.echo", Value::Null))
                .unwrap_err()
                .code,
            WasmSessionErrorCode::UnknownSession
        );
        assert_eq!(
            manager
                .synchronize_authority(authority(1))
                .unwrap_err()
                .code,
            WasmSessionErrorCode::StaleAuthorityGeneration
        );
        let mut conflicting = authority(2);
        conflicting.active = false;
        assert_eq!(
            manager.synchronize_authority(conflicting).unwrap_err().code,
            WasmSessionErrorCode::StaleAuthorityGeneration
        );
    }

    #[test]
    fn disable_uninstall_grant_and_version_changes_revoke_existing_sessions() {
        let changes = [
            |snapshot: &mut WasmAuthoritySnapshot| snapshot.active = false,
            |snapshot: &mut WasmAuthoritySnapshot| snapshot.installed = false,
            |snapshot: &mut WasmAuthoritySnapshot| snapshot.granted_capabilities.clear(),
            |snapshot: &mut WasmAuthoritySnapshot| {
                snapshot.identity.plugin_version = "1.2.4".to_owned()
            },
            |snapshot: &mut WasmAuthoritySnapshot| snapshot.identity.data_version = 5,
        ];

        for change in changes {
            let (manager, handle) = authorized_manager();
            let mut updated = authority(2);
            change(&mut updated);
            assert_eq!(manager.synchronize_authority(updated).unwrap(), 1);
            assert_eq!(
                manager
                    .execute(handle.invocation(1, "analysis.echo", Value::Null))
                    .unwrap_err()
                    .code,
                WasmSessionErrorCode::UnknownSession
            );
        }
    }

    #[test]
    fn explicit_revocation_is_monotonic_and_invalidates_the_bound_session() {
        let (manager, handle) = authorized_manager();
        assert_eq!(manager.revoke_authority(SCOPE_ID, PLUGIN_ID, 2).unwrap(), 1);
        assert_eq!(manager.revoke_authority(SCOPE_ID, PLUGIN_ID, 2).unwrap(), 0);
        assert_eq!(
            manager
                .revoke_authority(SCOPE_ID, PLUGIN_ID, 1)
                .unwrap_err()
                .code,
            WasmSessionErrorCode::StaleAuthorityGeneration
        );
        assert_eq!(
            manager
                .execute(handle.invocation(1, "analysis.echo", Value::Null))
                .unwrap_err()
                .code,
            WasmSessionErrorCode::UnknownSession
        );
    }

    #[test]
    fn payload_execution_hides_host_authority_from_the_guest() {
        let (manager, handle) = authorized_manager();
        let payload = serde_json::json!({ "visible": "payload-only" });
        let result = manager
            .execute_payload_json(handle.invocation(1, "ui.reduce", payload.clone()), |_| true)
            .unwrap();
        assert_eq!(result.result, payload);
        assert!(result.result.get("identity").is_none());
        assert!(result.result.get("operation").is_none());
    }

    #[test]
    fn suppresses_a_completed_payload_result_when_authority_changes_after_dispatch() {
        let (manager, handle) = authorized_manager();
        let request = handle.invocation(1, "ui.reduce", serde_json::json!({ "secret": "result" }));
        let encoded_request = serde_json::to_vec(&request.payload).unwrap();
        let result = manager.execute_encoded_with_post_dispatch_hook(
            request,
            encoded_request,
            |_| true,
            || {
                manager.revoke_authority(SCOPE_ID, PLUGIN_ID, 2).unwrap();
            },
        );

        assert_eq!(
            result.unwrap_err().code,
            WasmSessionErrorCode::SessionRevoked
        );
    }

    #[test]
    fn host_failures_are_sanitized_and_burn_the_session() {
        let manager = NemotoWasmSessionManager::new().unwrap();
        manager.synchronize_authority(authority(1)).unwrap();
        let invalid_module: Arc<[u8]> = b"not-wasm".to_vec().into();
        let handle = manager
            .open_session(SCOPE_ID, identity("1.2.3", 4), invalid_module)
            .unwrap();

        let error = manager
            .execute(handle.invocation(1, "analysis.echo", Value::Null))
            .unwrap_err();
        assert_eq!(error.code, WasmSessionErrorCode::HostExecutionFailed);
        assert_eq!(error.host_code, Some(WasmHostErrorCode::InvalidModule));
        assert_eq!(
            manager
                .execute(handle.invocation(2, "analysis.echo", Value::Null))
                .unwrap_err()
                .code,
            WasmSessionErrorCode::UnknownSession
        );
    }

    #[test]
    fn close_is_idempotent_and_makes_the_handle_unusable() {
        let (manager, handle) = authorized_manager();
        assert!(manager.close_session(&handle.session_id).unwrap());
        assert!(!manager.close_session(&handle.session_id).unwrap());
        assert_eq!(
            manager
                .execute(handle.invocation(1, "analysis.echo", Value::Null))
                .unwrap_err()
                .code,
            WasmSessionErrorCode::UnknownSession
        );
    }

    #[test]
    fn bounds_open_session_count_and_retained_module_bytes() {
        let manager = NemotoWasmSessionManager::new().unwrap();
        manager.synchronize_authority(authority(1)).unwrap();
        let module = echo_module();
        for _ in 0..MAX_NATIVE_WASM_SESSIONS {
            manager
                .open_session(SCOPE_ID, identity("1.2.3", 4), Arc::clone(&module))
                .unwrap();
        }
        assert_eq!(
            manager
                .open_session(SCOPE_ID, identity("1.2.3", 4), Arc::clone(&module))
                .unwrap_err()
                .code,
            WasmSessionErrorCode::SessionCapacityReached
        );

        let byte_budget_manager = NemotoWasmSessionManager::new().unwrap();
        byte_budget_manager
            .synchronize_authority(authority(1))
            .unwrap();
        let maximum_module: Arc<[u8]> =
            vec![0_u8; ISOLATED_COMPUTE_POLICY_V1.max_module_bytes].into();
        let retained_modules =
            MAX_NATIVE_WASM_SESSION_MODULE_BYTES / ISOLATED_COMPUTE_POLICY_V1.max_module_bytes;
        for _ in 0..retained_modules {
            byte_budget_manager
                .open_session(SCOPE_ID, identity("1.2.3", 4), Arc::clone(&maximum_module))
                .unwrap();
        }
        assert_eq!(
            byte_budget_manager
                .open_session(SCOPE_ID, identity("1.2.3", 4), maximum_module)
                .unwrap_err()
                .code,
            WasmSessionErrorCode::SessionCapacityReached
        );
    }

    #[test]
    #[ignore = "built and run by npm run verify:wasm-sdk"]
    fn rust_sdk_reference_plugin_runs_in_an_identity_bound_session() {
        let fixture_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../sdk/rust/target/wasm32-unknown-unknown/release/axiom_wasm_echo.wasm");
        let module: Arc<[u8]> = std::fs::read(&fixture_path)
            .unwrap_or_else(|error| {
                panic!(
                    "Rust SDK fixture is missing at {}: {error}",
                    fixture_path.display()
                )
            })
            .into();
        let manager = NemotoWasmSessionManager::new().unwrap();
        let snapshot = WasmAuthoritySnapshot {
            authority_scope_id: "portfolio:conformance".to_owned(),
            authority_generation: 1,
            identity: WasmPluginIdentity {
                plugin_id: "com.axiom.echo".to_owned(),
                plugin_version: "0.1.0".to_owned(),
                data_version: 1,
            },
            installed: true,
            active: true,
            compatible: true,
            granted_capabilities: BTreeSet::from([ISOLATED_COMPUTE_CAPABILITY.to_owned()]),
        };
        manager.synchronize_authority(snapshot.clone()).unwrap();
        let handle = manager
            .open_session(&snapshot.authority_scope_id, snapshot.identity, module)
            .unwrap();
        let response = manager
            .execute(handle.invocation(
                1,
                "echo",
                serde_json::json!({
                    "schema": "axiom.wasm-compute-request",
                    "schemaVersion": 1,
                    "requestId": "compute:session:1",
                    "baseRevision": "portfolio-revision-aabbccdd",
                    "portfolioRevision": 1,
                    "snapshots": [],
                    "parameters": { "message": "hello", "count": 3 }
                }),
            ))
            .unwrap();

        assert_eq!(
            response.result,
            serde_json::json!({
                "schema": "axiom.wasm-compute-result",
                "schemaVersion": 1,
                "requestId": "compute:session:1",
                "baseRevision": "portfolio-revision-aabbccdd",
                "output": {
                    "message": "hello",
                    "count": 3,
                    "sdk": crate::plugin_wasm_host::NEMOTO_WASM_ABI_NAME,
                }
            })
        );
    }
}
