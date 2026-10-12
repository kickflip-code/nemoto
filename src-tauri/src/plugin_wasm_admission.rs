//! Resource-bounded, subprocess-isolated admission for executable-plugin Wasm.
//!
//! The current external package inspector remains declarative-only. This module
//! is an internal foundation for a future admission path: the main Axiom process
//! sends module bytes to a short-lived copy of itself, and that helper applies
//! native resource limits before initializing Wasmtime or reading the module.

use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    plugin_compute_policy::ISOLATED_COMPUTE_POLICY_V1,
    plugin_wasm_host::{
        NemotoWasmHost, WasmHostErrorCode, NEMOTO_WASM_ABI_NAME, NEMOTO_WASM_ABI_VERSION,
        WASMTIME_ENGINE_VERSION,
    },
    plugin_wasm_session::{validate_wasm_plugin_identity, WasmPluginIdentity},
    utils::atomic_file::{atomic_write_verified, backup_path},
};

pub const NEMOTO_WASM_ADMISSION_SCHEMA: &str = "axiom.wasm-admission";
pub const NEMOTO_WASM_ADMISSION_SCHEMA_VERSION: u32 = 1;
pub const WASM_ADMISSION_HELPER_ARGUMENT: &str = "--nemoto-internal-wasm-admission-v1";
pub const WASM_COMPILER_WALL_DEADLINE_MS: u64 = 15_000;
pub const WASM_COMPILER_CPU_TIME_LIMIT_MS: u64 = 15_000;
pub const WASM_COMPILER_MEMORY_LIMIT_BYTES: usize = 512 * 1024 * 1024;
pub const MAX_WASM_COMPILED_ARTIFACT_BYTES: usize = 64 * 1024 * 1024;
const MAX_HELPER_RESPONSE_BYTES: u64 = 64 * 1024;
const MAX_ADMISSION_RECEIPT_BYTES: u64 = 16 * 1024;
const HELPER_POLL_INTERVAL: Duration = Duration::from_millis(10);
const ENGINE_NAME: &str = "wasmtime";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WasmAdmissionErrorCode {
    ModuleTooLarge,
    InvalidIdentity,
    UnsupportedPlatform,
    HelperUnavailable,
    ResourceBoundaryUnavailable,
    DeadlineExceeded,
    HelperProtocolViolation,
    CompilationRejected,
    ArtifactTooLarge,
    CacheInvalid,
    CacheUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmAdmissionError {
    pub code: WasmAdmissionErrorCode,
    pub message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_code: Option<WasmHostErrorCode>,
}

impl WasmAdmissionError {
    pub(crate) fn new(code: WasmAdmissionErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            host_code: None,
        }
    }

    fn rejected(host_code: WasmHostErrorCode) -> Self {
        Self {
            code: WasmAdmissionErrorCode::CompilationRejected,
            message: "The WebAssembly module did not pass native admission.",
            host_code: Some(host_code),
        }
    }
}

impl std::fmt::Display for WasmAdmissionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for WasmAdmissionError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WasmAdmissionReceipt {
    pub schema: String,
    pub schema_version: u32,
    pub identity: WasmPluginIdentity,
    pub module_sha256: String,
    pub module_bytes: u64,
    pub compiled_artifact_bytes: u64,
    pub abi_name: String,
    pub abi_version: i32,
    pub compute_policy_version: u32,
    pub engine: String,
    pub engine_version: String,
    pub helper_memory_limit_bytes: u64,
    pub helper_cpu_time_limit_ms: u64,
    pub helper_wall_deadline_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WasmAdmissionCacheSource {
    Primary,
    Backup,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WasmAdmissionCacheHit {
    pub receipt: WasmAdmissionReceipt,
    pub source: WasmAdmissionCacheSource,
}

#[derive(Debug, Clone)]
pub struct NativeWasmAdmission {
    helper_executable: PathBuf,
    wall_deadline: Duration,
}

impl NativeWasmAdmission {
    pub fn new() -> Result<Self, WasmAdmissionError> {
        let helper_executable = std::env::current_exe().map_err(|_| helper_unavailable())?;
        Ok(Self {
            helper_executable,
            wall_deadline: Duration::from_millis(WASM_COMPILER_WALL_DEADLINE_MS),
        })
    }

    /// Allows packaged launchers and integration tests to provide the exact
    /// trusted Axiom executable used for the short-lived helper process.
    #[doc(hidden)]
    pub fn with_helper_executable(helper_executable: PathBuf, wall_deadline: Duration) -> Self {
        Self {
            helper_executable,
            wall_deadline: wall_deadline.min(Duration::from_millis(WASM_COMPILER_WALL_DEADLINE_MS)),
        }
    }

    pub fn admit(
        &self,
        identity: &WasmPluginIdentity,
        module_bytes: &[u8],
    ) -> Result<WasmAdmissionReceipt, WasmAdmissionError> {
        validate_wasm_plugin_identity(identity).map_err(|_| {
            WasmAdmissionError::new(
                WasmAdmissionErrorCode::InvalidIdentity,
                "The WebAssembly admission identity is invalid.",
            )
        })?;
        if module_bytes.len() > ISOLATED_COMPUTE_POLICY_V1.max_module_bytes {
            return Err(WasmAdmissionError::new(
                WasmAdmissionErrorCode::ModuleTooLarge,
                "The WebAssembly module exceeds the admission size limit.",
            ));
        }
        if !cfg!(windows) {
            return Err(WasmAdmissionError::new(
                WasmAdmissionErrorCode::UnsupportedPlatform,
                "Native WebAssembly admission is not available on this platform.",
            ));
        }

        let expected_hash = module_sha256(module_bytes);
        let compilation = self.invoke_helper(module_bytes)?;
        validate_helper_compilation(&compilation, module_bytes, &expected_hash)?;

        Ok(WasmAdmissionReceipt {
            schema: NEMOTO_WASM_ADMISSION_SCHEMA.to_owned(),
            schema_version: NEMOTO_WASM_ADMISSION_SCHEMA_VERSION,
            identity: identity.clone(),
            module_sha256: expected_hash,
            module_bytes: module_bytes.len() as u64,
            compiled_artifact_bytes: compilation.compiled_artifact_bytes,
            abi_name: NEMOTO_WASM_ABI_NAME.to_owned(),
            abi_version: NEMOTO_WASM_ABI_VERSION,
            compute_policy_version: ISOLATED_COMPUTE_POLICY_V1.policy_version,
            engine: ENGINE_NAME.to_owned(),
            engine_version: WASMTIME_ENGINE_VERSION.to_owned(),
            helper_memory_limit_bytes: WASM_COMPILER_MEMORY_LIMIT_BYTES as u64,
            helper_cpu_time_limit_ms: WASM_COMPILER_CPU_TIME_LIMIT_MS,
            helper_wall_deadline_ms: self.wall_deadline.as_millis() as u64,
        })
    }

    fn invoke_helper(&self, module_bytes: &[u8]) -> Result<HelperCompilation, WasmAdmissionError> {
        let started = Instant::now();
        let mut command = Command::new(&self.helper_executable);
        command
            .arg(WASM_ADMISSION_HELPER_ARGUMENT)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().map_err(|_| helper_unavailable())?;
        let write_result =
            child
                .stdin
                .take()
                .ok_or_else(helper_unavailable)
                .and_then(|mut stdin| {
                    stdin
                        .write_all(module_bytes)
                        .map_err(|_| helper_unavailable())?;
                    stdin.flush().map_err(|_| helper_unavailable())
                });

        let status = wait_for_helper(&mut child, started, self.wall_deadline)?;
        let mut output = Vec::new();
        child
            .stdout
            .take()
            .ok_or_else(helper_protocol_violation)?
            .take(MAX_HELPER_RESPONSE_BYTES + 1)
            .read_to_end(&mut output)
            .map_err(|_| helper_protocol_violation())?;
        if output.len() as u64 > MAX_HELPER_RESPONSE_BYTES {
            return Err(helper_protocol_violation());
        }
        let response: HelperResponse =
            serde_json::from_slice(&output).map_err(|_| helper_protocol_violation())?;

        match response {
            HelperResponse::Accepted { compilation }
                if status.success() && write_result.is_ok() =>
            {
                Ok(compilation)
            }
            HelperResponse::Rejected { rejection } if status.success() => {
                Err(map_helper_rejection(rejection))
            }
            _ => Err(helper_unavailable()),
        }
    }
}

fn wait_for_helper(
    child: &mut Child,
    started: Instant,
    deadline: Duration,
) -> Result<std::process::ExitStatus, WasmAdmissionError> {
    loop {
        if started.elapsed() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(WasmAdmissionError::new(
                WasmAdmissionErrorCode::DeadlineExceeded,
                "The WebAssembly compiler helper exceeded its wall-clock deadline.",
            ));
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => thread::sleep(HELPER_POLL_INTERVAL),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(helper_unavailable());
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelperCompilation {
    module_sha256: String,
    module_bytes: u64,
    compiled_artifact_bytes: u64,
    abi_name: String,
    abi_version: i32,
    compute_policy_version: u32,
    engine: String,
    engine_version: String,
    helper_memory_limit_bytes: u64,
    helper_cpu_time_limit_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelperRejection {
    code: WasmAdmissionErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    host_code: Option<WasmHostErrorCode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case", deny_unknown_fields)]
enum HelperResponse {
    Accepted { compilation: HelperCompilation },
    Rejected { rejection: HelperRejection },
}

fn validate_helper_compilation(
    compilation: &HelperCompilation,
    module_bytes: &[u8],
    expected_hash: &str,
) -> Result<(), WasmAdmissionError> {
    if compilation.module_sha256 != expected_hash
        || compilation.module_bytes != module_bytes.len() as u64
        || compilation.compiled_artifact_bytes == 0
        || compilation.compiled_artifact_bytes > MAX_WASM_COMPILED_ARTIFACT_BYTES as u64
        || compilation.abi_name != NEMOTO_WASM_ABI_NAME
        || compilation.abi_version != NEMOTO_WASM_ABI_VERSION
        || compilation.compute_policy_version != ISOLATED_COMPUTE_POLICY_V1.policy_version
        || compilation.engine != ENGINE_NAME
        || compilation.engine_version != WASMTIME_ENGINE_VERSION
        || compilation.helper_memory_limit_bytes != WASM_COMPILER_MEMORY_LIMIT_BYTES as u64
        || compilation.helper_cpu_time_limit_ms != WASM_COMPILER_CPU_TIME_LIMIT_MS
    {
        return Err(helper_protocol_violation());
    }
    Ok(())
}

fn map_helper_rejection(rejection: HelperRejection) -> WasmAdmissionError {
    match (rejection.code, rejection.host_code) {
        (WasmAdmissionErrorCode::CompilationRejected, Some(host_code)) => {
            WasmAdmissionError::rejected(host_code)
        }
        (WasmAdmissionErrorCode::ResourceBoundaryUnavailable, _) => WasmAdmissionError::new(
            WasmAdmissionErrorCode::ResourceBoundaryUnavailable,
            "The WebAssembly compiler resource boundary could not be established.",
        ),
        (WasmAdmissionErrorCode::ArtifactTooLarge, _) => WasmAdmissionError::new(
            WasmAdmissionErrorCode::ArtifactTooLarge,
            "The compiled WebAssembly artifact exceeds the admission limit.",
        ),
        (WasmAdmissionErrorCode::ModuleTooLarge, _) => WasmAdmissionError::new(
            WasmAdmissionErrorCode::ModuleTooLarge,
            "The WebAssembly module exceeds the admission size limit.",
        ),
        _ => helper_protocol_violation(),
    }
}

/// Called before Tauri initialization by the Axiom binary. Returns `true` only
/// for the exact private helper invocation.
pub fn run_helper_if_requested() -> bool {
    let mut arguments = std::env::args_os();
    let _executable = arguments.next();
    if arguments.next().as_deref() != Some(std::ffi::OsStr::new(WASM_ADMISSION_HELPER_ARGUMENT)) {
        return false;
    }
    let response = if arguments.next().is_some() {
        HelperResponse::Rejected {
            rejection: HelperRejection {
                code: WasmAdmissionErrorCode::HelperProtocolViolation,
                host_code: None,
            },
        }
    } else {
        run_helper_compilation()
    };
    let stdout = io::stdout();
    let mut output = stdout.lock();
    let _ = serde_json::to_writer(&mut output, &response);
    let _ = output.flush();
    true
}

fn run_helper_compilation() -> HelperResponse {
    let _resource_boundary = match apply_helper_resource_limits() {
        Ok(boundary) => boundary,
        Err(()) => {
            return HelperResponse::Rejected {
                rejection: HelperRejection {
                    code: WasmAdmissionErrorCode::ResourceBoundaryUnavailable,
                    host_code: None,
                },
            };
        }
    };

    let mut module_bytes = Vec::new();
    let input_result = io::stdin()
        .lock()
        .take(ISOLATED_COMPUTE_POLICY_V1.max_module_bytes as u64 + 1)
        .read_to_end(&mut module_bytes);
    if input_result.is_err() {
        return HelperResponse::Rejected {
            rejection: HelperRejection {
                code: WasmAdmissionErrorCode::HelperProtocolViolation,
                host_code: None,
            },
        };
    }
    if module_bytes.len() > ISOLATED_COMPUTE_POLICY_V1.max_module_bytes {
        return HelperResponse::Rejected {
            rejection: HelperRejection {
                code: WasmAdmissionErrorCode::ModuleTooLarge,
                host_code: None,
            },
        };
    }

    let host = match NemotoWasmHost::new() {
        Ok(host) => host,
        Err(error) => {
            return HelperResponse::Rejected {
                rejection: HelperRejection {
                    code: WasmAdmissionErrorCode::CompilationRejected,
                    host_code: Some(error.code),
                },
            };
        }
    };
    let compiled_artifact_bytes = match host.compile_for_admission(&module_bytes) {
        Ok(bytes) if bytes <= MAX_WASM_COMPILED_ARTIFACT_BYTES => bytes,
        Ok(_) => {
            return HelperResponse::Rejected {
                rejection: HelperRejection {
                    code: WasmAdmissionErrorCode::ArtifactTooLarge,
                    host_code: None,
                },
            };
        }
        Err(error) => {
            return HelperResponse::Rejected {
                rejection: HelperRejection {
                    code: WasmAdmissionErrorCode::CompilationRejected,
                    host_code: Some(error.code),
                },
            };
        }
    };

    HelperResponse::Accepted {
        compilation: HelperCompilation {
            module_sha256: module_sha256(&module_bytes),
            module_bytes: module_bytes.len() as u64,
            compiled_artifact_bytes: compiled_artifact_bytes as u64,
            abi_name: NEMOTO_WASM_ABI_NAME.to_owned(),
            abi_version: NEMOTO_WASM_ABI_VERSION,
            compute_policy_version: ISOLATED_COMPUTE_POLICY_V1.policy_version,
            engine: ENGINE_NAME.to_owned(),
            engine_version: WASMTIME_ENGINE_VERSION.to_owned(),
            helper_memory_limit_bytes: WASM_COMPILER_MEMORY_LIMIT_BYTES as u64,
            helper_cpu_time_limit_ms: WASM_COMPILER_CPU_TIME_LIMIT_MS,
        },
    }
}

#[cfg(windows)]
struct HelperResourceBoundary(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Drop for HelperResourceBoundary {
    fn drop(&mut self) {
        // SAFETY: the handle was returned by CreateJobObjectW and is owned here.
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(windows)]
fn apply_helper_resource_limits() -> Result<HelperResourceBoundary, ()> {
    use std::{ffi::c_void, mem::size_of, ptr};
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
                JOB_OBJECT_LIMIT_PROCESS_MEMORY, JOB_OBJECT_LIMIT_PROCESS_TIME,
            },
            Threading::GetCurrentProcess,
        },
    };

    // SAFETY: null security attributes and name create one private job handle.
    let job = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
    if job.is_null() {
        return Err(());
    }
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_ACTIVE_PROCESS
        | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
        | JOB_OBJECT_LIMIT_PROCESS_MEMORY
        | JOB_OBJECT_LIMIT_PROCESS_TIME;
    limits.BasicLimitInformation.ActiveProcessLimit = 1;
    limits.BasicLimitInformation.PerProcessUserTimeLimit =
        (WASM_COMPILER_CPU_TIME_LIMIT_MS as i64) * 10_000;
    limits.ProcessMemoryLimit = WASM_COMPILER_MEMORY_LIMIT_BYTES;

    // SAFETY: `limits` has the exact structure and size required by the selected
    // information class, and both handles remain valid for these calls.
    let configured = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            std::ptr::addr_of!(limits).cast::<c_void>(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    // SAFETY: GetCurrentProcess returns the current pseudo-handle accepted here.
    let assigned =
        configured != 0 && unsafe { AssignProcessToJobObject(job, GetCurrentProcess()) } != 0;
    if !assigned {
        // SAFETY: assignment failed, so closing the owned job handle is sufficient.
        unsafe {
            CloseHandle(job);
        }
        return Err(());
    }
    Ok(HelperResourceBoundary(job))
}

#[cfg(not(windows))]
struct HelperResourceBoundary;

#[cfg(not(windows))]
fn apply_helper_resource_limits() -> Result<HelperResourceBoundary, ()> {
    Err(())
}

pub fn store_admission_receipt(
    path: &Path,
    receipt: &WasmAdmissionReceipt,
    expected_identity: &WasmPluginIdentity,
    module_bytes: &[u8],
) -> Result<(), WasmAdmissionError> {
    validate_admission_receipt(receipt, expected_identity, module_bytes)?;
    let encoded = serde_json::to_vec_pretty(receipt).map_err(|_| cache_unavailable())?;
    atomic_write_verified(path, &encoded, true, |candidate| {
        let candidate_bytes = fs::read(candidate)?;
        let parsed: WasmAdmissionReceipt = serde_json::from_slice(&candidate_bytes)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if parsed != *receipt {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "admission receipt verification failed",
            ));
        }
        Ok(())
    })
    .map_err(|_| cache_unavailable())
}

pub fn load_admission_receipt(
    path: &Path,
    expected_identity: &WasmPluginIdentity,
    module_bytes: &[u8],
) -> Result<WasmAdmissionCacheHit, WasmAdmissionError> {
    match read_valid_receipt(path, expected_identity, module_bytes) {
        Ok(receipt) => Ok(WasmAdmissionCacheHit {
            receipt,
            source: WasmAdmissionCacheSource::Primary,
        }),
        Err(primary_error) => {
            let backup = backup_path(path);
            match read_valid_receipt(&backup, expected_identity, module_bytes) {
                Ok(receipt) => Ok(WasmAdmissionCacheHit {
                    receipt,
                    source: WasmAdmissionCacheSource::Backup,
                }),
                Err(_) => Err(primary_error),
            }
        }
    }
}

pub fn validate_admission_receipt(
    receipt: &WasmAdmissionReceipt,
    expected_identity: &WasmPluginIdentity,
    module_bytes: &[u8],
) -> Result<(), WasmAdmissionError> {
    validate_wasm_plugin_identity(expected_identity).map_err(|_| cache_invalid())?;
    if module_bytes.is_empty()
        || module_bytes.len() > ISOLATED_COMPUTE_POLICY_V1.max_module_bytes
        || receipt.schema != NEMOTO_WASM_ADMISSION_SCHEMA
        || receipt.schema_version != NEMOTO_WASM_ADMISSION_SCHEMA_VERSION
        || receipt.identity != *expected_identity
        || receipt.module_sha256 != module_sha256(module_bytes)
        || receipt.module_bytes != module_bytes.len() as u64
        || receipt.compiled_artifact_bytes == 0
        || receipt.compiled_artifact_bytes > MAX_WASM_COMPILED_ARTIFACT_BYTES as u64
        || receipt.abi_name != NEMOTO_WASM_ABI_NAME
        || receipt.abi_version != NEMOTO_WASM_ABI_VERSION
        || receipt.compute_policy_version != ISOLATED_COMPUTE_POLICY_V1.policy_version
        || receipt.engine != ENGINE_NAME
        || receipt.engine_version != WASMTIME_ENGINE_VERSION
        || receipt.helper_memory_limit_bytes != WASM_COMPILER_MEMORY_LIMIT_BYTES as u64
        || receipt.helper_cpu_time_limit_ms != WASM_COMPILER_CPU_TIME_LIMIT_MS
        || receipt.helper_wall_deadline_ms == 0
        || receipt.helper_wall_deadline_ms > WASM_COMPILER_WALL_DEADLINE_MS
    {
        return Err(cache_invalid());
    }
    Ok(())
}

fn read_valid_receipt(
    path: &Path,
    expected_identity: &WasmPluginIdentity,
    module_bytes: &[u8],
) -> Result<WasmAdmissionReceipt, WasmAdmissionError> {
    let metadata = fs::metadata(path).map_err(|_| cache_unavailable())?;
    if metadata.len() == 0 || metadata.len() > MAX_ADMISSION_RECEIPT_BYTES {
        return Err(cache_invalid());
    }
    let bytes = fs::read(path).map_err(|_| cache_unavailable())?;
    let receipt: WasmAdmissionReceipt =
        serde_json::from_slice(&bytes).map_err(|_| cache_invalid())?;
    validate_admission_receipt(&receipt, expected_identity, module_bytes)?;
    Ok(receipt)
}

pub(crate) fn module_sha256(module_bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(module_bytes))
}

fn helper_unavailable() -> WasmAdmissionError {
    WasmAdmissionError::new(
        WasmAdmissionErrorCode::HelperUnavailable,
        "The WebAssembly compiler helper is unavailable.",
    )
}

fn helper_protocol_violation() -> WasmAdmissionError {
    WasmAdmissionError::new(
        WasmAdmissionErrorCode::HelperProtocolViolation,
        "The WebAssembly compiler helper returned an invalid response.",
    )
}

fn cache_invalid() -> WasmAdmissionError {
    WasmAdmissionError::new(
        WasmAdmissionErrorCode::CacheInvalid,
        "The WebAssembly admission receipt is invalid or stale.",
    )
}

fn cache_unavailable() -> WasmAdmissionError {
    WasmAdmissionError::new(
        WasmAdmissionErrorCode::CacheUnavailable,
        "The WebAssembly admission receipt is unavailable.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> WasmPluginIdentity {
        WasmPluginIdentity {
            plugin_id: "com.axiom.compiler-fixture".to_owned(),
            plugin_version: "1.2.3".to_owned(),
            data_version: 4,
        }
    }

    fn receipt(module_bytes: &[u8]) -> WasmAdmissionReceipt {
        WasmAdmissionReceipt {
            schema: NEMOTO_WASM_ADMISSION_SCHEMA.to_owned(),
            schema_version: NEMOTO_WASM_ADMISSION_SCHEMA_VERSION,
            identity: identity(),
            module_sha256: module_sha256(module_bytes),
            module_bytes: module_bytes.len() as u64,
            compiled_artifact_bytes: 4096,
            abi_name: NEMOTO_WASM_ABI_NAME.to_owned(),
            abi_version: NEMOTO_WASM_ABI_VERSION,
            compute_policy_version: ISOLATED_COMPUTE_POLICY_V1.policy_version,
            engine: ENGINE_NAME.to_owned(),
            engine_version: WASMTIME_ENGINE_VERSION.to_owned(),
            helper_memory_limit_bytes: WASM_COMPILER_MEMORY_LIMIT_BYTES as u64,
            helper_cpu_time_limit_ms: WASM_COMPILER_CPU_TIME_LIMIT_MS,
            helper_wall_deadline_ms: WASM_COMPILER_WALL_DEADLINE_MS,
        }
    }

    #[test]
    fn receipts_are_bound_to_identity_module_engine_abi_and_policy() {
        let module = b"module-one";
        let accepted = receipt(module);
        validate_admission_receipt(&accepted, &identity(), module).unwrap();

        let mut mutations = Vec::new();
        let mut wrong_identity = accepted.clone();
        wrong_identity.identity.plugin_version = "1.2.4".to_owned();
        mutations.push(wrong_identity);
        let mut wrong_hash = accepted.clone();
        wrong_hash.module_sha256 = "0".repeat(64);
        mutations.push(wrong_hash);
        let mut wrong_engine = accepted.clone();
        wrong_engine.engine_version = "36.0.13".to_owned();
        mutations.push(wrong_engine);
        let mut wrong_abi = accepted.clone();
        wrong_abi.abi_version += 1;
        mutations.push(wrong_abi);
        let mut wrong_policy = accepted.clone();
        wrong_policy.compute_policy_version += 1;
        mutations.push(wrong_policy);

        for invalid in mutations {
            assert_eq!(
                validate_admission_receipt(&invalid, &identity(), module)
                    .unwrap_err()
                    .code,
                WasmAdmissionErrorCode::CacheInvalid
            );
        }
        assert_eq!(
            validate_admission_receipt(&accepted, &identity(), b"module-two")
                .unwrap_err()
                .code,
            WasmAdmissionErrorCode::CacheInvalid
        );
    }

    #[test]
    fn cache_updates_atomically_and_can_fall_back_to_the_exact_backup() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("admission.json");
        let first_module = b"module-one";
        let second_module = b"module-two";
        let first = receipt(first_module);
        let second = receipt(second_module);

        store_admission_receipt(&path, &first, &identity(), first_module).unwrap();
        store_admission_receipt(&path, &second, &identity(), second_module).unwrap();
        assert_eq!(
            load_admission_receipt(&path, &identity(), second_module)
                .unwrap()
                .source,
            WasmAdmissionCacheSource::Primary
        );

        fs::write(&path, b"corrupt-current-receipt").unwrap();
        let recovered = load_admission_receipt(&path, &identity(), first_module).unwrap();
        assert_eq!(recovered.source, WasmAdmissionCacheSource::Backup);
        assert_eq!(recovered.receipt, first);
        assert_eq!(
            load_admission_receipt(&path, &identity(), b"unrelated-module")
                .unwrap_err()
                .code,
            WasmAdmissionErrorCode::CacheInvalid
        );
    }

    #[test]
    fn helper_protocol_rejects_unknown_fields_and_inconsistent_results() {
        let unknown = br#"{
            "status":"rejected",
            "rejection":{"code":"MODULE_TOO_LARGE","extra":true}
        }"#;
        assert!(serde_json::from_slice::<HelperResponse>(unknown).is_err());

        let compilation = HelperCompilation {
            module_sha256: "0".repeat(64),
            module_bytes: 4,
            compiled_artifact_bytes: 1,
            abi_name: NEMOTO_WASM_ABI_NAME.to_owned(),
            abi_version: NEMOTO_WASM_ABI_VERSION,
            compute_policy_version: ISOLATED_COMPUTE_POLICY_V1.policy_version,
            engine: ENGINE_NAME.to_owned(),
            engine_version: WASMTIME_ENGINE_VERSION.to_owned(),
            helper_memory_limit_bytes: WASM_COMPILER_MEMORY_LIMIT_BYTES as u64,
            helper_cpu_time_limit_ms: WASM_COMPILER_CPU_TIME_LIMIT_MS,
        };
        assert_eq!(
            validate_helper_compilation(&compilation, b"wasm", "different")
                .unwrap_err()
                .code,
            WasmAdmissionErrorCode::HelperProtocolViolation
        );
    }

    #[test]
    fn oversized_modules_fail_before_any_helper_is_started() {
        let admission = NativeWasmAdmission::with_helper_executable(
            PathBuf::from("does-not-exist"),
            Duration::from_secs(1),
        );
        let oversized = vec![0_u8; ISOLATED_COMPUTE_POLICY_V1.max_module_bytes + 1];

        assert_eq!(
            admission.admit(&identity(), &oversized).unwrap_err().code,
            WasmAdmissionErrorCode::ModuleTooLarge
        );
    }
}
