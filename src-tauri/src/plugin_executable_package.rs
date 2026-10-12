//! Trusted archive-to-lifecycle adapter for executable plugin packages.
//!
//! The declarative browser inspector still rejects executable packages. Native
//! commands wrap this adapter for exact-archive consent, authority sync, and one
//! operation-specific proposal path; packages never receive the adapter itself.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

use chrono::{DateTime, SecondsFormat, Utc};
use semver::{BuildMetadata, Version};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

use crate::{
    commands::plugins::is_valid_plugin_id,
    plugin_package_archive::{
        read_bounded_plugin_archive, PluginArchiveError, PluginArchiveErrorCode,
    },
    plugin_ui_protocol::{
        validate_plugin_ui_input_json, PluginUiProtocolRequirement, PLUGIN_UI_MINIMUM_HOST_API,
    },
    plugin_wasm_admission::{NativeWasmAdmission, WasmAdmissionError, WasmAdmissionReceipt},
    plugin_wasm_data_plane::{WasmComputeRequest, WasmComputeResult},
    plugin_wasm_lifecycle::{
        NemotoWasmLifecycle, WasmAdmissionProvider, WasmAuthorityOutcome, WasmInstallCandidate,
        WasmInstallOutcome, WasmLifecycleAuthority, WasmLifecycleError, WasmLifecycleErrorCode,
        NEMOTO_WASM_INSTALL_CANDIDATE_SCHEMA, NEMOTO_WASM_INSTALL_CANDIDATE_SCHEMA_VERSION,
        NEMOTO_WASM_LIFECYCLE_AUTHORITY_SCHEMA, NEMOTO_WASM_LIFECYCLE_AUTHORITY_SCHEMA_VERSION,
    },
    plugin_wasm_session::{
        validate_stable_contract_id, WasmPluginIdentity, ISOLATED_COMPUTE_CAPABILITY,
    },
    plugin_wasm_storage::{PluginWasmEntrypoint, NEMOTO_PLUGIN_WASM_RUNTIME_SCHEMA},
    utils::{
        atomic_file::{atomic_write_verified, backup_path},
        paths::{
            get_plugin_install_transactions_dir, get_plugin_runtime_storage_dir, get_plugins_dir,
        },
    },
};

pub const NEMOTO_EXECUTABLE_INSTALL_APPROVAL_SCHEMA: &str = "axiom.executable-install-approval";
pub const NEMOTO_EXECUTABLE_INSTALL_APPROVAL_SCHEMA_VERSION: u32 = 1;
pub const NEMOTO_EXECUTABLE_INSTALL_TRANSACTION_SCHEMA: &str =
    "axiom.executable-install-transaction";
pub const NEMOTO_EXECUTABLE_INSTALL_TRANSACTION_SCHEMA_VERSION: u32 = 1;
pub const ISOLATED_COMPUTE_RISK_ACKNOWLEDGEMENT: &str = "isolated-compute-v1";
pub const NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA: &str =
    "axiom.executable-activation-snapshot";
pub const NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA_VERSION: u32 = 1;
pub const NEMOTO_EXECUTABLE_AUTHORITY_SYNC_SCHEMA: &str = "axiom.executable-authority-sync";
pub const NEMOTO_EXECUTABLE_AUTHORITY_SYNC_SCHEMA_VERSION: u32 = 1;
pub const NEMOTO_EXECUTABLE_PROPOSAL_COMMAND_RESULT_SCHEMA: &str =
    "axiom.executable-proposal-command-result";
pub const NEMOTO_EXECUTABLE_PROPOSAL_COMMAND_RESULT_SCHEMA_VERSION: u32 = 1;

/// The public host API and authority scope are native-owned inputs. The main
/// WebView cannot substitute either value when it synchronizes Portfolio state.
pub const NEMOTO_PLUGIN_API_VERSION: &str = "1.8.0";
pub const MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID: &str = "portfolio:main";

/// Enabled after the packaged Windows host proved compiler-helper isolation,
/// activation, revocation, uninstall, and interrupted-commit recovery. The
/// caller still cannot override this native-owned policy or open a session.
pub const EXECUTABLE_PLUGIN_EXECUTION_ENABLED: bool = true;

const PLUGIN_MANIFEST_SCHEMA: &str = "axiom.plugin";
const PLUGIN_MANIFEST_SCHEMA_VERSION: u32 = 1;
const INSTALLED_PLUGIN_SCHEMA: &str = "axiom.installed-plugin";
const INSTALLED_PLUGIN_SCHEMA_VERSION: u32 = 1;
const MAX_INSTALLED_PLUGIN_BYTES: usize = 25 * 1024 * 1024;
const MAX_INSTALLED_PLUGIN_FILES: usize = 1_000;
const MAX_TRANSACTION_BYTES: u64 = 52 * 1024 * 1024;
const MAX_PENDING_TRANSACTION_FILES: usize = 1_000;
const ACTIVE_PROCESS_COMMAND_CONTEXT: &str = "active-process";
const SELECTED_ENTITY_COMMAND_CONTEXT: &str = "selected-entity";

pub const NEMOTO_EXECUTABLE_PACKAGE_REVIEW_SCHEMA: &str = "axiom.executable-package-review";
pub const NEMOTO_EXECUTABLE_PACKAGE_REVIEW_SCHEMA_VERSION: u32 = 1;

const KNOWN_CAPABILITIES: &[&str] = &[
    "portfolio.read-scoped",
    "portfolio.read-sensitive",
    "proposal.create",
    "plugin-data.write",
    "plugin-device-settings.write",
    "plugin-secrets.use",
    "workspace.navigate",
    "ai.invoke",
    "file.read-selected",
    "file.write-selected",
    "network.declared",
    "clipboard.read",
    "clipboard.write",
    "compute.isolated",
    "background.run",
];
const KNOWN_CATEGORIES: &[&str] = &[
    "lens",
    "method",
    "domain",
    "knowledge",
    "adapter",
    "ai",
    "theme",
];
const KNOWN_CONTRIBUTION_FAMILIES: &[&str] = &[
    "vocabularies",
    "recordSchemas",
    "relationSchemas",
    "annotationSchemas",
    "templates",
    "questionSets",
    "aiProfiles",
    "analyses",
    "views",
    "inspectorSections",
    "workflows",
    "deliverables",
    "importers",
    "exporters",
    "themes",
    "commands",
];
const EXECUTABLE_EXTENSIONS: &[&str] = &[
    "wasm", "js", "mjs", "cjs", "exe", "dll", "com", "bat", "cmd", "ps1", "sh",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutablePackageErrorCode {
    ArchiveInvalid,
    ManifestInvalid,
    ModuleMissing,
    UnexpectedExecutable,
    ApprovalMismatch,
    ApprovalRequired,
    LifecycleFailed,
    MetadataUnavailable,
    TransactionInvalid,
    RecoveryConflict,
    UpdateRejected,
    CommitPending,
    PackageUnavailable,
    ActivationSnapshotInvalid,
    AuthoritySyncFailed,
    ProposalCommandInvalid,
    ProposalCommandFailed,
    UiReductionInvalid,
    UiReductionFailed,
    WorkerUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutablePackageError {
    pub code: ExecutablePackageErrorCode,
    pub message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive_code: Option<PluginArchiveErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle_code: Option<WasmLifecycleErrorCode>,
}

impl ExecutablePackageError {
    pub(crate) fn new(code: ExecutablePackageErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            archive_code: None,
            lifecycle_code: None,
        }
    }

    fn archive(error: PluginArchiveError) -> Self {
        Self {
            code: ExecutablePackageErrorCode::ArchiveInvalid,
            message: "The executable plugin archive is invalid or unsupported.",
            archive_code: Some(error.code),
            lifecycle_code: None,
        }
    }

    fn lifecycle(error: WasmLifecycleError) -> Self {
        Self {
            code: ExecutablePackageErrorCode::LifecycleFailed,
            message: "The executable plugin lifecycle rejected the installation.",
            archive_code: None,
            lifecycle_code: Some(error.code),
        }
    }

    fn authority(error: WasmLifecycleError) -> Self {
        Self {
            code: ExecutablePackageErrorCode::AuthoritySyncFailed,
            message: "Executable plugin authority synchronization failed closed.",
            archive_code: None,
            lifecycle_code: Some(error.code),
        }
    }

    fn proposal_command(error: WasmLifecycleError) -> Self {
        Self {
            code: ExecutablePackageErrorCode::ProposalCommandFailed,
            message: "The executable proposal command failed closed.",
            archive_code: None,
            lifecycle_code: Some(error.code),
        }
    }

    fn ui_reduction(error: WasmLifecycleError) -> Self {
        Self {
            code: ExecutablePackageErrorCode::UiReductionFailed,
            message: "The executable plugin UI reduction failed closed.",
            archive_code: None,
            lifecycle_code: Some(error.code),
        }
    }
}

impl std::fmt::Display for ExecutablePackageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for ExecutablePackageError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutablePackageInspection {
    pub archive_sha256: String,
    pub identity: WasmPluginIdentity,
    pub name: String,
    pub description: String,
    pub publisher_name: Option<String>,
    pub requested_capabilities: Vec<String>,
    pub module_sha256: String,
    pub compressed_bytes: usize,
    pub expanded_bytes: usize,
    pub contribution_count: usize,
    pub interactive_operations: Vec<InteractiveOperationBinding>,
    candidate: WasmInstallCandidate,
    normalized_manifest: Value,
    contributions: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutablePackageReview {
    pub schema: String,
    pub schema_version: u32,
    pub archive_sha256: String,
    pub identity: WasmPluginIdentity,
    pub name: String,
    pub description: String,
    pub publisher_name: Option<String>,
    pub requested_capabilities: Vec<String>,
    pub module_sha256: String,
    pub compressed_bytes: usize,
    pub expanded_bytes: usize,
    pub contribution_count: usize,
    pub interactive_operations: Vec<InteractiveOperationBinding>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InteractiveOperationBinding {
    pub view_id: String,
    pub operation: String,
    pub required_capabilities: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutableInstallApproval {
    pub schema: String,
    pub schema_version: u32,
    pub archive_sha256: String,
    pub identity: WasmPluginIdentity,
    pub granted_capabilities: Vec<String>,
    pub risk_acknowledgement: String,
    #[serde(default)]
    pub approved_interactive_operations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutablePackageInstallOutcome {
    pub lifecycle: WasmInstallOutcome,
    pub installed_document: Value,
    pub transaction_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutablePortfolioRequirement {
    pub plugin_id: String,
    pub version: String,
    pub data_version: u32,
    pub requirement: String,
    pub activation: String,
}

/// The only caller-authored input accepted by the authority adapter. It carries
/// current Portfolio lifecycle facts, never installed identity or grants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutableActivationSnapshot {
    pub schema: String,
    pub schema_version: u32,
    pub requirements: Vec<ExecutablePortfolioRequirement>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutableAuthorityDecision {
    pub identity: WasmPluginIdentity,
    pub portfolio_active: bool,
    pub compatible: bool,
    pub effective_capabilities: Vec<String>,
    pub eligible: bool,
    pub authorized: bool,
    pub authority_generation: u64,
    pub invalidated_sessions: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutableAuthoritySyncOutcome {
    pub schema: &'static str,
    pub schema_version: u32,
    pub authority_scope_id: &'static str,
    pub host_plugin_api_version: &'static str,
    pub execution_enabled: bool,
    pub decisions: Vec<ExecutableAuthorityDecision>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutableProposalCommandOutcome {
    pub schema: &'static str,
    pub schema_version: u32,
    pub command_id: String,
    pub identity: WasmPluginIdentity,
    pub effective_capabilities: Vec<String>,
    pub result: WasmComputeResult,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutableUiReductionRequest {
    pub schema: String,
    pub schema_version: u32,
    pub view_id: String,
    pub input_json: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutableUiReductionOutcome {
    pub schema: &'static str,
    pub schema_version: u32,
    pub view_id: String,
    pub identity: WasmPluginIdentity,
    pub authority_generation: u64,
    pub effective_capabilities: Vec<String>,
    pub result: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutablePackageRecoveryAction {
    None,
    Committed,
    Aborted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstallTransaction {
    schema: String,
    schema_version: u32,
    transaction_id: String,
    archive_sha256: String,
    plugin_id: String,
    new_identity: WasmPluginIdentity,
    previous_identity: Option<WasmPluginIdentity>,
    new_document_sha256: String,
    new_document: Value,
    previous_document_sha256: Option<String>,
    previous_document: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeManifest {
    schema: String,
    schema_version: u32,
    id: String,
    version: String,
    name: String,
    description: String,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    publisher: Option<ManifestPublisher>,
    #[serde(skip_serializing_if = "Option::is_none")]
    homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    license: Option<String>,
    compatibility: ManifestCompatibility,
    #[serde(default = "default_data_version")]
    data_version: u32,
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    dependencies: Vec<ManifestDependency>,
    runtime: PluginWasmEntrypoint,
    contributes: BTreeMap<String, Vec<ManifestContributionReference>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeInstalledExecutableDocument {
    schema: String,
    schema_version: u32,
    installed_at: String,
    manifest: NativeManifest,
    granted_capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    approved_interactive_operations: Vec<String>,
    contributions: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestPublisher {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManifestCompatibility {
    axiom_plugin_api: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestDependency {
    id: String,
    version: String,
    #[serde(default)]
    optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestContributionReference {
    id: String,
    path: String,
    #[serde(default)]
    optional: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeProposalCommandContribution {
    schema: String,
    schema_version: u32,
    id: String,
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    keywords: Vec<String>,
    placement: String,
    #[serde(default = "default_command_order")]
    order: u32,
    action: NativeProposalCommandAction,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeProposalCommandAction {
    kind: String,
    operation: String,
    context: NativeProposalCommandContext,
    #[serde(default = "empty_json_object")]
    parameters: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeProposalCommandContext {
    kind: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeProposalCommandParameters {
    invocation_id: String,
    observed_at: String,
    input: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeComposedViewContribution {
    schema: String,
    schema_version: u32,
    id: String,
    renderer: String,
    navigation: NativeComposedViewNavigation,
    operation: String,
    storage_view_id: String,
    ui: PluginUiProtocolRequirement,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeComposedViewNavigation {
    surface: String,
    label: String,
    icon: String,
    order: u32,
}

pub struct ExecutablePackageAdapter<A: WasmAdmissionProvider> {
    lifecycle: Arc<NemotoWasmLifecycle<A>>,
    installed_plugins_root: PathBuf,
    transactions_root: PathBuf,
    metadata_writer: Arc<MetadataWriter>,
    operation_lock: Mutex<()>,
    ui_rate: Mutex<crate::plugin_ui_rate::PluginUiRateBudget>,
    synchronized_plugin_ids: Mutex<BTreeSet<String>>,
    execution_enabled: bool,
    host_plugin_api_version: &'static str,
}

type MetadataWriter = dyn Fn(&Path, &Value) -> Result<(), ExecutablePackageError> + Send + Sync;

impl ExecutablePackageAdapter<NativeWasmAdmission> {
    pub fn native_for_app() -> Result<Self, ExecutablePackageError> {
        Self::native(
            get_plugins_dir(),
            get_plugin_runtime_storage_dir(),
            get_plugin_install_transactions_dir(),
        )
    }

    pub fn native(
        installed_plugins_root: PathBuf,
        runtime_storage_root: PathBuf,
        transactions_root: PathBuf,
    ) -> Result<Self, ExecutablePackageError> {
        let lifecycle = Arc::new(
            NemotoWasmLifecycle::native(runtime_storage_root)
                .map_err(ExecutablePackageError::lifecycle)?,
        );
        Ok(Self::with_lifecycle(
            lifecycle,
            installed_plugins_root,
            transactions_root,
        ))
    }
}

impl<A: WasmAdmissionProvider> ExecutablePackageAdapter<A> {
    pub fn inspect_file(
        path: &Path,
    ) -> Result<ExecutablePackageInspection, ExecutablePackageError> {
        let archive_bytes = read_package_file(path)?;
        Self::inspect_archive(&archive_bytes)
    }

    pub fn with_lifecycle(
        lifecycle: Arc<NemotoWasmLifecycle<A>>,
        installed_plugins_root: PathBuf,
        transactions_root: PathBuf,
    ) -> Self {
        Self::with_lifecycle_and_execution_policy(
            lifecycle,
            installed_plugins_root,
            transactions_root,
            EXECUTABLE_PLUGIN_EXECUTION_ENABLED,
        )
    }

    fn with_lifecycle_and_execution_policy(
        lifecycle: Arc<NemotoWasmLifecycle<A>>,
        installed_plugins_root: PathBuf,
        transactions_root: PathBuf,
        execution_enabled: bool,
    ) -> Self {
        Self::with_lifecycle_execution_policy_and_api(
            lifecycle,
            installed_plugins_root,
            transactions_root,
            execution_enabled,
            NEMOTO_PLUGIN_API_VERSION,
        )
    }

    fn with_lifecycle_execution_policy_and_api(
        lifecycle: Arc<NemotoWasmLifecycle<A>>,
        installed_plugins_root: PathBuf,
        transactions_root: PathBuf,
        execution_enabled: bool,
        host_plugin_api_version: &'static str,
    ) -> Self {
        Self {
            lifecycle,
            installed_plugins_root,
            transactions_root,
            metadata_writer: Arc::new(write_document),
            operation_lock: Mutex::new(()),
            ui_rate: Mutex::new(crate::plugin_ui_rate::PluginUiRateBudget::default()),
            synchronized_plugin_ids: Mutex::new(BTreeSet::new()),
            execution_enabled,
            host_plugin_api_version,
        }
    }

    /// Test-only constructor used by the real optimized SDK conformance chain.
    /// Production builds do not expose a way to override the closed policy.
    #[cfg(feature = "test-execution-policy")]
    pub fn with_lifecycle_for_execution_tests(
        lifecycle: Arc<NemotoWasmLifecycle<A>>,
        installed_plugins_root: PathBuf,
        transactions_root: PathBuf,
    ) -> Self {
        Self::with_lifecycle_and_execution_policy(
            lifecycle,
            installed_plugins_root,
            transactions_root,
            true,
        )
    }

    /// Feature-only constructor that reproduces process loss after runtime
    /// promotion but before installed metadata commits. A fresh adapter can
    /// then exercise the same recovery call used during application startup.
    #[cfg(feature = "runtime-security-harness")]
    #[doc(hidden)]
    pub fn with_lifecycle_for_interrupted_commit_harness(
        lifecycle: Arc<NemotoWasmLifecycle<A>>,
        installed_plugins_root: PathBuf,
        transactions_root: PathBuf,
    ) -> Self {
        use std::sync::atomic::{AtomicBool, Ordering};

        let fail_once = AtomicBool::new(true);
        let mut adapter = Self::with_lifecycle_and_execution_policy(
            lifecycle,
            installed_plugins_root,
            transactions_root,
            true,
        );
        adapter.metadata_writer = Arc::new(move |path, document| {
            if fail_once.swap(false, Ordering::SeqCst) {
                Err(metadata_unavailable())
            } else {
                write_document(path, document)
            }
        });
        adapter
    }

    pub fn lifecycle(&self) -> &NemotoWasmLifecycle<A> {
        &self.lifecycle
    }

    pub fn inspect_archive(
        archive_bytes: &[u8],
    ) -> Result<ExecutablePackageInspection, ExecutablePackageError> {
        let archive =
            read_bounded_plugin_archive(archive_bytes).map_err(ExecutablePackageError::archive)?;
        let manifest_bytes = archive.files.get("manifest.json").ok_or_else(|| {
            ExecutablePackageError::new(
                ExecutablePackageErrorCode::ManifestInvalid,
                "The executable plugin archive has no root manifest.",
            )
        })?;
        let mut manifest: NativeManifest =
            serde_json::from_slice(manifest_bytes).map_err(|_| invalid_manifest())?;
        normalize_and_validate_manifest(&mut manifest)?;
        let module_path = manifest.runtime.module.clone();
        let module_bytes = archive.files.get(&module_path).ok_or_else(|| {
            ExecutablePackageError::new(
                ExecutablePackageErrorCode::ModuleMissing,
                "The declared executable plugin module is missing.",
            )
        })?;
        for path in archive.files.keys() {
            if is_executable_path(path) && path != &module_path {
                return Err(ExecutablePackageError::new(
                    ExecutablePackageErrorCode::UnexpectedExecutable,
                    "The plugin archive contains undeclared executable content.",
                ));
            }
        }

        let mut contributions = BTreeMap::new();
        let mut contribution_count = 0_usize;
        for references in manifest.contributes.values() {
            for reference in references {
                contribution_count += 1;
                if reference.path == module_path || reference.path == "manifest.json" {
                    return Err(invalid_manifest());
                }
                let Some(bytes) = archive.files.get(&reference.path) else {
                    if reference.optional {
                        continue;
                    }
                    return Err(ExecutablePackageError::new(
                        ExecutablePackageErrorCode::ManifestInvalid,
                        "A required executable plugin contribution is missing.",
                    ));
                };
                let value = serde_json::from_slice(bytes).map_err(|_| invalid_manifest())?;
                validate_contribution_binding(reference, &value)?;
                contributions.insert(reference.path.clone(), value);
            }
        }
        let interactive_operations = validate_composed_view_admission(&manifest, &contributions)?;

        let archive_sha256 = sha256(archive_bytes);
        let module_sha256 = sha256(module_bytes);
        let identity = WasmPluginIdentity {
            plugin_id: manifest.id.clone(),
            plugin_version: manifest.version.clone(),
            data_version: manifest.data_version,
        };
        let normalized_manifest =
            serde_json::to_value(&manifest).map_err(|_| invalid_manifest())?;
        let candidate = WasmInstallCandidate {
            schema: NEMOTO_WASM_INSTALL_CANDIDATE_SCHEMA.to_owned(),
            schema_version: NEMOTO_WASM_INSTALL_CANDIDATE_SCHEMA_VERSION,
            identity: identity.clone(),
            capability: ISOLATED_COMPUTE_CAPABILITY.to_owned(),
            entrypoint: manifest.runtime.clone(),
            module_bytes: module_bytes.clone(),
        };
        Ok(ExecutablePackageInspection {
            archive_sha256,
            identity,
            name: manifest.name,
            description: manifest.description,
            publisher_name: manifest.publisher.map(|publisher| publisher.name),
            requested_capabilities: manifest.capabilities,
            module_sha256,
            compressed_bytes: archive.compressed_bytes,
            expanded_bytes: archive.expanded_bytes,
            contribution_count,
            interactive_operations,
            candidate,
            normalized_manifest,
            contributions,
        })
    }

    pub fn install_file(
        &self,
        path: &Path,
        approval: ExecutableInstallApproval,
    ) -> Result<ExecutablePackageInstallOutcome, ExecutablePackageError> {
        let inspection = Self::inspect_file(path)?;
        self.install(inspection, approval)
    }

    pub fn install(
        &self,
        inspection: ExecutablePackageInspection,
        approval: ExecutableInstallApproval,
    ) -> Result<ExecutablePackageInstallOutcome, ExecutablePackageError> {
        let _operation = self.lock_operations()?;
        validate_approval(&inspection, &approval)?;
        self.recover_pending_locked(&inspection.identity.plugin_id)?;

        let installed_path = self.installed_path(&inspection.identity.plugin_id)?;
        let previous_document = read_optional_document(&installed_path)?;
        let previous_identity = self
            .lifecycle
            .current_identity(&inspection.identity.plugin_id)
            .map_err(ExecutablePackageError::lifecycle)?;
        validate_existing_state(
            previous_document.as_ref(),
            previous_identity.as_ref(),
            &inspection,
        )?;

        let approved_interactive_operations = approval.approved_interactive_operations.clone();
        let mut installed_document = serde_json::json!({
            "schema": INSTALLED_PLUGIN_SCHEMA,
            "schemaVersion": INSTALLED_PLUGIN_SCHEMA_VERSION,
            "installedAt": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            "manifest": inspection.normalized_manifest,
            "grantedCapabilities": approval.granted_capabilities,
            "contributions": inspection.contributions,
        });
        if !approved_interactive_operations.is_empty() {
            installed_document
                .as_object_mut()
                .expect("installed document is an object")
                .insert(
                    "approvedInteractiveOperations".to_owned(),
                    serde_json::to_value(approved_interactive_operations)
                        .map_err(|_| invalid_manifest())?,
                );
        }
        let encoded_document = encode_document(&installed_document)?;
        let transaction_id = Uuid::new_v4().simple().to_string();
        let transaction = InstallTransaction {
            schema: NEMOTO_EXECUTABLE_INSTALL_TRANSACTION_SCHEMA.to_owned(),
            schema_version: NEMOTO_EXECUTABLE_INSTALL_TRANSACTION_SCHEMA_VERSION,
            transaction_id: transaction_id.clone(),
            archive_sha256: inspection.archive_sha256,
            plugin_id: inspection.identity.plugin_id.clone(),
            new_identity: inspection.identity,
            previous_identity,
            new_document_sha256: sha256(&encoded_document),
            new_document: installed_document.clone(),
            previous_document_sha256: previous_document
                .as_ref()
                .map(canonical_document_hash)
                .transpose()?,
            previous_document,
        };
        let transaction_path = self.transaction_path(&transaction.plugin_id)?;
        write_transaction(&transaction_path, &transaction)?;

        let mut lifecycle = match self.lifecycle.install(inspection.candidate) {
            Ok(outcome) => outcome,
            Err(error) => match self.lifecycle.current_identity(&transaction.plugin_id) {
                Ok(current) if current == transaction.previous_identity => {
                    let _ = remove_exact_file(&transaction_path);
                    return Err(ExecutablePackageError::lifecycle(error));
                }
                _ => {
                    return Err(ExecutablePackageError::new(
                            ExecutablePackageErrorCode::CommitPending,
                            "Executable runtime storage may have committed and awaits transaction recovery.",
                        ));
                }
            },
        };
        if lifecycle.reused_existing {
            let additionally_invalidated = self
                .lifecycle
                .revoke_plugin_authority(&transaction.plugin_id)
                .map_err(ExecutablePackageError::authority)?;
            lifecycle.invalidated_sessions = lifecycle
                .invalidated_sessions
                .saturating_add(additionally_invalidated);
        }
        if (self.metadata_writer)(&installed_path, &installed_document).is_err() {
            return Err(ExecutablePackageError::new(
                ExecutablePackageErrorCode::CommitPending,
                "Executable storage committed but installed metadata awaits transaction recovery.",
            ));
        }
        if remove_exact_file(&transaction_path).is_err() {
            return Err(ExecutablePackageError::new(
                ExecutablePackageErrorCode::CommitPending,
                "The executable installation committed but transaction cleanup is pending.",
            ));
        }
        Ok(ExecutablePackageInstallOutcome {
            lifecycle,
            installed_document,
            transaction_id,
        })
    }

    /// Derives native lifecycle authority from the exact installed documents
    /// and a strict Core-authored Portfolio activation snapshot. Identity,
    /// grants, host API version, and authority scope are never caller inputs.
    pub fn synchronize_authority(
        &self,
        snapshot: ExecutableActivationSnapshot,
    ) -> Result<ExecutableAuthoritySyncOutcome, ExecutablePackageError> {
        let _operation = self.lock_operations()?;
        if let Err(error) = validate_activation_snapshot(&snapshot) {
            self.revoke_synchronized_authorities(&BTreeSet::new())?;
            return Err(error);
        }

        let documents = match read_installed_executable_documents(&self.installed_plugins_root) {
            Ok(documents) => documents,
            Err(error) => {
                self.revoke_synchronized_authorities(&BTreeSet::new())?;
                return Err(error);
            }
        };
        let current_plugin_ids = documents
            .iter()
            .map(|document| document.manifest.id.clone())
            .collect::<BTreeSet<_>>();
        let previous_plugin_ids = self.lock_synchronized_plugin_ids()?.clone();
        for plugin_id in previous_plugin_ids.difference(&current_plugin_ids) {
            self.lifecycle
                .revoke_plugin_authority(plugin_id)
                .map_err(ExecutablePackageError::authority)?;
        }

        let mut decisions = Vec::with_capacity(documents.len());
        for document in documents {
            let decision = match self.synchronize_document_authority(&snapshot, document) {
                Ok(decision) => decision,
                Err(error) => {
                    let mut revoke_ids = previous_plugin_ids.clone();
                    revoke_ids.extend(current_plugin_ids.iter().cloned());
                    self.revoke_synchronized_authorities(&revoke_ids)?;
                    return Err(error);
                }
            };
            decisions.push(decision);
        }
        *self.lock_synchronized_plugin_ids()? = current_plugin_ids;

        Ok(ExecutableAuthoritySyncOutcome {
            schema: NEMOTO_EXECUTABLE_AUTHORITY_SYNC_SCHEMA,
            schema_version: NEMOTO_EXECUTABLE_AUTHORITY_SYNC_SCHEMA_VERSION,
            authority_scope_id: MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID,
            host_plugin_api_version: self.host_plugin_api_version,
            execution_enabled: self.execution_enabled,
            decisions,
        })
    }

    /// Runs one installed, declaratively registered proposal command. The
    /// caller supplies copied Core data but cannot choose plugin identity,
    /// capabilities, operation, static parameters, authority scope, or session.
    pub fn execute_proposal_command(
        &self,
        command_id: &str,
        request: WasmComputeRequest,
    ) -> Result<ExecutableProposalCommandOutcome, ExecutablePackageError> {
        if command_id.len() < 3 || command_id.len() > 240 {
            return Err(invalid_proposal_command());
        }
        let _operation = self.lock_operations()?;
        let documents = read_installed_executable_documents(&self.installed_plugins_root)?;
        let mut resolved = None;
        for document in documents {
            let Some(reference) =
                document
                    .manifest
                    .contributes
                    .get("commands")
                    .and_then(|references| {
                        references
                            .iter()
                            .find(|reference| reference.id == command_id)
                    })
            else {
                continue;
            };
            if resolved.is_some() {
                return Err(invalid_proposal_command());
            }
            let contribution = document
                .contributions
                .get(&reference.path)
                .cloned()
                .ok_or_else(invalid_proposal_command)?;
            let command = parse_native_proposal_command(contribution, command_id, &document)?;
            resolved = Some((document, command));
        }
        let (document, command) = resolved.ok_or_else(invalid_proposal_command)?;
        let identity = WasmPluginIdentity {
            plugin_id: document.manifest.id.clone(),
            plugin_version: document.manifest.version.clone(),
            data_version: document.manifest.data_version,
        };
        let effective_capabilities = document
            .granted_capabilities
            .iter()
            .filter(|capability| document.manifest.capabilities.contains(capability))
            .filter(|capability| {
                matches!(
                    capability.as_str(),
                    ISOLATED_COMPUTE_CAPABILITY | "portfolio.read-scoped" | "proposal.create"
                )
            })
            .cloned()
            .collect::<BTreeSet<_>>();
        if !effective_capabilities.contains(ISOLATED_COMPUTE_CAPABILITY)
            || !effective_capabilities.contains("portfolio.read-scoped")
            || !effective_capabilities.contains("proposal.create")
        {
            return Err(invalid_proposal_command());
        }
        validate_proposal_command_request(&request, &command)?;

        let session = self
            .lifecycle
            .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, identity.clone())
            .map_err(ExecutablePackageError::proposal_command)?;
        let execution =
            self.lifecycle
                .execute_compute(&session, 1, command.action.operation.clone(), request);
        let close = self.lifecycle.close_session(&session.session_id);
        let result = execution.map_err(ExecutablePackageError::proposal_command)?;
        close.map_err(ExecutablePackageError::proposal_command)?;
        validate_proposal_command_result(&result, command_id)?;

        Ok(ExecutableProposalCommandOutcome {
            schema: NEMOTO_EXECUTABLE_PROPOSAL_COMMAND_RESULT_SCHEMA,
            schema_version: NEMOTO_EXECUTABLE_PROPOSAL_COMMAND_RESULT_SCHEMA_VERSION,
            command_id: command_id.to_owned(),
            identity,
            effective_capabilities: effective_capabilities.into_iter().collect(),
            result,
        })
    }

    /// Resolves a caller-selected view to its exact installed, approved
    /// operation. Plugin identity, module, operation, session, authority scope,
    /// generation and grants never come from the request.
    pub fn execute_ui_reduction(
        &self,
        request: ExecutableUiReductionRequest,
    ) -> Result<ExecutableUiReductionOutcome, ExecutablePackageError> {
        if request.schema != "axiom.executable-plugin-ui-reduction"
            || request.schema_version != 1
            || request.view_id.len() < 3
            || request.view_id.len() > 240
        {
            return Err(invalid_ui_reduction());
        }
        if validate_plugin_ui_input_json(request.input_json.as_bytes()).is_err() {
            return Err(invalid_ui_reduction());
        }
        let input: Value =
            serde_json::from_str(&request.input_json).map_err(|_| invalid_ui_reduction())?;

        let (document, view, effective_capabilities) = {
            #[cfg(feature = "runtime-security-harness")]
            let _timing = crate::commands::runtime_security_harness::TimingSpan::new("package.metadata-and-authority");
            let _operation = self.lock_operations()?;
            let documents = read_installed_executable_documents(&self.installed_plugins_root)?;
            let mut resolved = None;
            for document in documents {
                let Some(reference) =
                    document
                        .manifest
                        .contributes
                        .get("views")
                        .and_then(|references| {
                            references.iter().find(|item| item.id == request.view_id)
                        })
                else {
                    continue;
                };
                if resolved.is_some() {
                    return Err(invalid_ui_reduction());
                }
                let contribution = document
                    .contributions
                    .get(&reference.path)
                    .cloned()
                    .ok_or_else(invalid_ui_reduction)?;
                let view: NativeComposedViewContribution =
                    serde_json::from_value(contribution).map_err(|_| invalid_ui_reduction())?;
                if view.renderer != "composed-view"
                    || view.id != request.view_id
                    || !document
                        .approved_interactive_operations
                        .contains(&view.operation)
                {
                    return Err(invalid_ui_reduction());
                }
                let required_capabilities = required_capabilities_for_composed_view(&view);
                let effective = document
                    .granted_capabilities
                    .iter()
                    .filter(|capability| document.manifest.capabilities.contains(capability))
                    .cloned()
                    .collect::<BTreeSet<_>>();
                if required_capabilities
                    .iter()
                    .any(|capability| !effective.contains(capability))
                    || !satisfies_version_range(
                        self.host_plugin_api_version,
                        &document.manifest.compatibility.axiom_plugin_api,
                    )
                {
                    return Err(invalid_ui_reduction());
                }
                resolved = Some((document, view, effective));
            }
            resolved.ok_or_else(invalid_ui_reduction)?
        };

        let identity = WasmPluginIdentity {
            plugin_id: document.manifest.id.clone(),
            plugin_version: document.manifest.version.clone(),
            data_version: document.manifest.data_version,
        };
        if !self
            .ui_rate
            .lock()
            .map_err(|_| invalid_ui_reduction())?
            .admit(&identity.plugin_id, std::time::Instant::now())
        {
            return Err(ExecutablePackageError::new(ExecutablePackageErrorCode::UiReductionFailed,
                "The plugin UI rolling dispatch budget was reached. Wait before reopening the view."));
        }
        let session = {
            #[cfg(feature = "runtime-security-harness")]
            let _timing = crate::commands::runtime_security_harness::TimingSpan::new("package.open-session");
            self.lifecycle
                .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, identity.clone())
                .map_err(ExecutablePackageError::ui_reduction)?
        };
        let authority_generation = session.authority_generation;
        let execution = self.lifecycle.execute_ui_reduction(
            &session,
            view.operation,
            input,
            &view.ui.required_primitives,
            &view.ui.required_effects,
        );
        let close = self.lifecycle.close_session(&session.session_id);
        let result = execution.map_err(ExecutablePackageError::ui_reduction)?;
        close.map_err(ExecutablePackageError::ui_reduction)?;

        Ok(ExecutableUiReductionOutcome {
            schema: "axiom.executable-plugin-ui-reduction-result",
            schema_version: 1,
            view_id: request.view_id,
            identity,
            authority_generation,
            effective_capabilities: effective_capabilities.into_iter().collect(),
            result,
        })
    }

    /// Revokes authority and removes immutable runtime storage before deleting
    /// installed metadata. Portfolio-owned plugin data is intentionally outside
    /// this operation and remains preserved.
    pub fn uninstall(&self, plugin_id: &str) -> Result<(), ExecutablePackageError> {
        if !is_valid_plugin_id(plugin_id) {
            return Err(ExecutablePackageError::new(
                ExecutablePackageErrorCode::MetadataUnavailable,
                "The installed plugin identifier is invalid.",
            ));
        }
        let _operation = self.lock_operations()?;
        self.recover_pending_locked(plugin_id)?;
        self.lifecycle
            .uninstall(plugin_id)
            .map_err(ExecutablePackageError::authority)?;
        remove_document_and_backup(&self.installed_path(plugin_id)?)?;
        self.lock_synchronized_plugin_ids()?.remove(plugin_id);
        Ok(())
    }

    /// Atomically restores the immediately previous executable package generation
    /// and its exact installed metadata. Portfolio-owned data is not modified.
    pub fn rollback(
        &self,
        expected_identity: &WasmPluginIdentity,
    ) -> Result<ExecutablePackageInstallOutcome, ExecutablePackageError> {
        let plugin_id = &expected_identity.plugin_id;
        if !is_valid_plugin_id(plugin_id) {
            return Err(metadata_unavailable());
        }
        let _operation = self.lock_operations()?;
        self.recover_pending_locked(plugin_id)?;

        let installed_path = self.installed_path(plugin_id)?;
        let current_document =
            read_optional_document(&installed_path)?.ok_or_else(metadata_unavailable)?;
        let current_identity = installed_document_identity(&current_document)?;
        let runtime_identity = self
            .lifecycle
            .current_identity(plugin_id)
            .map_err(ExecutablePackageError::lifecycle)?;
        if &current_identity != expected_identity
            || runtime_identity.as_ref() != Some(expected_identity)
        {
            return Err(ExecutablePackageError::new(
                ExecutablePackageErrorCode::RecoveryConflict,
                "The requested rollback identity is no longer current.",
            ));
        }

        let previous_path = backup_path(&installed_path);
        let previous_document = read_optional_document(&previous_path)?.ok_or_else(|| {
            ExecutablePackageError::new(
                ExecutablePackageErrorCode::UpdateRejected,
                "No compatible executable package generation is available to roll back.",
            )
        })?;
        let previous_installed = parse_installed_executable_document(previous_document.clone())?;
        let previous_identity = WasmPluginIdentity {
            plugin_id: previous_installed.manifest.id,
            plugin_version: previous_installed.manifest.version,
            data_version: previous_installed.manifest.data_version,
        };
        if previous_identity.plugin_id != *plugin_id
            || previous_identity.data_version != expected_identity.data_version
        {
            return Err(ExecutablePackageError::new(
                ExecutablePackageErrorCode::UpdateRejected,
                "The previous executable package generation is not data-compatible.",
            ));
        }

        let transaction_id = Uuid::new_v4().simple().to_string();
        let transaction = InstallTransaction {
            schema: NEMOTO_EXECUTABLE_INSTALL_TRANSACTION_SCHEMA.to_owned(),
            schema_version: NEMOTO_EXECUTABLE_INSTALL_TRANSACTION_SCHEMA_VERSION,
            transaction_id: transaction_id.clone(),
            archive_sha256: canonical_document_hash(&previous_document)?,
            plugin_id: plugin_id.clone(),
            new_identity: previous_identity.clone(),
            previous_identity: Some(current_identity),
            new_document_sha256: canonical_document_hash(&previous_document)?,
            new_document: previous_document.clone(),
            previous_document_sha256: Some(canonical_document_hash(&current_document)?),
            previous_document: Some(current_document),
        };
        let transaction_path = self.transaction_path(plugin_id)?;
        write_transaction(&transaction_path, &transaction)?;

        let lifecycle = self
            .lifecycle
            .rollback(&previous_identity)
            .map_err(ExecutablePackageError::lifecycle)?;
        if lifecycle.identity != previous_identity {
            return Err(ExecutablePackageError::new(
                ExecutablePackageErrorCode::CommitPending,
                "Executable rollback storage committed with an unexpected identity.",
            ));
        }
        if (self.metadata_writer)(&installed_path, &previous_document).is_err()
            || remove_exact_file(&transaction_path).is_err()
        {
            return Err(ExecutablePackageError::new(
                ExecutablePackageErrorCode::CommitPending,
                "Executable rollback committed but metadata recovery remains pending.",
            ));
        }
        self.lock_synchronized_plugin_ids()?.remove(plugin_id);
        Ok(ExecutablePackageInstallOutcome {
            lifecycle,
            installed_document: previous_document,
            transaction_id,
        })
    }

    fn synchronize_document_authority(
        &self,
        snapshot: &ExecutableActivationSnapshot,
        document: NativeInstalledExecutableDocument,
    ) -> Result<ExecutableAuthorityDecision, ExecutablePackageError> {
        let identity = WasmPluginIdentity {
            plugin_id: document.manifest.id.clone(),
            plugin_version: document.manifest.version.clone(),
            data_version: document.manifest.data_version,
        };
        let requirement = snapshot
            .requirements
            .iter()
            .find(|requirement| requirement.plugin_id == identity.plugin_id);
        let portfolio_active =
            requirement.is_some_and(|requirement| requirement.activation == "active");
        let compatible = requirement.is_some_and(|requirement| {
            satisfies_version_range(&identity.plugin_version, &requirement.version)
                && identity.data_version == requirement.data_version
                && satisfies_version_range(
                    self.host_plugin_api_version,
                    &document.manifest.compatibility.axiom_plugin_api,
                )
        });
        let effective_capabilities = document
            .granted_capabilities
            .iter()
            .filter(|capability| {
                document.manifest.capabilities.contains(capability)
                    && KNOWN_CAPABILITIES.contains(&capability.as_str())
            })
            .cloned()
            .collect::<BTreeSet<_>>();
        let isolated_compute_granted = effective_capabilities.contains(ISOLATED_COMPUTE_CAPABILITY);
        let eligible = portfolio_active && compatible && isolated_compute_granted;
        let authority = WasmLifecycleAuthority {
            schema: NEMOTO_WASM_LIFECYCLE_AUTHORITY_SCHEMA.to_owned(),
            schema_version: NEMOTO_WASM_LIFECYCLE_AUTHORITY_SCHEMA_VERSION,
            authority_scope_id: MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID.to_owned(),
            identity: identity.clone(),
            installed: true,
            active: self.execution_enabled && portfolio_active,
            compatible,
            isolated_compute_granted,
            portfolio_read_scoped_granted: effective_capabilities.contains("portfolio.read-scoped"),
            proposal_create_granted: effective_capabilities.contains("proposal.create"),
            granted_capabilities: effective_capabilities.clone(),
        };
        let WasmAuthorityOutcome {
            authorized,
            authority_generation,
            invalidated_sessions,
            ..
        } = self
            .lifecycle
            .synchronize_authority(authority)
            .map_err(ExecutablePackageError::authority)?;

        Ok(ExecutableAuthorityDecision {
            identity,
            portfolio_active,
            compatible,
            effective_capabilities: effective_capabilities.into_iter().collect(),
            eligible,
            authorized,
            authority_generation,
            invalidated_sessions,
        })
    }

    fn revoke_synchronized_authorities(
        &self,
        additional_plugin_ids: &BTreeSet<String>,
    ) -> Result<(), ExecutablePackageError> {
        let mut synchronized = self.lock_synchronized_plugin_ids()?;
        let mut plugin_ids = synchronized.clone();
        plugin_ids.extend(additional_plugin_ids.iter().cloned());
        for plugin_id in plugin_ids {
            self.lifecycle
                .revoke_plugin_authority(&plugin_id)
                .map_err(ExecutablePackageError::authority)?;
        }
        synchronized.clear();
        Ok(())
    }

    pub fn recover_pending(
        &self,
        plugin_id: &str,
    ) -> Result<ExecutablePackageRecoveryAction, ExecutablePackageError> {
        let _operation = self.lock_operations()?;
        self.recover_pending_locked(plugin_id)
    }

    pub fn recover_all_pending(
        &self,
    ) -> Result<Vec<(String, ExecutablePackageRecoveryAction)>, ExecutablePackageError> {
        let _operation = self.lock_operations()?;
        fs::create_dir_all(&self.transactions_root).map_err(|_| metadata_unavailable())?;
        reject_link_or_reparse(&self.transactions_root)?;

        let mut plugin_ids = Vec::new();
        for (index, entry) in fs::read_dir(&self.transactions_root)
            .map_err(|_| metadata_unavailable())?
            .enumerate()
        {
            if index >= MAX_PENDING_TRANSACTION_FILES {
                return Err(transaction_invalid());
            }
            let entry = entry.map_err(|_| metadata_unavailable())?;
            let file_name = entry
                .file_name()
                .into_string()
                .map_err(|_| transaction_invalid())?;
            if file_name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            reject_link_or_reparse(&path)?;
            let plugin_id = path
                .file_stem()
                .and_then(|value| value.to_str())
                .ok_or_else(transaction_invalid)?;
            if path.extension().and_then(|value| value.to_str()) != Some("json")
                || !is_valid_plugin_id(plugin_id)
                || !entry
                    .file_type()
                    .map_err(|_| metadata_unavailable())?
                    .is_file()
            {
                return Err(transaction_invalid());
            }
            plugin_ids.push(plugin_id.to_owned());
        }
        plugin_ids.sort();
        if plugin_ids.windows(2).any(|ids| ids[0] == ids[1]) {
            return Err(transaction_invalid());
        }

        plugin_ids
            .into_iter()
            .map(|plugin_id| {
                self.recover_pending_locked(&plugin_id)
                    .map(|action| (plugin_id, action))
            })
            .collect()
    }

    fn recover_pending_locked(
        &self,
        plugin_id: &str,
    ) -> Result<ExecutablePackageRecoveryAction, ExecutablePackageError> {
        let transaction_path = self.transaction_path(plugin_id)?;
        if !transaction_path.exists() {
            return Ok(ExecutablePackageRecoveryAction::None);
        }
        let transaction = read_transaction(&transaction_path)?;
        if transaction.plugin_id != plugin_id {
            return Err(transaction_invalid());
        }
        validate_transaction(&transaction)?;
        let current_identity = self
            .lifecycle
            .current_identity(plugin_id)
            .map_err(ExecutablePackageError::lifecycle)?;
        let installed_path = self.installed_path(plugin_id)?;
        let action = if current_identity.as_ref() == Some(&transaction.new_identity) {
            self.write_metadata_if_changed(&installed_path, &transaction.new_document)?;
            ExecutablePackageRecoveryAction::Committed
        } else if current_identity == transaction.previous_identity {
            if let Some(previous) = &transaction.previous_document {
                self.write_metadata_if_changed(&installed_path, previous)?;
            } else {
                remove_document_and_backup(&installed_path)?;
            }
            ExecutablePackageRecoveryAction::Aborted
        } else {
            return Err(ExecutablePackageError::new(
                ExecutablePackageErrorCode::RecoveryConflict,
                "The executable install transaction conflicts with current runtime storage.",
            ));
        };
        remove_exact_file(&transaction_path)?;
        Ok(action)
    }

    fn lock_operations(&self) -> Result<MutexGuard<'_, ()>, ExecutablePackageError> {
        self.operation_lock.lock().map_err(|_| {
            ExecutablePackageError::new(
                ExecutablePackageErrorCode::RecoveryConflict,
                "The executable package transaction coordinator is unavailable.",
            )
        })
    }

    fn lock_synchronized_plugin_ids(
        &self,
    ) -> Result<MutexGuard<'_, BTreeSet<String>>, ExecutablePackageError> {
        self.synchronized_plugin_ids.lock().map_err(|_| {
            ExecutablePackageError::new(
                ExecutablePackageErrorCode::AuthoritySyncFailed,
                "Executable plugin authority synchronization failed closed.",
            )
        })
    }

    fn write_metadata_if_changed(
        &self,
        path: &Path,
        expected: &Value,
    ) -> Result<(), ExecutablePackageError> {
        if read_optional_document(path)?.as_ref() == Some(expected) {
            return Ok(());
        }
        (self.metadata_writer)(path, expected)
    }

    fn installed_path(&self, plugin_id: &str) -> Result<PathBuf, ExecutablePackageError> {
        safe_child_path(&self.installed_plugins_root, &format!("{plugin_id}.json"))
    }

    fn transaction_path(&self, plugin_id: &str) -> Result<PathBuf, ExecutablePackageError> {
        if !is_valid_plugin_id(plugin_id) {
            return Err(transaction_invalid());
        }
        safe_child_path(&self.transactions_root, &format!("{plugin_id}.json"))
    }
}

impl ExecutablePackageInspection {
    pub fn review(&self) -> ExecutablePackageReview {
        ExecutablePackageReview {
            schema: NEMOTO_EXECUTABLE_PACKAGE_REVIEW_SCHEMA.to_owned(),
            schema_version: NEMOTO_EXECUTABLE_PACKAGE_REVIEW_SCHEMA_VERSION,
            archive_sha256: self.archive_sha256.clone(),
            identity: self.identity.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            publisher_name: self.publisher_name.clone(),
            requested_capabilities: self.requested_capabilities.clone(),
            module_sha256: self.module_sha256.clone(),
            compressed_bytes: self.compressed_bytes,
            expanded_bytes: self.expanded_bytes,
            contribution_count: self.contribution_count,
            interactive_operations: self.interactive_operations.clone(),
        }
    }

    /// Runs the exact resource-bounded native compiler admission used during
    /// installation without writing plugin metadata or runtime storage.
    pub fn validate_native_wasm(&self) -> Result<WasmAdmissionReceipt, WasmAdmissionError> {
        NativeWasmAdmission::new()?.admit(&self.identity, &self.candidate.module_bytes)
    }
}

fn read_package_file(path: &Path) -> Result<Vec<u8>, ExecutablePackageError> {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("axiom-plugin"))
    {
        return Err(package_unavailable());
    }
    reject_link_or_reparse(path).map_err(|_| package_unavailable())?;
    let metadata = fs::metadata(path).map_err(|_| package_unavailable())?;
    if !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > crate::plugin_package_archive::MAX_PLUGIN_PACKAGE_BYTES as u64
    {
        return Err(package_unavailable());
    }
    let file = File::open(path).map_err(|_| package_unavailable())?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((crate::plugin_package_archive::MAX_PLUGIN_PACKAGE_BYTES as u64) + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| package_unavailable())?;
    if bytes.is_empty() || bytes.len() > crate::plugin_package_archive::MAX_PLUGIN_PACKAGE_BYTES {
        return Err(package_unavailable());
    }
    Ok(bytes)
}

fn read_installed_executable_documents(
    root: &Path,
) -> Result<Vec<NativeInstalledExecutableDocument>, ExecutablePackageError> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    reject_link_or_reparse(root)?;
    let mut paths = Vec::new();
    for (index, entry) in fs::read_dir(root)
        .map_err(|_| metadata_unavailable())?
        .enumerate()
    {
        if index >= MAX_INSTALLED_PLUGIN_FILES {
            return Err(metadata_unavailable());
        }
        let entry = entry.map_err(|_| metadata_unavailable())?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if !entry
            .file_type()
            .map_err(|_| metadata_unavailable())?
            .is_file()
        {
            return Err(metadata_unavailable());
        }
        reject_link_or_reparse(&path)?;
        paths.push(path);
    }
    paths.sort();

    let mut documents = Vec::new();
    for path in paths {
        let raw = read_optional_document(&path)?.ok_or_else(metadata_unavailable)?;
        let plugin_id = raw
            .get("manifest")
            .and_then(|manifest| manifest.get("id"))
            .and_then(Value::as_str)
            .ok_or_else(invalid_manifest)?;
        if raw.get("schema").and_then(Value::as_str) != Some(INSTALLED_PLUGIN_SCHEMA)
            || raw.get("schemaVersion").and_then(Value::as_u64)
                != Some(INSTALLED_PLUGIN_SCHEMA_VERSION as u64)
            || !is_valid_plugin_id(plugin_id)
            || path.file_stem().and_then(|value| value.to_str()) != Some(plugin_id)
        {
            return Err(invalid_manifest());
        }
        if raw
            .get("manifest")
            .and_then(|manifest| manifest.get("runtime"))
            .is_none()
        {
            continue;
        }
        documents.push(parse_installed_executable_document(raw)?);
    }
    if documents
        .windows(2)
        .any(|documents| documents[0].manifest.id == documents[1].manifest.id)
    {
        return Err(invalid_manifest());
    }
    Ok(documents)
}

fn parse_installed_executable_document(
    raw: Value,
) -> Result<NativeInstalledExecutableDocument, ExecutablePackageError> {
    let mut document: NativeInstalledExecutableDocument =
        serde_json::from_value(raw.clone()).map_err(|_| invalid_manifest())?;
    if document.schema != INSTALLED_PLUGIN_SCHEMA
        || document.schema_version != INSTALLED_PLUGIN_SCHEMA_VERSION
        || !document.installed_at.ends_with('Z')
        || DateTime::parse_from_rfc3339(&document.installed_at).is_err()
        || document.granted_capabilities.is_empty()
        || document.granted_capabilities.len() > 32
        || has_duplicates(&document.granted_capabilities)
        || document.granted_capabilities.iter().any(|capability| {
            !KNOWN_CAPABILITIES.contains(&capability.as_str())
                || !document.manifest.capabilities.contains(capability)
        })
        || !document
            .granted_capabilities
            .iter()
            .any(|capability| capability == ISOLATED_COMPUTE_CAPABILITY)
    {
        return Err(invalid_manifest());
    }

    normalize_and_validate_manifest(&mut document.manifest)?;
    for references in document.manifest.contributes.values() {
        for reference in references {
            match document.contributions.get(&reference.path) {
                Some(value) => validate_contribution_binding(reference, value)?,
                None if reference.optional => {}
                None => return Err(invalid_manifest()),
            }
        }
    }
    let bindings = validate_composed_view_admission(&document.manifest, &document.contributions)?;
    let expected_operations = bindings
        .iter()
        .map(|binding| binding.operation.as_str())
        .collect::<BTreeSet<_>>();
    let approved_operations = document
        .approved_interactive_operations
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if approved_operations.len() != document.approved_interactive_operations.len()
        || approved_operations != expected_operations
        || bindings.iter().any(|binding| {
            binding
                .required_capabilities
                .iter()
                .any(|capability| !document.granted_capabilities.contains(capability))
        })
    {
        return Err(invalid_manifest());
    }
    let declared_paths = document
        .manifest
        .contributes
        .values()
        .flatten()
        .map(|reference| reference.path.as_str())
        .collect::<BTreeSet<_>>();
    if document
        .contributions
        .keys()
        .any(|path| !declared_paths.contains(path.as_str()))
        || serde_json::to_value(&document).map_err(|_| invalid_manifest())? != raw
    {
        return Err(invalid_manifest());
    }
    Ok(document)
}

fn validate_activation_snapshot(
    snapshot: &ExecutableActivationSnapshot,
) -> Result<(), ExecutablePackageError> {
    let mut plugin_ids = BTreeSet::new();
    if snapshot.schema != NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA
        || snapshot.schema_version != NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA_VERSION
        || snapshot.requirements.len() > 1_000
        || snapshot.requirements.iter().any(|requirement| {
            !is_valid_plugin_id(&requirement.plugin_id)
                || requirement.version != requirement.version.trim()
                || !valid_version_range(&requirement.version)
                || requirement.data_version == 0
                || !matches!(
                    requirement.requirement.as_str(),
                    "required" | "recommended" | "previously-used"
                )
                || !matches!(requirement.activation.as_str(), "active" | "inactive")
                || (requirement.requirement == "previously-used"
                    && requirement.activation != "inactive")
                || !plugin_ids.insert(requirement.plugin_id.as_str())
        })
    {
        return Err(ExecutablePackageError::new(
            ExecutablePackageErrorCode::ActivationSnapshotInvalid,
            "The executable activation snapshot is invalid.",
        ));
    }
    Ok(())
}

fn normalize_and_validate_manifest(
    manifest: &mut NativeManifest,
) -> Result<(), ExecutablePackageError> {
    manifest.id = manifest.id.trim().to_owned();
    manifest.version = manifest.version.trim().to_owned();
    manifest.name = manifest.name.trim().to_owned();
    manifest.description = manifest.description.trim().to_owned();
    manifest.compatibility.axiom_plugin_api =
        manifest.compatibility.axiom_plugin_api.trim().to_owned();
    manifest.runtime.module = manifest.runtime.module.trim().to_owned();
    if let Some(publisher) = manifest.publisher.as_mut() {
        publisher.name = publisher.name.trim().to_owned();
    }
    if let Some(license) = manifest.license.as_mut() {
        *license = license.trim().to_owned();
    }
    for dependency in &mut manifest.dependencies {
        dependency.id = dependency.id.trim().to_owned();
        dependency.version = dependency.version.trim().to_owned();
    }
    for references in manifest.contributes.values_mut() {
        for reference in references {
            reference.id = reference.id.trim().to_owned();
            reference.path = reference.path.trim().to_owned();
        }
    }

    if manifest.schema != PLUGIN_MANIFEST_SCHEMA
        || manifest.schema_version != PLUGIN_MANIFEST_SCHEMA_VERSION
        || !is_valid_plugin_id(&manifest.id)
        || Version::parse(&manifest.version).is_err()
        || manifest.name.is_empty()
        || manifest.name.len() > 120
        || manifest.description.is_empty()
        || manifest.description.len() > 1_000
        || manifest.categories.len() > 7
        || manifest
            .categories
            .iter()
            .any(|category| !KNOWN_CATEGORIES.contains(&category.as_str()))
        || manifest.data_version == 0
        || manifest.capabilities.len() > 32
        || manifest
            .capabilities
            .iter()
            .any(|capability| !KNOWN_CAPABILITIES.contains(&capability.as_str()))
        || has_duplicates(&manifest.capabilities)
        || !manifest
            .capabilities
            .iter()
            .any(|capability| capability == ISOLATED_COMPUTE_CAPABILITY)
        || !manifest.dependencies.is_empty()
        || !valid_version_range(&manifest.compatibility.axiom_plugin_api)
        || manifest.runtime.schema != NEMOTO_PLUGIN_WASM_RUNTIME_SCHEMA
        || crate::plugin_wasm_storage::validate_plugin_wasm_entrypoint(&manifest.runtime).is_err()
    {
        return Err(invalid_manifest());
    }
    if let Some(publisher) = &manifest.publisher {
        if publisher.name.is_empty()
            || publisher.name.len() > 120
            || publisher
                .url
                .as_deref()
                .is_some_and(|value| Url::parse(value).is_err())
        {
            return Err(invalid_manifest());
        }
    }
    if manifest
        .homepage
        .as_deref()
        .is_some_and(|value| Url::parse(value).is_err())
        || manifest
            .license
            .as_deref()
            .is_some_and(|value| value.is_empty() || value.len() > 80)
    {
        return Err(invalid_manifest());
    }

    let mut contribution_ids = BTreeSet::new();
    let mut contribution_count = 0_usize;
    for (family, references) in &manifest.contributes {
        if !KNOWN_CONTRIBUTION_FAMILIES.contains(&family.as_str()) || references.len() > 1_000 {
            return Err(invalid_manifest());
        }
        for reference in references {
            contribution_count += 1;
            let prefix = format!("{}/", manifest.id);
            let suffix = reference.id.strip_prefix(&prefix).unwrap_or_default();
            if reference.id.len() < 3
                || reference.id.len() > 240
                || !valid_contribution_suffix(suffix)
                || !safe_package_path(&reference.path)
                || !contribution_ids.insert(reference.id.clone())
            {
                return Err(invalid_manifest());
            }
        }
    }
    if contribution_count == 0 {
        return Err(invalid_manifest());
    }
    Ok(())
}

fn validate_approval(
    inspection: &ExecutablePackageInspection,
    approval: &ExecutableInstallApproval,
) -> Result<(), ExecutablePackageError> {
    let expected_operations = inspection
        .interactive_operations
        .iter()
        .map(|binding| binding.operation.as_str())
        .collect::<BTreeSet<_>>();
    let approved_operations = approval
        .approved_interactive_operations
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if approval.schema != NEMOTO_EXECUTABLE_INSTALL_APPROVAL_SCHEMA
        || approval.schema_version != NEMOTO_EXECUTABLE_INSTALL_APPROVAL_SCHEMA_VERSION
        || approval.archive_sha256 != inspection.archive_sha256
        || approval.identity != inspection.identity
        || approval.risk_acknowledgement != ISOLATED_COMPUTE_RISK_ACKNOWLEDGEMENT
        || approval.granted_capabilities.len() > 32
        || has_duplicates(&approval.granted_capabilities)
        || approval
            .granted_capabilities
            .iter()
            .any(|capability| !inspection.requested_capabilities.contains(capability))
        || approval.approved_interactive_operations.len() != approved_operations.len()
        || approved_operations != expected_operations
        || inspection.interactive_operations.iter().any(|binding| {
            binding
                .required_capabilities
                .iter()
                .any(|capability| !approval.granted_capabilities.contains(capability))
        })
    {
        return Err(ExecutablePackageError::new(
            ExecutablePackageErrorCode::ApprovalMismatch,
            "The executable plugin approval does not match the inspected archive.",
        ));
    }
    if !approval
        .granted_capabilities
        .iter()
        .any(|capability| capability == ISOLATED_COMPUTE_CAPABILITY)
    {
        return Err(ExecutablePackageError::new(
            ExecutablePackageErrorCode::ApprovalRequired,
            "Executable plugin installation requires explicit isolated-compute approval.",
        ));
    }
    Ok(())
}

fn parse_native_proposal_command(
    value: Value,
    command_id: &str,
    document: &NativeInstalledExecutableDocument,
) -> Result<NativeProposalCommandContribution, ExecutablePackageError> {
    let command: NativeProposalCommandContribution =
        serde_json::from_value(value).map_err(|_| invalid_proposal_command())?;
    let expected_prefix = format!("{}/", document.manifest.id);
    let mut normalized_keywords = BTreeSet::new();
    if command.schema != "axiom.plugin.command"
        || command.schema_version != 1
        || command.id != command_id
        || !command.id.starts_with(&expected_prefix)
        || command.title.trim().is_empty()
        || command.title.chars().count() > 120
        || command.description.as_ref().is_some_and(|description| {
            description.trim().is_empty() || description.chars().count() > 500
        })
        || command.keywords.len() > 20
        || command.keywords.iter().any(|keyword| {
            let normalized = keyword.trim().to_lowercase();
            keyword.trim().is_empty()
                || keyword.chars().count() > 80
                || !normalized_keywords.insert(normalized)
        })
        || command.placement != "omnibox"
        || command.order > 1_000
        || command.action.kind != "compute.propose"
        || validate_stable_contract_id(&command.action.operation).is_err()
        || !is_supported_proposal_command_context(&command.action.context.kind)
        || serde_json::to_vec(&command.action.parameters)
            .ok()
            .is_none_or(|encoded| encoded.len() > 64 * 1024)
    {
        return Err(invalid_proposal_command());
    }
    Ok(command)
}

fn is_supported_proposal_command_context(kind: &str) -> bool {
    matches!(
        kind,
        ACTIVE_PROCESS_COMMAND_CONTEXT | SELECTED_ENTITY_COMMAND_CONTEXT
    )
}

fn validate_proposal_command_request(
    request: &WasmComputeRequest,
    command: &NativeProposalCommandContribution,
) -> Result<(), ExecutablePackageError> {
    let parameters: NativeProposalCommandParameters =
        serde_json::from_value(request.parameters.clone())
            .map_err(|_| invalid_proposal_command())?;
    let context_matches = match command.action.context.kind.as_str() {
        ACTIVE_PROCESS_COMMAND_CONTEXT => request
            .snapshots
            .first()
            .is_some_and(|snapshot| snapshot.reference.kind == "core.process"),
        SELECTED_ENTITY_COMMAND_CONTEXT => !request.snapshots.is_empty(),
        _ => false,
    };
    if request.snapshots.len() != 1
        || !context_matches
        || parameters.invocation_id != request.request_id
        || !parameters.observed_at.ends_with('Z')
        || DateTime::parse_from_rfc3339(&parameters.observed_at).is_err()
        || parameters.input != command.action.parameters
    {
        return Err(invalid_proposal_command());
    }
    Ok(())
}

fn validate_proposal_command_result(
    result: &WasmComputeResult,
    command_id: &str,
) -> Result<(), ExecutablePackageError> {
    let draft = result
        .proposal_draft
        .as_ref()
        .ok_or_else(invalid_proposal_command)?;
    let origin = draft
        .origin
        .as_object()
        .ok_or_else(invalid_proposal_command)?;
    if !(1..=2).contains(&draft.proposal_schema_version)
        || origin.len() != 2
        || origin.get("kind").and_then(Value::as_str) != Some("plugin")
        || origin.get("contributionId").and_then(Value::as_str) != Some(command_id)
    {
        return Err(invalid_proposal_command());
    }
    Ok(())
}

fn invalid_proposal_command() -> ExecutablePackageError {
    ExecutablePackageError::new(
        ExecutablePackageErrorCode::ProposalCommandInvalid,
        "The executable proposal command is invalid or unavailable.",
    )
}

fn invalid_ui_reduction() -> ExecutablePackageError {
    ExecutablePackageError::new(
        ExecutablePackageErrorCode::UiReductionInvalid,
        "The executable plugin UI view or reduction request is invalid or unavailable.",
    )
}

fn default_command_order() -> u32 {
    500
}

fn empty_json_object() -> Value {
    Value::Object(serde_json::Map::new())
}

fn validate_composed_view_admission(
    manifest: &NativeManifest,
    contributions: &BTreeMap<String, Value>,
) -> Result<Vec<InteractiveOperationBinding>, ExecutablePackageError> {
    let mut views = BTreeMap::new();
    for reference in manifest.contributes.get("views").into_iter().flatten() {
        if let Some(value) = contributions.get(&reference.path) {
            views.insert(reference.id.as_str(), value);
        }
    }
    let has_composed = views
        .values()
        .any(|view| view.get("renderer").and_then(Value::as_str) == Some("composed-view"));
    if !has_composed {
        return Ok(Vec::new());
    }
    if !version_range_excludes_versions_below(
        &manifest.compatibility.axiom_plugin_api,
        PLUGIN_UI_MINIMUM_HOST_API,
    ) || !satisfies_version_range(
        PLUGIN_UI_MINIMUM_HOST_API,
        &manifest.compatibility.axiom_plugin_api,
    ) {
        return Err(invalid_manifest());
    }

    let mut operations = BTreeSet::new();
    let mut bindings = Vec::new();
    for value in views
        .values()
        .filter(|view| view.get("renderer").and_then(Value::as_str) == Some("composed-view"))
    {
        let view: NativeComposedViewContribution =
            serde_json::from_value((*value).clone()).map_err(|_| invalid_manifest())?;
        if view.schema != "axiom.plugin.view"
            || view.schema_version != 1
            || view.renderer != "composed-view"
            || !view.id.starts_with(&format!("{}/", manifest.id))
            || validate_stable_contract_id(&view.operation).is_err()
            || !operations.insert(view.operation.clone())
            || !view
                .storage_view_id
                .starts_with(&format!("{}/", manifest.id))
            || !valid_composed_navigation(&view.navigation)
            || view.ui.validate().is_err()
        {
            return Err(invalid_manifest());
        }
        let storage_view = views
            .get(view.storage_view_id.as_str())
            .ok_or_else(invalid_manifest)?;
        if storage_view.get("schema").and_then(Value::as_str) != Some("axiom.plugin.view")
            || storage_view.get("schemaVersion").and_then(Value::as_u64) != Some(1)
            || storage_view.get("id").and_then(Value::as_str) != Some(view.storage_view_id.as_str())
            || storage_view.get("renderer").and_then(Value::as_str) != Some("collection-list")
            || !storage_view.get("collection").is_some_and(Value::is_object)
        {
            return Err(invalid_manifest());
        }
        let required_capabilities = required_capabilities_for_composed_view(&view);
        if required_capabilities
            .iter()
            .any(|capability| !manifest.capabilities.contains(capability))
        {
            return Err(invalid_manifest());
        }
        bindings.push(InteractiveOperationBinding {
            view_id: view.id,
            operation: view.operation,
            required_capabilities: required_capabilities.into_iter().collect(),
        });
    }
    bindings.sort_by(|left, right| left.view_id.cmp(&right.view_id));
    Ok(bindings)
}

fn required_capabilities_for_composed_view(
    view: &NativeComposedViewContribution,
) -> BTreeSet<String> {
    let mut required = BTreeSet::from([ISOLATED_COMPUTE_CAPABILITY.to_owned()]);
    for effect in &view.ui.required_effects {
        for capability in required_capabilities_for_ui_effect(effect) {
            required.insert((*capability).to_owned());
        }
    }
    required
}

fn valid_composed_navigation(navigation: &NativeComposedViewNavigation) -> bool {
    navigation.surface == "app-rail"
        && !navigation.label.trim().is_empty()
        && navigation.label.chars().count() <= 80
        && matches!(
            navigation.icon.as_str(),
            "GraduationCap" | "ShieldCheck" | "ClipboardCheck" | "Puzzle"
        )
        && navigation.order <= 1_000
}

fn required_capabilities_for_ui_effect(effect: &str) -> &'static [&'static str] {
    match effect {
        "read.search" | "read.entity" | "read.relations" | "workspace.context" => {
            &["portfolio.read-scoped"]
        }
        "storage.collection.query-page" => &["portfolio.read-scoped"],
        "storage.collection.transact" | "storage.document.transact" => &["plugin-data.write"],
        "workspace.open" => &["workspace.navigate"],
        "output.text-file" => &["file.write-selected"],
        "output.clipboard-text" => &["clipboard.write"],
        _ => &[],
    }
}

fn validate_contribution_binding(
    reference: &ManifestContributionReference,
    value: &Value,
) -> Result<(), ExecutablePackageError> {
    let contribution = value.as_object().ok_or_else(invalid_manifest)?;
    if contribution.get("id").and_then(Value::as_str) != Some(reference.id.as_str())
        || contribution.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || !contribution
            .get("schema")
            .and_then(Value::as_str)
            .is_some_and(|schema| schema.starts_with("axiom.plugin."))
    {
        return Err(invalid_manifest());
    }
    Ok(())
}

fn validate_existing_state(
    previous_document: Option<&Value>,
    previous_runtime_identity: Option<&WasmPluginIdentity>,
    inspection: &ExecutablePackageInspection,
) -> Result<(), ExecutablePackageError> {
    let previous_document_identity = previous_document
        .map(installed_document_identity)
        .transpose()?;
    let previous_document_executable = previous_document
        .and_then(|document| document.get("manifest"))
        .and_then(|manifest| manifest.get("runtime"))
        .is_some();
    if previous_document_executable
        && previous_document_identity.as_ref() != previous_runtime_identity
        || previous_runtime_identity.is_some() && !previous_document_executable
    {
        return Err(ExecutablePackageError::new(
            ExecutablePackageErrorCode::RecoveryConflict,
            "Installed executable metadata and runtime storage do not match.",
        ));
    }
    let Some(previous_identity) = previous_document_identity else {
        return Ok(());
    };
    if previous_identity == inspection.identity {
        let same_manifest = previous_document.and_then(|document| document.get("manifest"))
            == Some(&inspection.normalized_manifest);
        let same_contributions = previous_document
            .and_then(|document| document.get("contributions"))
            == Some(
                &serde_json::to_value(&inspection.contributions).map_err(|_| invalid_manifest())?,
            );
        if !same_manifest || !same_contributions {
            return Err(ExecutablePackageError::new(
                ExecutablePackageErrorCode::UpdateRejected,
                "The same plugin identity cannot replace installed package content.",
            ));
        }
        return Ok(());
    }
    let previous_version =
        Version::parse(&previous_identity.plugin_version).map_err(|_| invalid_manifest())?;
    let candidate_version =
        Version::parse(&inspection.identity.plugin_version).map_err(|_| invalid_manifest())?;
    if candidate_version <= previous_version
        || inspection.identity.data_version < previous_identity.data_version
    {
        return Err(ExecutablePackageError::new(
            ExecutablePackageErrorCode::UpdateRejected,
            "Executable package installation must move forward without lowering its data version.",
        ));
    }
    Ok(())
}

fn installed_document_identity(
    document: &Value,
) -> Result<WasmPluginIdentity, ExecutablePackageError> {
    if document.get("schema").and_then(Value::as_str) != Some(INSTALLED_PLUGIN_SCHEMA)
        || document.get("schemaVersion").and_then(Value::as_u64)
            != Some(INSTALLED_PLUGIN_SCHEMA_VERSION as u64)
    {
        return Err(invalid_manifest());
    }
    let manifest = document.get("manifest").ok_or_else(invalid_manifest)?;
    let plugin_id = manifest
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(invalid_manifest)?;
    let plugin_version = manifest
        .get("version")
        .and_then(Value::as_str)
        .ok_or_else(invalid_manifest)?;
    let data_version = manifest
        .get("dataVersion")
        .and_then(Value::as_u64)
        .unwrap_or(1);
    if !is_valid_plugin_id(plugin_id)
        || Version::parse(plugin_version).is_err()
        || data_version == 0
        || data_version > u32::MAX as u64
    {
        return Err(invalid_manifest());
    }
    Ok(WasmPluginIdentity {
        plugin_id: plugin_id.to_owned(),
        plugin_version: plugin_version.to_owned(),
        data_version: data_version as u32,
    })
}

fn validate_transaction(transaction: &InstallTransaction) -> Result<(), ExecutablePackageError> {
    if transaction.schema != NEMOTO_EXECUTABLE_INSTALL_TRANSACTION_SCHEMA
        || transaction.schema_version != NEMOTO_EXECUTABLE_INSTALL_TRANSACTION_SCHEMA_VERSION
        || transaction.transaction_id.len() != 32
        || !transaction
            .transaction_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        || !valid_sha256(&transaction.archive_sha256)
        || !valid_sha256(&transaction.new_document_sha256)
        || transaction.plugin_id != transaction.new_identity.plugin_id
        || installed_document_identity(&transaction.new_document)? != transaction.new_identity
        || canonical_document_hash(&transaction.new_document)? != transaction.new_document_sha256
        || transaction.previous_document.is_some() != transaction.previous_document_sha256.is_some()
    {
        return Err(transaction_invalid());
    }
    if let (Some(document), Some(expected_hash)) = (
        transaction.previous_document.as_ref(),
        transaction.previous_document_sha256.as_ref(),
    ) {
        if !valid_sha256(expected_hash)
            || installed_document_identity(document)?.plugin_id != transaction.plugin_id
            || canonical_document_hash(document)? != *expected_hash
        {
            return Err(transaction_invalid());
        }
    }
    if transaction
        .previous_identity
        .as_ref()
        .is_some_and(|identity| identity.plugin_id != transaction.plugin_id)
    {
        return Err(transaction_invalid());
    }
    Ok(())
}

fn write_transaction(
    path: &Path,
    transaction: &InstallTransaction,
) -> Result<(), ExecutablePackageError> {
    validate_transaction(transaction)?;
    let bytes = serde_json::to_vec_pretty(transaction).map_err(|_| transaction_invalid())?;
    atomic_write_verified(path, &bytes, false, |candidate| {
        let parsed: InstallTransaction = serde_json::from_slice(&fs::read(candidate)?)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
        if parsed != *transaction {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "install transaction verification failed",
            ));
        }
        Ok(())
    })
    .map_err(|_| metadata_unavailable())
}

fn read_transaction(path: &Path) -> Result<InstallTransaction, ExecutablePackageError> {
    reject_link_or_reparse(path)?;
    let metadata = fs::metadata(path).map_err(|_| metadata_unavailable())?;
    if metadata.len() == 0 || metadata.len() > MAX_TRANSACTION_BYTES {
        return Err(transaction_invalid());
    }
    let transaction = serde_json::from_slice(&fs::read(path).map_err(|_| metadata_unavailable())?)
        .map_err(|_| transaction_invalid())?;
    Ok(transaction)
}

fn read_optional_document(path: &Path) -> Result<Option<Value>, ExecutablePackageError> {
    if !path.exists() {
        return Ok(None);
    }
    reject_link_or_reparse(path)?;
    let metadata = fs::metadata(path).map_err(|_| metadata_unavailable())?;
    if metadata.len() == 0 || metadata.len() > MAX_INSTALLED_PLUGIN_BYTES as u64 {
        return Err(metadata_unavailable());
    }
    serde_json::from_slice(&fs::read(path).map_err(|_| metadata_unavailable())?)
        .map(Some)
        .map_err(|_| invalid_manifest())
}

fn write_document(path: &Path, document: &Value) -> Result<(), ExecutablePackageError> {
    if path.exists() {
        reject_link_or_reparse(path)?;
    }
    let encoded = serde_json::to_vec_pretty(document).map_err(|_| invalid_manifest())?;
    if encoded.len() > MAX_INSTALLED_PLUGIN_BYTES {
        return Err(metadata_unavailable());
    }
    atomic_write_verified(path, &encoded, true, |candidate| {
        let parsed: Value = serde_json::from_slice(&fs::read(candidate)?)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
        if parsed != *document {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "installed plugin document verification failed",
            ));
        }
        Ok(())
    })
    .map_err(|_| metadata_unavailable())
}

fn encode_document(document: &Value) -> Result<Vec<u8>, ExecutablePackageError> {
    let encoded = serde_json::to_vec(document).map_err(|_| invalid_manifest())?;
    if encoded.len() > MAX_INSTALLED_PLUGIN_BYTES {
        return Err(metadata_unavailable());
    }
    Ok(encoded)
}

fn canonical_document_hash(document: &Value) -> Result<String, ExecutablePackageError> {
    encode_document(document).map(|bytes| sha256(&bytes))
}

fn remove_document_and_backup(path: &Path) -> Result<(), ExecutablePackageError> {
    remove_exact_file(path)?;
    remove_exact_file(&backup_path(path))
}

fn remove_exact_file(path: &Path) -> Result<(), ExecutablePackageError> {
    if !path.exists() {
        return Ok(());
    }
    reject_link_or_reparse(path)?;
    fs::remove_file(path).map_err(|_| metadata_unavailable())
}

fn safe_child_path(root: &Path, file_name: &str) -> Result<PathBuf, ExecutablePackageError> {
    fs::create_dir_all(root).map_err(|_| metadata_unavailable())?;
    reject_link_or_reparse(root)?;
    let canonical_root = fs::canonicalize(root).map_err(|_| metadata_unavailable())?;
    let path = root.join(file_name);
    let parent = path.parent().ok_or_else(metadata_unavailable)?;
    if fs::canonicalize(parent).map_err(|_| metadata_unavailable())? != canonical_root {
        return Err(metadata_unavailable());
    }
    if path.exists() {
        reject_link_or_reparse(&path)?;
    }
    Ok(path)
}

fn reject_link_or_reparse(path: &Path) -> Result<(), ExecutablePackageError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| metadata_unavailable())?;
    if metadata.file_type().is_symlink() {
        return Err(metadata_unavailable());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(metadata_unavailable());
        }
    }
    Ok(())
}

fn safe_package_path(path: &str) -> bool {
    let segments = path.split('/').collect::<Vec<_>>();
    !path.is_empty()
        && path.len() <= 240
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains('\0')
        && !path.contains(':')
        && segments
            .iter()
            .all(|segment| !segment.is_empty() && *segment != "." && *segment != "..")
}

fn valid_contribution_suffix(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.first().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'.' | b'_' | b'/' | b'-')
        })
}

fn valid_version_range(value: &str) -> bool {
    if value.is_empty() || value.len() > 100 {
        return false;
    }
    value.split("||").all(|alternative| {
        let tokens = alternative.split_whitespace().collect::<Vec<_>>();
        !tokens.is_empty() && tokens.into_iter().all(valid_version_token)
    })
}

fn valid_version_token(token: &str) -> bool {
    if token == "*" {
        return true;
    }
    let stripped_operator = [">=", "<=", ">", "<", "=", "^", "~"]
        .iter()
        .find_map(|prefix| token.strip_prefix(prefix))
        .unwrap_or(token);
    let version = stripped_operator
        .strip_prefix('v')
        .unwrap_or(stripped_operator);
    if version.is_empty() || version.contains('+') {
        return false;
    }
    let (main, prerelease) = version
        .split_once('-')
        .map_or((version, None), |(left, right)| (left, Some(right)));
    let parts = main.split('.').collect::<Vec<_>>();
    let valid_number = |part: &&str| {
        !part.is_empty()
            && part.bytes().all(|byte| byte.is_ascii_digit())
            && (*part == "0" || !part.starts_with('0'))
            && part.parse::<u64>().is_ok()
    };
    (1..=3).contains(&parts.len())
        && parts.iter().all(valid_number)
        && prerelease.is_none_or(|value| {
            parts.len() == 3
                && !value.is_empty()
                && value.split('.').all(|identifier| {
                    !identifier.is_empty()
                        && identifier
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                })
        })
}

#[derive(Debug, Clone)]
struct PartialVersion {
    version: Version,
    precision: usize,
}

fn parse_partial_version(value: &str) -> Option<PartialVersion> {
    let value = value.strip_prefix('v').unwrap_or(value);
    let (main, prerelease) = value
        .split_once('-')
        .map_or((value, None), |(left, right)| (left, Some(right)));
    let parts = main.split('.').collect::<Vec<_>>();
    if !(1..=3).contains(&parts.len()) || prerelease.is_some() && parts.len() != 3 {
        return None;
    }
    let mut normalized = main.to_owned();
    while normalized.split('.').count() < 3 {
        normalized.push_str(".0");
    }
    if let Some(prerelease) = prerelease {
        normalized.push('-');
        normalized.push_str(prerelease);
    }
    Some(PartialVersion {
        version: Version::parse(&normalized).ok()?,
        precision: parts.len(),
    })
}

fn next_major(version: &Version) -> Option<Version> {
    Some(Version::new(version.major.checked_add(1)?, 0, 0))
}

fn next_minor(version: &Version) -> Option<Version> {
    Some(Version::new(
        version.major,
        version.minor.checked_add(1)?,
        0,
    ))
}

fn partial_upper_bound(target: &PartialVersion) -> Option<Version> {
    if target.precision == 1 {
        next_major(&target.version)
    } else {
        next_minor(&target.version)
    }
}

fn caret_upper_bound(target: &PartialVersion) -> Option<Version> {
    if target.version.major > 0 {
        next_major(&target.version)
    } else if target.version.minor > 0 {
        next_minor(&target.version)
    } else {
        Some(Version::new(0, 0, target.version.patch.checked_add(1)?))
    }
}

fn satisfies_version_token(version: &Version, token: &str) -> bool {
    if token == "*" {
        return true;
    }
    let (operator, target_text) = [">=", "<=", ">", "<", "=", "^", "~"]
        .iter()
        .find_map(|operator| {
            token
                .strip_prefix(operator)
                .map(|target| (*operator, target))
        })
        .unwrap_or(("", token));
    let Some(target) = parse_partial_version(target_text) else {
        return false;
    };
    match operator {
        ">=" => version >= &target.version,
        "<=" => version <= &target.version,
        ">" => version > &target.version,
        "<" => version < &target.version,
        "=" => version == &target.version,
        "^" => caret_upper_bound(&target)
            .is_some_and(|upper| version >= &target.version && version < &upper),
        "~" => partial_upper_bound(&target)
            .is_some_and(|upper| version >= &target.version && version < &upper),
        "" if target.precision == 3 => version == &target.version,
        "" => partial_upper_bound(&target)
            .is_some_and(|upper| version >= &target.version && version < &upper),
        _ => false,
    }
}

fn satisfies_version_range(version: &str, range: &str) -> bool {
    let Ok(mut version) = Version::parse(version) else {
        return false;
    };
    version.build = BuildMetadata::EMPTY;
    valid_version_range(range)
        && range.split("||").any(|alternative| {
            alternative
                .split_whitespace()
                .all(|token| satisfies_version_token(&version, token))
        })
}

fn version_range_excludes_versions_below(range: &str, minimum: &str) -> bool {
    let Ok(minimum) = Version::parse(minimum) else {
        return false;
    };
    valid_version_range(range)
        && range.split("||").all(|alternative| {
            alternative.split_whitespace().any(|token| {
                if token == "*" || token.starts_with('<') {
                    return false;
                }
                let target = [">=", "<=", ">", "<", "=", "^", "~"]
                    .iter()
                    .find_map(|operator| token.strip_prefix(operator))
                    .unwrap_or(token);
                parse_partial_version(target).is_some_and(|target| target.version >= minimum)
            })
        })
}

fn is_executable_path(path: &str) -> bool {
    path.rsplit_once('.').is_some_and(|(_, extension)| {
        EXECUTABLE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
    })
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn has_duplicates(values: &[String]) -> bool {
    let mut seen = BTreeSet::new();
    values.iter().any(|value| !seen.insert(value))
}

fn default_data_version() -> u32 {
    1
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn invalid_manifest() -> ExecutablePackageError {
    ExecutablePackageError::new(
        ExecutablePackageErrorCode::ManifestInvalid,
        "The executable plugin manifest or contributions are invalid.",
    )
}

fn metadata_unavailable() -> ExecutablePackageError {
    ExecutablePackageError::new(
        ExecutablePackageErrorCode::MetadataUnavailable,
        "Executable plugin installed metadata is unavailable.",
    )
}

fn transaction_invalid() -> ExecutablePackageError {
    ExecutablePackageError::new(
        ExecutablePackageErrorCode::TransactionInvalid,
        "The executable plugin install transaction is invalid.",
    )
}

fn package_unavailable() -> ExecutablePackageError {
    ExecutablePackageError::new(
        ExecutablePackageErrorCode::PackageUnavailable,
        "The selected executable plugin package is unavailable or unsupported.",
    )
}

#[cfg(test)]
mod tests {
    use std::{
        io::Write,
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        },
    };

    use flate2::{write::DeflateEncoder, Compression};

    use super::*;
    use crate::{
        plugin_compute_policy::ISOLATED_COMPUTE_POLICY_V1,
        plugin_wasm_admission::{
            module_sha256, WasmAdmissionError, WasmAdmissionReceipt, NEMOTO_WASM_ADMISSION_SCHEMA,
            NEMOTO_WASM_ADMISSION_SCHEMA_VERSION, WASM_COMPILER_CPU_TIME_LIMIT_MS,
            WASM_COMPILER_MEMORY_LIMIT_BYTES, WASM_COMPILER_WALL_DEADLINE_MS,
        },
        plugin_wasm_data_plane::{
            WasmEntityLocation, WasmEntityReference, WasmEntitySnapshot,
            NEMOTO_ENTITY_REFERENCE_SCHEMA, NEMOTO_ENTITY_REFERENCE_SCHEMA_VERSION,
            NEMOTO_PLUGIN_ENTITY_SNAPSHOT_SCHEMA, NEMOTO_PLUGIN_ENTITY_SNAPSHOT_SCHEMA_VERSION,
            NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA, NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA_VERSION,
        },
        plugin_wasm_host::{NEMOTO_WASM_ABI_NAME, NEMOTO_WASM_ABI_VERSION, WASMTIME_ENGINE_VERSION},
    };

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
            Ok(WasmAdmissionReceipt {
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
            })
        }
    }

    fn push_u16(target: &mut Vec<u8>, value: u16) {
        target.extend_from_slice(&value.to_le_bytes());
    }

    fn push_u32(target: &mut Vec<u8>, value: u32) {
        target.extend_from_slice(&value.to_le_bytes());
    }

    fn zip(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let mut output = Vec::new();
        let mut central = Vec::new();
        for (name, content) in entries {
            let offset = output.len() as u32;
            let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
            encoder.write_all(content).unwrap();
            let compressed = encoder.finish().unwrap();
            let crc = crc32fast::hash(content);
            push_u32(&mut output, 0x0403_4b50);
            push_u16(&mut output, 20);
            push_u16(&mut output, 0);
            push_u16(&mut output, 8);
            push_u16(&mut output, 0);
            push_u16(&mut output, 0);
            push_u32(&mut output, crc);
            push_u32(&mut output, compressed.len() as u32);
            push_u32(&mut output, content.len() as u32);
            push_u16(&mut output, name.len() as u16);
            push_u16(&mut output, 0);
            output.extend_from_slice(name.as_bytes());
            output.extend_from_slice(&compressed);

            push_u32(&mut central, 0x0201_4b50);
            push_u16(&mut central, 20);
            push_u16(&mut central, 20);
            push_u16(&mut central, 0);
            push_u16(&mut central, 8);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u32(&mut central, crc);
            push_u32(&mut central, compressed.len() as u32);
            push_u32(&mut central, content.len() as u32);
            push_u16(&mut central, name.len() as u16);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u32(&mut central, 0);
            push_u32(&mut central, offset);
            central.extend_from_slice(name.as_bytes());
        }
        let central_offset = output.len() as u32;
        let central_size = central.len() as u32;
        output.extend_from_slice(&central);
        push_u32(&mut output, 0x0605_4b50);
        push_u16(&mut output, 0);
        push_u16(&mut output, 0);
        push_u16(&mut output, entries.len() as u16);
        push_u16(&mut output, entries.len() as u16);
        push_u32(&mut output, central_size);
        push_u32(&mut output, central_offset);
        push_u16(&mut output, 0);
        output
    }

    fn module() -> Vec<u8> {
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

    fn result_module(result: &Value) -> Vec<u8> {
        let bytes = serde_json::to_vec(result).unwrap();
        let escaped = bytes
            .iter()
            .map(|byte| format!("\\{:02x}", byte))
            .collect::<String>();
        wat::parse_str(format!(
            r#"(module
                (memory (export "memory") 5 1024)
                (global $heap (mut i32) (i32.const 1024))
                (data (i32.const 262144) "{escaped}")
                (func (export "axiom_abi_version") (result i32) i32.const 1)
                (func (export "axiom_alloc") (param $len i32) (result i32)
                    global.get $heap
                    global.get $heap
                    local.get $len
                    i32.add
                    global.set $heap)
                (func (export "axiom_run") (param i32 i32) (result i64)
                    i64.const {}) )"#,
            ((262144_u64) << 32) | bytes.len() as u64
        ))
        .unwrap()
    }

    fn infinite_module() -> Vec<u8> {
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
                (func (export "axiom_run") (param i32 i32) (result i64)
                    (loop $forever br $forever)
                    i64.const 0))"#,
        )
        .unwrap()
    }

    fn package(extra: &[(&str, Vec<u8>)]) -> Vec<u8> {
        package_with_contribution(
            br#"{"schema":"axiom.plugin.analysis","schemaVersion":1,"id":"org.axiom.executable-fixture/risk"}"#.to_vec(),
            extra,
        )
    }

    fn package_with_contribution(contribution: Vec<u8>, extra: &[(&str, Vec<u8>)]) -> Vec<u8> {
        package_with_contribution_and_api(contribution, extra, "^1.0.0")
    }

    fn package_with_contribution_and_api(
        contribution: Vec<u8>,
        extra: &[(&str, Vec<u8>)],
        api_range: &str,
    ) -> Vec<u8> {
        package_with_contribution_api_and_version(contribution, extra, api_range, "1.0.0")
    }

    fn package_with_contribution_api_and_version(
        contribution: Vec<u8>,
        extra: &[(&str, Vec<u8>)],
        api_range: &str,
        version: &str,
    ) -> Vec<u8> {
        let manifest = serde_json::json!({
            "schema": "axiom.plugin",
            "schemaVersion": 1,
            "id": "org.axiom.executable-fixture",
            "version": version,
            "name": "Executable fixture",
            "description": "Native adapter fixture.",
            "categories": ["method"],
            "publisher": { "name": "Axiom tests" },
            "compatibility": { "axiomPluginApi": api_range },
            "dataVersion": 1,
            "capabilities": ["compute.isolated", "portfolio.read-scoped", "proposal.create"],
            "dependencies": [],
            "runtime": {
                "schema": "axiom.plugin-wasm-runtime",
                "schemaVersion": 1,
                "abi": "axiom-wasm-v1",
                "module": "runtime/plugin.wasm"
            },
            "contributes": {
                "analyses": [{
                    "id": "org.axiom.executable-fixture/risk",
                    "path": "contributions/risk.analysis.json"
                }]
            }
        });
        let mut entries = vec![
            ("manifest.json", serde_json::to_vec(&manifest).unwrap()),
            ("runtime/plugin.wasm", module()),
            ("contributions/risk.analysis.json", contribution),
        ];
        entries.extend_from_slice(extra);
        zip(&entries)
    }

    fn ui_admission_fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../fixtures/plugins/protocol/ui-admission-v1.json"
        ))
        .unwrap()
    }

    fn composed_package(case: &Value) -> Vec<u8> {
        composed_package_with_module(case, module())
    }

    fn composed_package_with_module(case: &Value, guest_module: Vec<u8>) -> Vec<u8> {
        let fixture = ui_admission_fixture();
        let mut manifest = fixture["manifest"].clone();
        manifest["compatibility"]["axiomPluginApi"] = case["apiRange"].clone();
        manifest["capabilities"] = case["capabilities"].clone();
        let mut view = fixture["composedView"].clone();
        view["operation"] = case["operation"].clone();
        view["storageViewId"] = case["storageViewId"].clone();
        view["ui"]["requiredPrimitives"] = case["requiredPrimitives"].clone();
        view["ui"]["requiredEffects"] = case["requiredEffects"].clone();
        let mut entries = vec![
            ("manifest.json", serde_json::to_vec(&manifest).unwrap()),
            ("runtime/plugin.wasm", guest_module),
            (
                "contributions/legacy.view.json",
                serde_json::to_vec(&fixture["legacyView"]).unwrap(),
            ),
            (
                "contributions/composed.view.json",
                serde_json::to_vec(&view).unwrap(),
            ),
        ];
        if case["duplicateOperation"] == true {
            let mut second = view;
            second["id"] = serde_json::json!("org.axiom.ui-fixture/composed-two");
            manifest["contributes"]["views"]
                .as_array_mut()
                .unwrap()
                .push(serde_json::json!({
                    "id": "org.axiom.ui-fixture/composed-two",
                    "path": "contributions/composed-two.view.json"
                }));
            entries[0].1 = serde_json::to_vec(&manifest).unwrap();
            entries.push((
                "contributions/composed-two.view.json",
                serde_json::to_vec(&second).unwrap(),
            ));
        }
        zip(&entries)
    }

    fn approval(inspection: &ExecutablePackageInspection) -> ExecutableInstallApproval {
        ExecutableInstallApproval {
            schema: NEMOTO_EXECUTABLE_INSTALL_APPROVAL_SCHEMA.to_owned(),
            schema_version: NEMOTO_EXECUTABLE_INSTALL_APPROVAL_SCHEMA_VERSION,
            archive_sha256: inspection.archive_sha256.clone(),
            identity: inspection.identity.clone(),
            granted_capabilities: vec![ISOLATED_COMPUTE_CAPABILITY.to_owned()],
            risk_acknowledgement: ISOLATED_COMPUTE_RISK_ACKNOWLEDGEMENT.to_owned(),
            approved_interactive_operations: inspection
                .interactive_operations
                .iter()
                .map(|binding| binding.operation.clone())
                .collect(),
        }
    }

    fn adapter(root: &Path) -> ExecutablePackageAdapter<FakeAdmission> {
        let lifecycle =
            NemotoWasmLifecycle::with_admission(root.join("runtime"), FakeAdmission::default())
                .unwrap();
        ExecutablePackageAdapter::with_lifecycle(
            Arc::new(lifecycle),
            root.join("plugins"),
            root.join("transactions"),
        )
    }

    fn adapter_with_execution_policy(
        root: &Path,
        execution_enabled: bool,
    ) -> ExecutablePackageAdapter<FakeAdmission> {
        let lifecycle =
            NemotoWasmLifecycle::with_admission(root.join("runtime"), FakeAdmission::default())
                .unwrap();
        ExecutablePackageAdapter::with_lifecycle_and_execution_policy(
            Arc::new(lifecycle),
            root.join("plugins"),
            root.join("transactions"),
            execution_enabled,
        )
    }

    fn ui_adapter(root: &Path) -> ExecutablePackageAdapter<FakeAdmission> {
        let lifecycle =
            NemotoWasmLifecycle::with_admission(root.join("runtime"), FakeAdmission::default())
                .unwrap();
        ExecutablePackageAdapter::with_lifecycle_execution_policy_and_api(
            Arc::new(lifecycle),
            root.join("plugins"),
            root.join("transactions"),
            true,
            PLUGIN_UI_MINIMUM_HOST_API,
        )
    }

    fn ui_activation_snapshot(activation: &str) -> ExecutableActivationSnapshot {
        ExecutableActivationSnapshot {
            schema: NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA.to_owned(),
            schema_version: NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA_VERSION,
            requirements: vec![ExecutablePortfolioRequirement {
                plugin_id: "org.axiom.ui-fixture".to_owned(),
                version: "=1.0.0".to_owned(),
                data_version: 1,
                requirement: "recommended".to_owned(),
                activation: activation.to_owned(),
            }],
        }
    }

    fn ui_request(input: Value) -> ExecutableUiReductionRequest {
        ExecutableUiReductionRequest {
            schema: "axiom.executable-plugin-ui-reduction".to_owned(),
            schema_version: 1,
            view_id: "org.axiom.ui-fixture/composed".to_owned(),
            input_json: serde_json::to_string(&input).unwrap(),
        }
    }

    fn install_and_activate_ui_guest(
        adapter: &ExecutablePackageAdapter<FakeAdmission>,
        guest_module: Vec<u8>,
    ) {
        let fixture = ui_admission_fixture();
        let archive = composed_package_with_module(&fixture["cases"][0], guest_module);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
        let mut install_approval = approval(&inspection);
        install_approval.granted_capabilities = inspection.requested_capabilities.clone();
        adapter.install(inspection, install_approval).unwrap();
        let synchronized = adapter
            .synchronize_authority(ui_activation_snapshot("active"))
            .unwrap();
        assert!(synchronized.decisions[0].authorized);
    }

    fn activation_snapshot(activation: &str, version: &str) -> ExecutableActivationSnapshot {
        ExecutableActivationSnapshot {
            schema: NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA.to_owned(),
            schema_version: NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA_VERSION,
            requirements: vec![ExecutablePortfolioRequirement {
                plugin_id: "org.axiom.executable-fixture".to_owned(),
                version: version.to_owned(),
                data_version: 1,
                requirement: if activation == "active" {
                    "recommended".to_owned()
                } else {
                    "previously-used".to_owned()
                },
                activation: activation.to_owned(),
            }],
        }
    }

    fn proposal_command(context_kind: &str) -> NativeProposalCommandContribution {
        NativeProposalCommandContribution {
            schema: "axiom.plugin.command".to_owned(),
            schema_version: 1,
            id: "org.axiom.executable-fixture/review".to_owned(),
            title: "Review context".to_owned(),
            description: None,
            keywords: Vec::new(),
            placement: "omnibox".to_owned(),
            order: 500,
            action: NativeProposalCommandAction {
                kind: "compute.propose".to_owned(),
                operation: "entity.review".to_owned(),
                context: NativeProposalCommandContext {
                    kind: context_kind.to_owned(),
                },
                parameters: serde_json::json!({ "mode": "bounded" }),
            },
        }
    }

    fn proposal_request(reference_kind: &str) -> WasmComputeRequest {
        let location =
            matches!(reference_kind, "core.node" | "core.edge" | "core.swimlane").then(|| {
                WasmEntityLocation {
                    process_id: Some("process-service".to_owned()),
                    graph_path: Vec::new(),
                    incident_id: None,
                }
            });
        WasmComputeRequest {
            schema: NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA.to_owned(),
            schema_version: NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA_VERSION,
            request_id: "compute:selected-entity:1".to_owned(),
            base_revision: "portfolio-revision-aabbccdd".to_owned(),
            portfolio_revision: 7,
            snapshots: vec![WasmEntitySnapshot {
                schema: NEMOTO_PLUGIN_ENTITY_SNAPSHOT_SCHEMA.to_owned(),
                schema_version: NEMOTO_PLUGIN_ENTITY_SNAPSHOT_SCHEMA_VERSION,
                portfolio_revision: 7,
                reference: WasmEntityReference {
                    schema: NEMOTO_ENTITY_REFERENCE_SCHEMA.to_owned(),
                    schema_version: NEMOTO_ENTITY_REFERENCE_SCHEMA_VERSION,
                    kind: reference_kind.to_owned(),
                    id: "selected-entity".to_owned(),
                    location,
                },
                label: "Selected entity".to_owned(),
                fields: serde_json::Map::new(),
                omitted_fields: Vec::new(),
            }],
            parameters: serde_json::json!({
                "invocationId": "compute:selected-entity:1",
                "observedAt": "2026-08-29T16:00:00Z",
                "input": { "mode": "bounded" }
            }),
        }
    }

    #[test]
    fn proposal_command_contexts_are_closed_and_context_specific() {
        assert!(is_supported_proposal_command_context(
            ACTIVE_PROCESS_COMMAND_CONTEXT
        ));
        assert!(is_supported_proposal_command_context(
            SELECTED_ENTITY_COMMAND_CONTEXT
        ));
        assert!(!is_supported_proposal_command_context("portfolio-query"));

        let active_process = proposal_command(ACTIVE_PROCESS_COMMAND_CONTEXT);
        assert!(validate_proposal_command_request(
            &proposal_request("core.process"),
            &active_process,
        )
        .is_ok());
        assert!(
            validate_proposal_command_request(&proposal_request("core.node"), &active_process,)
                .is_err()
        );

        let selected_entity = proposal_command(SELECTED_ENTITY_COMMAND_CONTEXT);
        assert!(validate_proposal_command_request(
            &proposal_request("core.node"),
            &selected_entity,
        )
        .is_ok());
        let mut multiple = proposal_request("core.asset");
        multiple.snapshots.push(multiple.snapshots[0].clone());
        assert!(validate_proposal_command_request(&multiple, &selected_entity).is_err());
        let mut missing = proposal_request("core.asset");
        missing.snapshots.clear();
        assert!(validate_proposal_command_request(&missing, &selected_entity).is_err());
    }

    #[test]
    fn inspection_binds_manifest_identity_exact_module_and_declarative_content() {
        let archive = package(&[]);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
        assert_eq!(
            inspection.identity.plugin_id,
            "org.axiom.executable-fixture"
        );
        assert_eq!(inspection.requested_capabilities.len(), 3);
        assert_eq!(inspection.contribution_count, 1);
        assert_eq!(inspection.module_sha256.len(), 64);
        let review = inspection.review();
        assert_eq!(review.schema, NEMOTO_EXECUTABLE_PACKAGE_REVIEW_SCHEMA);
        assert_eq!(review.description, "Native adapter fixture.");

        let hidden = package(&[("runtime/hidden.wasm", module())]);
        assert_eq!(
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&hidden)
                .unwrap_err()
                .code,
            ExecutablePackageErrorCode::UnexpectedExecutable
        );

        let mismatched_contribution = package_with_contribution(
            br#"{"schema":"axiom.plugin.analysis","schemaVersion":1,"id":"org.axiom.someone-else/risk"}"#.to_vec(),
            &[],
        );
        assert_eq!(
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&mismatched_contribution)
                .unwrap_err()
                .code,
            ExecutablePackageErrorCode::ManifestInvalid
        );
    }

    #[test]
    fn composed_view_admission_matches_the_shared_contract() {
        let fixture = ui_admission_fixture();
        for (effect, capabilities) in fixture["effectCapabilities"].as_object().unwrap() {
            assert_eq!(
                serde_json::to_value(required_capabilities_for_ui_effect(effect)).unwrap(),
                *capabilities,
                "{effect}"
            );
        }
        for case in fixture["cases"].as_array().unwrap() {
            let result =
                ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&composed_package(case));
            assert_eq!(
                result.is_ok(),
                case["valid"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
            if let Ok(inspection) = result {
                assert_eq!(inspection.interactive_operations.len(), 1);
                assert_eq!(
                    inspection.interactive_operations[0].operation,
                    "ui.records.reduce"
                );
                assert_eq!(
                    inspection.interactive_operations[0].required_capabilities,
                    vec![
                        "compute.isolated".to_owned(),
                        "plugin-data.write".to_owned(),
                        "portfolio.read-scoped".to_owned(),
                        "workspace.navigate".to_owned(),
                    ]
                );
            }
        }
    }

    #[test]
    fn composed_install_rejects_unapproved_operation_or_required_capability() {
        let fixture = ui_admission_fixture();
        let case = &fixture["cases"][0];
        let archive = composed_package(case);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let mut missing_capability = approval(&inspection);
        assert_eq!(
            adapter(directory.path())
                .install(inspection, missing_capability.clone())
                .unwrap_err()
                .code,
            ExecutablePackageErrorCode::ApprovalMismatch
        );

        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
        missing_capability.granted_capabilities = inspection.requested_capabilities.clone();
        missing_capability.approved_interactive_operations = vec!["ui.other.reduce".to_owned()];
        assert_eq!(
            adapter(directory.path())
                .install(inspection, missing_capability)
                .unwrap_err()
                .code,
            ExecutablePackageErrorCode::ApprovalMismatch
        );

        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
        let mut approved = approval(&inspection);
        approved.granted_capabilities = inspection.requested_capabilities.clone();
        let outcome = adapter(directory.path())
            .install(inspection, approved)
            .unwrap();
        assert_eq!(
            outcome.installed_document["manifest"]["compatibility"]["axiomPluginApi"],
            ">=1.8.0 <2.0.0"
        );
        assert_eq!(
            outcome.installed_document["approvedInteractiveOperations"],
            serde_json::json!(["ui.records.reduce"])
        );
        let mut tampered = outcome.installed_document;
        tampered["contributions"]["contributions/composed.view.json"]["operation"] =
            serde_json::json!("ui.other.reduce");
        assert!(parse_installed_executable_document(tampered).is_err());
    }

    #[test]
    fn composed_ui_reduction_runs_a_real_guest_with_native_owned_binding() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../fixtures/plugins/protocol/ui-wire-v1.json"
        ))
        .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let adapter = ui_adapter(directory.path());
        install_and_activate_ui_guest(&adapter, result_module(&fixture["result"]));

        let outcome = adapter
            .execute_ui_reduction(ui_request(fixture["input"].clone()))
            .unwrap();
        assert_eq!(outcome.view_id, "org.axiom.ui-fixture/composed");
        assert_eq!(outcome.identity.plugin_id, "org.axiom.ui-fixture");
        assert_eq!(outcome.authority_generation, 1);
        assert_eq!(outcome.result, fixture["result"]);
        assert!(outcome
            .effective_capabilities
            .contains(&"plugin-data.write".to_owned()));
    }

    #[test]
    fn ui_request_cannot_supply_identity_operation_or_an_uninstalled_view() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../fixtures/plugins/protocol/ui-wire-v1.json"
        ))
        .unwrap();
        let mut forged = serde_json::to_value(ui_request(fixture["input"].clone())).unwrap();
        forged["operation"] = serde_json::json!("ui.forged.reduce");
        assert!(serde_json::from_value::<ExecutableUiReductionRequest>(forged).is_err());
        let mut forged = serde_json::to_value(ui_request(fixture["input"].clone())).unwrap();
        forged["identity"] = serde_json::json!({ "pluginId": "org.other" });
        assert!(serde_json::from_value::<ExecutableUiReductionRequest>(forged).is_err());

        let directory = tempfile::tempdir().unwrap();
        let adapter = ui_adapter(directory.path());
        let mut duplicate = ui_request(fixture["input"].clone());
        duplicate.input_json =
            duplicate
                .input_json
                .replacen('{', "{\"schema\":\"axiom.plugin-ui-input\",", 1);
        assert_eq!(
            adapter.execute_ui_reduction(duplicate).unwrap_err().code,
            ExecutablePackageErrorCode::UiReductionInvalid
        );
        let mut request = ui_request(fixture["input"].clone());
        request.view_id = "org.other/missing".to_owned();
        assert_eq!(
            adapter.execute_ui_reduction(request).unwrap_err().code,
            ExecutablePackageErrorCode::UiReductionInvalid
        );
    }

    #[test]
    fn ui_reduction_rejects_wrong_correlation_and_undeclared_effects() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../fixtures/plugins/protocol/ui-wire-v1.json"
        ))
        .unwrap();
        for result in [
            {
                let mut value = fixture["result"].clone();
                value["sequence"] = serde_json::json!(2);
                value
            },
            {
                let mut value = fixture["result"].clone();
                value["effects"] = serde_json::json!([{
                    "id": "clipboard:forged",
                    "kind": "output.clipboard-text",
                    "payload": { "text": "no grant or declaration" }
                }]);
                value
            },
        ] {
            let directory = tempfile::tempdir().unwrap();
            let adapter = ui_adapter(directory.path());
            install_and_activate_ui_guest(&adapter, result_module(&result));
            assert_eq!(
                adapter
                    .execute_ui_reduction(ui_request(fixture["input"].clone()))
                    .unwrap_err()
                    .code,
                ExecutablePackageErrorCode::UiReductionFailed
            );
        }
    }

    #[test]
    fn ui_reduction_fails_closed_when_guest_exhausts_fuel() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../fixtures/plugins/protocol/ui-wire-v1.json"
        ))
        .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let adapter = ui_adapter(directory.path());
        install_and_activate_ui_guest(&adapter, infinite_module());
        let error = adapter
            .execute_ui_reduction(ui_request(fixture["input"].clone()))
            .unwrap_err();
        assert_eq!(error.code, ExecutablePackageErrorCode::UiReductionFailed);
        assert_eq!(
            error.lifecycle_code,
            Some(WasmLifecycleErrorCode::SessionFailed)
        );
    }

    #[test]
    fn api_1_8_host_activates_composed_ui_execution() {
        let fixture = ui_admission_fixture();
        let wire: Value = serde_json::from_str(include_str!(
            "../../fixtures/plugins/protocol/ui-wire-v1.json"
        ))
        .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let adapter = ui_adapter(directory.path());
        let archive =
            composed_package_with_module(&fixture["cases"][0], result_module(&wire["result"]));
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
        let mut install_approval = approval(&inspection);
        install_approval.granted_capabilities = inspection.requested_capabilities.clone();
        adapter.install(inspection, install_approval).unwrap();
        let product = self::adapter(directory.path());
        let synchronized = product
            .synchronize_authority(ui_activation_snapshot("active"))
            .unwrap();
        assert!(synchronized.decisions[0].compatible);
        assert!(synchronized.decisions[0].authorized);
        let reduced = product
            .execute_ui_reduction(ui_request(wire["input"].clone()))
            .unwrap();
        assert_eq!(reduced.result, wire["result"]);
    }

    #[test]
    fn approval_is_bound_to_archive_identity_grants_and_explicit_risk_acknowledgement() {
        let archive = package(&[]);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
        let mut invalid_approval = approval(&inspection);
        invalid_approval.archive_sha256 = "0".repeat(64);
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            adapter(directory.path())
                .install(inspection, invalid_approval)
                .unwrap_err()
                .code,
            ExecutablePackageErrorCode::ApprovalMismatch
        );
    }

    #[test]
    fn commits_runtime_and_installed_document_through_a_verified_transaction() {
        let directory = tempfile::tempdir().unwrap();
        let adapter = adapter(directory.path());
        let archive = package(&[]);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
        let approval = approval(&inspection);
        let outcome = adapter.install(inspection, approval).unwrap();

        assert_eq!(outcome.lifecycle.identity.plugin_version, "1.0.0");
        assert_eq!(
            outcome.installed_document["grantedCapabilities"],
            serde_json::json!(["compute.isolated"])
        );
        assert!(directory
            .path()
            .join("plugins/org.axiom.executable-fixture.json")
            .exists());
        assert!(!directory
            .path()
            .join("transactions/org.axiom.executable-fixture.json")
            .exists());
    }

    #[test]
    fn file_approval_is_invalidated_when_the_selected_archive_changes() {
        let directory = tempfile::tempdir().unwrap();
        let package_path = directory.path().join("reviewed.axiom-plugin");
        fs::write(
            &package_path,
            package(&[("README.md", b"reviewed".to_vec())]),
        )
        .unwrap();
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_file(&package_path).unwrap();
        let approval = approval(&inspection);
        fs::write(
            &package_path,
            package(&[("README.md", b"changed".to_vec())]),
        )
        .unwrap();

        assert_eq!(
            adapter(directory.path())
                .install_file(&package_path, approval)
                .unwrap_err()
                .code,
            ExecutablePackageErrorCode::ApprovalMismatch
        );
    }

    #[test]
    fn recovers_metadata_after_runtime_commit_without_split_brain() {
        let directory = tempfile::tempdir().unwrap();
        let plugins_path = directory.path().join("plugins");
        let fail_once = Arc::new(AtomicBool::new(true));
        let fail_for_writer = Arc::clone(&fail_once);
        let lifecycle = Arc::new(
            NemotoWasmLifecycle::with_admission(
                directory.path().join("runtime"),
                FakeAdmission::default(),
            )
            .unwrap(),
        );
        let adapter = ExecutablePackageAdapter {
            lifecycle,
            installed_plugins_root: plugins_path.clone(),
            transactions_root: directory.path().join("transactions"),
            metadata_writer: Arc::new(move |path, document| {
                if fail_for_writer.swap(false, Ordering::SeqCst) {
                    Err(metadata_unavailable())
                } else {
                    write_document(path, document)
                }
            }),
            operation_lock: Mutex::new(()),
            ui_rate: Mutex::new(crate::plugin_ui_rate::PluginUiRateBudget::default()),
            synchronized_plugin_ids: Mutex::new(BTreeSet::new()),
            execution_enabled: false,
            host_plugin_api_version: NEMOTO_PLUGIN_API_VERSION,
        };
        let archive = package(&[]);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
        let approval = approval(&inspection);
        assert_eq!(
            adapter.install(inspection, approval).unwrap_err().code,
            ExecutablePackageErrorCode::CommitPending
        );

        assert_eq!(
            adapter.recover_all_pending().unwrap(),
            vec![(
                "org.axiom.executable-fixture".to_owned(),
                ExecutablePackageRecoveryAction::Committed,
            )]
        );
        let document: Value = serde_json::from_slice(
            &fs::read(plugins_path.join("org.axiom.executable-fixture.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(document["manifest"]["version"], "1.0.0");
    }

    #[test]
    fn recovery_does_not_rewrite_metadata_that_committed_before_cleanup_failed() {
        let directory = tempfile::tempdir().unwrap();
        let writes = Arc::new(AtomicUsize::new(0));
        let writes_for_writer = Arc::clone(&writes);
        let lifecycle = Arc::new(
            NemotoWasmLifecycle::with_admission(
                directory.path().join("runtime"),
                FakeAdmission::default(),
            )
            .unwrap(),
        );
        let adapter = ExecutablePackageAdapter {
            lifecycle,
            installed_plugins_root: directory.path().join("plugins"),
            transactions_root: directory.path().join("transactions"),
            metadata_writer: Arc::new(move |path, document| {
                let attempt = writes_for_writer.fetch_add(1, Ordering::SeqCst);
                write_document(path, document)?;
                if attempt == 0 {
                    Err(metadata_unavailable())
                } else {
                    Ok(())
                }
            }),
            operation_lock: Mutex::new(()),
            ui_rate: Mutex::new(crate::plugin_ui_rate::PluginUiRateBudget::default()),
            synchronized_plugin_ids: Mutex::new(BTreeSet::new()),
            execution_enabled: false,
            host_plugin_api_version: NEMOTO_PLUGIN_API_VERSION,
        };
        let archive = package(&[]);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
        let approval = approval(&inspection);
        assert_eq!(
            adapter.install(inspection, approval).unwrap_err().code,
            ExecutablePackageErrorCode::CommitPending
        );

        assert_eq!(
            adapter
                .recover_pending("org.axiom.executable-fixture")
                .unwrap(),
            ExecutablePackageRecoveryAction::Committed
        );
        assert_eq!(writes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn trusted_authority_is_derived_from_installed_metadata_and_portfolio_state() {
        let directory = tempfile::tempdir().unwrap();
        let adapter = adapter_with_execution_policy(directory.path(), true);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&package(&[])).unwrap();
        let identity = inspection.identity.clone();
        let install_approval = approval(&inspection);
        adapter.install(inspection, install_approval).unwrap();

        let outcome = adapter
            .synchronize_authority(activation_snapshot("active", "=1.0.0"))
            .unwrap();
        assert!(outcome.execution_enabled);
        assert_eq!(
            outcome.authority_scope_id,
            MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID
        );
        assert_eq!(outcome.decisions.len(), 1);
        assert_eq!(
            outcome.decisions[0].effective_capabilities,
            vec![ISOLATED_COMPUTE_CAPABILITY.to_owned()]
        );
        assert!(outcome.decisions[0].eligible);
        assert!(outcome.decisions[0].authorized);
        adapter
            .lifecycle()
            .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, identity)
            .unwrap();
    }

    #[test]
    fn effective_data_plane_grants_require_exact_installed_consent() {
        let directory = tempfile::tempdir().unwrap();
        let adapter = adapter_with_execution_policy(directory.path(), true);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&package(&[])).unwrap();
        let mut install_approval = approval(&inspection);
        install_approval.granted_capabilities = vec![
            ISOLATED_COMPUTE_CAPABILITY.to_owned(),
            "portfolio.read-scoped".to_owned(),
            "proposal.create".to_owned(),
        ];
        adapter.install(inspection, install_approval).unwrap();

        let outcome = adapter
            .synchronize_authority(activation_snapshot("active", "=1.0.0"))
            .unwrap();
        assert_eq!(
            outcome.decisions[0].effective_capabilities,
            vec![
                ISOLATED_COMPUTE_CAPABILITY.to_owned(),
                "portfolio.read-scoped".to_owned(),
                "proposal.create".to_owned(),
            ]
        );
        assert!(outcome.decisions[0].authorized);
    }

    #[test]
    fn installed_metadata_drift_fails_closed_and_revokes_previous_authority() {
        let directory = tempfile::tempdir().unwrap();
        let adapter = adapter_with_execution_policy(directory.path(), true);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&package(&[])).unwrap();
        let identity = inspection.identity.clone();
        let install_approval = approval(&inspection);
        adapter.install(inspection, install_approval).unwrap();
        adapter
            .synchronize_authority(activation_snapshot("active", "=1.0.0"))
            .unwrap();
        let session = adapter
            .lifecycle()
            .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, identity)
            .unwrap();

        let path = directory
            .path()
            .join("plugins/org.axiom.executable-fixture.json");
        let mut document: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        document["forgedAuthority"] = serde_json::json!(true);
        fs::write(&path, serde_json::to_vec_pretty(&document).unwrap()).unwrap();

        assert_eq!(
            adapter
                .synchronize_authority(activation_snapshot("active", "=1.0.0"))
                .unwrap_err()
                .code,
            ExecutablePackageErrorCode::ManifestInvalid
        );
        assert!(adapter
            .lifecycle()
            .close_session(&session.session_id)
            .is_ok_and(|open| !open));
    }

    #[test]
    fn production_policy_authorizes_only_eligible_installed_state() {
        let directory = tempfile::tempdir().unwrap();
        let adapter = adapter(directory.path());
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&package(&[])).unwrap();
        let identity = inspection.identity.clone();
        let install_approval = approval(&inspection);
        adapter.install(inspection, install_approval).unwrap();

        let outcome = adapter
            .synchronize_authority(activation_snapshot("active", "^1.0.0"))
            .unwrap();
        assert!(outcome.execution_enabled);
        assert!(outcome.decisions[0].eligible);
        assert!(outcome.decisions[0].authorized);
        assert!(adapter
            .lifecycle()
            .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, identity)
            .is_ok());
    }

    #[test]
    fn closed_policy_can_report_eligibility_without_authorizing_execution() {
        let directory = tempfile::tempdir().unwrap();
        let adapter = adapter_with_execution_policy(directory.path(), false);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&package(&[])).unwrap();
        let identity = inspection.identity.clone();
        let install_approval = approval(&inspection);
        adapter.install(inspection, install_approval).unwrap();

        let outcome = adapter
            .synchronize_authority(activation_snapshot("active", "^1.0.0"))
            .unwrap();
        assert!(!outcome.execution_enabled);
        assert!(outcome.decisions[0].eligible);
        assert!(!outcome.decisions[0].authorized);
        assert!(adapter
            .lifecycle()
            .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, identity)
            .is_err());
    }

    #[test]
    fn disable_version_drift_and_invalid_snapshots_revoke_live_sessions() {
        let directory = tempfile::tempdir().unwrap();
        let adapter = adapter_with_execution_policy(directory.path(), true);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&package(&[])).unwrap();
        let identity = inspection.identity.clone();
        let install_approval = approval(&inspection);
        adapter.install(inspection, install_approval).unwrap();
        adapter
            .synchronize_authority(activation_snapshot("active", "=1.0.0"))
            .unwrap();
        let first = adapter
            .lifecycle()
            .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, identity.clone())
            .unwrap();

        let disabled = adapter
            .synchronize_authority(activation_snapshot("inactive", "=1.0.0"))
            .unwrap();
        assert!(!disabled.decisions[0].authorized);
        assert_eq!(disabled.decisions[0].invalidated_sessions, 1);
        assert!(adapter
            .lifecycle()
            .close_session(&first.session_id)
            .is_ok_and(|open| !open));

        adapter
            .synchronize_authority(activation_snapshot("active", "=1.0.0"))
            .unwrap();
        let second = adapter
            .lifecycle()
            .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, identity.clone())
            .unwrap();
        let drifted = adapter
            .synchronize_authority(activation_snapshot("active", "=2.0.0"))
            .unwrap();
        assert!(!drifted.decisions[0].compatible);
        assert_eq!(drifted.decisions[0].invalidated_sessions, 1);
        assert!(adapter
            .lifecycle()
            .close_session(&second.session_id)
            .is_ok_and(|open| !open));

        adapter
            .synchronize_authority(activation_snapshot("active", "=1.0.0"))
            .unwrap();
        let third = adapter
            .lifecycle()
            .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, identity)
            .unwrap();
        let mut invalid = activation_snapshot("active", "=1.0.0");
        invalid.requirements[0].requirement = "previously-used".to_owned();
        assert_eq!(
            adapter.synchronize_authority(invalid).unwrap_err().code,
            ExecutablePackageErrorCode::ActivationSnapshotInvalid
        );
        assert!(adapter
            .lifecycle()
            .close_session(&third.session_id)
            .is_ok_and(|open| !open));
    }

    #[test]
    fn reinstall_and_uninstall_revoke_authority_before_storage_changes() {
        let directory = tempfile::tempdir().unwrap();
        let adapter = adapter_with_execution_policy(directory.path(), true);
        let archive = package(&[]);
        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
        let identity = inspection.identity.clone();
        let install_approval = approval(&inspection);
        adapter.install(inspection, install_approval).unwrap();
        adapter
            .synchronize_authority(activation_snapshot("active", "=1.0.0"))
            .unwrap();
        let first = adapter
            .lifecycle()
            .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, identity.clone())
            .unwrap();

        let inspection =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
        let reinstall_approval = approval(&inspection);
        let reinstall = adapter.install(inspection, reinstall_approval).unwrap();
        assert!(reinstall.lifecycle.reused_existing);
        assert_eq!(reinstall.lifecycle.invalidated_sessions, 1);
        assert!(adapter
            .lifecycle()
            .close_session(&first.session_id)
            .is_ok_and(|open| !open));

        adapter
            .synchronize_authority(activation_snapshot("active", "=1.0.0"))
            .unwrap();
        let second = adapter
            .lifecycle()
            .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, identity)
            .unwrap();
        adapter.uninstall("org.axiom.executable-fixture").unwrap();
        assert!(adapter
            .lifecycle()
            .close_session(&second.session_id)
            .is_ok_and(|open| !open));
        assert!(!directory
            .path()
            .join("runtime/org.axiom.executable-fixture")
            .exists());
        assert!(!directory
            .path()
            .join("plugins/org.axiom.executable-fixture.json")
            .exists());
    }

    #[test]
    fn rollback_restores_the_exact_previous_runtime_and_metadata_generation() {
        let directory = tempfile::tempdir().unwrap();
        let adapter = adapter_with_execution_policy(directory.path(), true);
        let contribution = br#"{"schema":"axiom.plugin.analysis","schemaVersion":1,"id":"org.axiom.executable-fixture/risk"}"#;
        let first_archive = package_with_contribution_api_and_version(
            contribution.to_vec(),
            &[("README.md", b"generation-a".to_vec())],
            "^1.0.0",
            "1.0.0",
        );
        let first =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&first_archive).unwrap();
        let first_identity = first.identity.clone();
        let first_approval = approval(&first);
        adapter.install(first, first_approval).unwrap();

        let second_archive = package_with_contribution_api_and_version(
            contribution.to_vec(),
            &[("README.md", b"generation-b".to_vec())],
            "^1.0.0",
            "1.1.0",
        );
        let second =
            ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&second_archive).unwrap();
        let second_identity = second.identity.clone();
        let second_approval = approval(&second);
        adapter.install(second, second_approval).unwrap();

        let rollback = adapter.rollback(&second_identity).unwrap();
        assert_eq!(rollback.lifecycle.identity, first_identity);
        assert_eq!(rollback.installed_document["manifest"]["version"], "1.0.0");
        assert_eq!(
            adapter
                .lifecycle()
                .current_identity("org.axiom.executable-fixture")
                .unwrap(),
            Some(first_identity)
        );
        let installed: Value = serde_json::from_slice(
            &fs::read(
                directory
                    .path()
                    .join("plugins/org.axiom.executable-fixture.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(installed["manifest"]["version"], "1.0.0");
    }

    #[test]
    fn supported_api_ranges_include_composed_ui_in_the_product_host() {
        for (range, compatible) in [("^1.7.0", true), ("=1.7.0", false), ("^1.8.0", true)] {
            let directory = tempfile::tempdir().unwrap();
            let adapter = adapter_with_execution_policy(directory.path(), true);
            let archive = package_with_contribution_and_api(
                br#"{"schema":"axiom.plugin.analysis","schemaVersion":1,"id":"org.axiom.executable-fixture/risk"}"#.to_vec(),
                &[],
                range,
            );
            let inspection =
                ExecutablePackageAdapter::<FakeAdmission>::inspect_archive(&archive).unwrap();
            let consent = approval(&inspection);
            adapter.install(inspection, consent).unwrap();
            let outcome = adapter
                .synchronize_authority(activation_snapshot("active", "=1.0.0"))
                .unwrap();
            assert_eq!(outcome.host_plugin_api_version, NEMOTO_PLUGIN_API_VERSION);
            assert_eq!(outcome.decisions[0].compatible, compatible, "{range}");
            assert_eq!(outcome.decisions[0].authorized, compatible, "{range}");
            assert_eq!(
                outcome.decisions[0].effective_capabilities,
                vec!["compute.isolated"]
            );
            assert!(directory
                .path()
                .join("plugins/org.axiom.executable-fixture.json")
                .exists());
        }
    }

    #[test]
    fn authority_range_matching_mirrors_the_frontend_contract() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../fixtures/plugins/protocol/ui-v1.json"))
                .unwrap();
        assert_eq!(fixture["hostApiVersion"], NEMOTO_PLUGIN_API_VERSION);
        for case in fixture["compatibility"].as_array().unwrap() {
            let range = case["range"].as_str().unwrap();
            assert_eq!(
                satisfies_version_range(NEMOTO_PLUGIN_API_VERSION, range),
                case["compatible"].as_bool().unwrap(),
                "{range}"
            );
        }
        assert!(satisfies_version_range("1.6.0", "^1.0.0"));
        assert!(satisfies_version_range("1.6.0", ">=1.5.0 <2.0.0 || =3.0.0"));
        assert!(satisfies_version_range("1.6.0", "1"));
        assert!(!satisfies_version_range("2.0.0", "^1.0.0"));
        assert!(!satisfies_version_range("1.6.0", ">=2.0.0 <3.0.0"));
    }
}
