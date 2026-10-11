//! App-owned immutable storage for admitted executable-plugin WebAssembly.
//!
//! This module intentionally has no Tauri command. A future trusted lifecycle
//! coordinator may persist an already-admitted module here, then bind the
//! returned identity to the native session registry. External packages remain
//! unable to reach either admission or storage directly.

use std::{
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    commands::plugins::is_valid_plugin_id,
    plugin_compute_policy::ISOLATED_COMPUTE_POLICY_V1,
    plugin_wasm_admission::{validate_admission_receipt, WasmAdmissionReceipt},
    plugin_wasm_host::AXIOM_WASM_ABI_NAME,
    plugin_wasm_session::{validate_wasm_plugin_identity, WasmPluginIdentity},
    utils::atomic_file::{atomic_write_verified, backup_path},
};

pub const AXIOM_PLUGIN_WASM_RUNTIME_SCHEMA: &str = "axiom.plugin-wasm-runtime";
pub const AXIOM_PLUGIN_WASM_RUNTIME_SCHEMA_VERSION: u32 = 1;
pub const AXIOM_WASM_STORAGE_POINTER_SCHEMA: &str = "axiom.wasm-storage-pointer";
pub const AXIOM_WASM_STORAGE_POINTER_SCHEMA_VERSION: u32 = 1;

const CURRENT_POINTER_FILE: &str = "current.json";
const GENERATIONS_DIRECTORY: &str = "generations";
const MODULE_FILE: &str = "module.wasm";
const RECEIPT_FILE: &str = "admission.json";
const MAX_POINTER_BYTES: u64 = 16 * 1024;
const MAX_RECEIPT_BYTES: u64 = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginWasmEntrypoint {
    pub schema: String,
    pub schema_version: u32,
    pub abi: String,
    pub module: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WasmStorageErrorCode {
    InvalidEntrypoint,
    InvalidIdentity,
    InvalidAdmission,
    InvalidBundle,
    Unavailable,
    UnsafePath,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmStorageError {
    pub code: WasmStorageErrorCode,
    pub message: &'static str,
}

impl WasmStorageError {
    fn new(code: WasmStorageErrorCode, message: &'static str) -> Self {
        Self { code, message }
    }
}

impl std::fmt::Display for WasmStorageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for WasmStorageError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WasmStorageSource {
    Primary,
    Backup,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredWasmBundle {
    pub entrypoint: PluginWasmEntrypoint,
    pub receipt: WasmAdmissionReceipt,
    pub module_bytes: Vec<u8>,
    pub source: WasmStorageSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoragePointer {
    schema: String,
    schema_version: u32,
    generation_id: String,
    identity: WasmPluginIdentity,
    module_sha256: String,
    entrypoint: PluginWasmEntrypoint,
}

pub fn validate_plugin_wasm_entrypoint(
    entrypoint: &PluginWasmEntrypoint,
) -> Result<(), WasmStorageError> {
    let path = entrypoint.module.as_str();
    let segments = path.split('/').collect::<Vec<_>>();
    let safe_path = !path.is_empty()
        && path.len() <= 240
        && path.starts_with("runtime/")
        && path.ends_with(".wasm")
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains('\0')
        && !path.contains(':')
        && segments
            .iter()
            .all(|segment| !segment.is_empty() && *segment != "." && *segment != "..");
    if entrypoint.schema != AXIOM_PLUGIN_WASM_RUNTIME_SCHEMA
        || entrypoint.schema_version != AXIOM_PLUGIN_WASM_RUNTIME_SCHEMA_VERSION
        || entrypoint.abi != AXIOM_WASM_ABI_NAME
        || !safe_path
    {
        return Err(WasmStorageError::new(
            WasmStorageErrorCode::InvalidEntrypoint,
            "The WebAssembly package entry point is invalid or unsupported.",
        ));
    }
    Ok(())
}

pub fn store_wasm_bundle(
    storage_root: &Path,
    entrypoint: &PluginWasmEntrypoint,
    receipt: &WasmAdmissionReceipt,
    expected_identity: &WasmPluginIdentity,
    module_bytes: &[u8],
) -> Result<(), WasmStorageError> {
    validate_plugin_wasm_entrypoint(entrypoint)?;
    validate_identity(expected_identity)?;
    validate_admission_receipt(receipt, expected_identity, module_bytes).map_err(|_| {
        WasmStorageError::new(
            WasmStorageErrorCode::InvalidAdmission,
            "The WebAssembly module does not match its admission receipt.",
        )
    })?;

    let storage_root = ensure_directory(storage_root, None)?;
    let plugin_directory = ensure_directory(
        &storage_root.join(&expected_identity.plugin_id),
        Some(&storage_root),
    )?;
    let generations_directory = ensure_directory(
        &plugin_directory.join(GENERATIONS_DIRECTORY),
        Some(&plugin_directory),
    )?;
    let generation_id = generation_id(entrypoint, receipt);
    let generation_directory = generations_directory.join(&generation_id);

    if generation_directory.exists() {
        ensure_direct_child(&generations_directory, &generation_directory)?;
        let stored_receipt =
            read_generation(&generation_directory, expected_identity, module_bytes)?;
        if stored_receipt != *receipt {
            return Err(invalid_bundle());
        }
    } else {
        let staging_directory =
            generations_directory.join(format!(".{generation_id}.staging-{}", Uuid::new_v4()));
        fs::create_dir(&staging_directory).map_err(|_| unavailable())?;
        let write_result = (|| {
            write_new_synced(&staging_directory.join(MODULE_FILE), module_bytes)?;
            let receipt_bytes = serde_json::to_vec_pretty(receipt).map_err(|_| unavailable())?;
            write_new_synced(&staging_directory.join(RECEIPT_FILE), &receipt_bytes)?;
            let stored_receipt =
                read_generation(&staging_directory, expected_identity, module_bytes)?;
            if stored_receipt != *receipt {
                return Err(invalid_bundle());
            }
            fs::rename(&staging_directory, &generation_directory).map_err(|_| unavailable())?;
            Ok(())
        })();
        if write_result.is_err() {
            cleanup_staging(&staging_directory);
        }
        write_result?;
    }

    let pointer = StoragePointer {
        schema: AXIOM_WASM_STORAGE_POINTER_SCHEMA.to_owned(),
        schema_version: AXIOM_WASM_STORAGE_POINTER_SCHEMA_VERSION,
        generation_id,
        identity: expected_identity.clone(),
        module_sha256: receipt.module_sha256.clone(),
        entrypoint: entrypoint.clone(),
    };
    write_pointer(&plugin_directory.join(CURRENT_POINTER_FILE), &pointer)
}

pub fn load_wasm_bundle(
    storage_root: &Path,
    expected_identity: &WasmPluginIdentity,
) -> Result<StoredWasmBundle, WasmStorageError> {
    validate_identity(expected_identity)?;
    let plugin_directory = checked_plugin_directory(storage_root, &expected_identity.plugin_id)?;
    let pointer_path = plugin_directory.join(CURRENT_POINTER_FILE);
    match load_from_pointer(
        &plugin_directory,
        &pointer_path,
        expected_identity,
        WasmStorageSource::Primary,
    ) {
        Ok(bundle) => Ok(bundle),
        Err(primary_error) => load_from_pointer(
            &plugin_directory,
            &backup_path(&pointer_path),
            expected_identity,
            WasmStorageSource::Backup,
        )
        .or(Err(primary_error)),
    }
}

/// Loads only the current primary generation for a plugin ID. Lifecycle
/// authorization must use this function so an older backup cannot become
/// executable without an explicit rollback transition.
pub fn load_current_wasm_bundle(
    storage_root: &Path,
    plugin_id: &str,
) -> Result<StoredWasmBundle, WasmStorageError> {
    if !is_valid_plugin_id(plugin_id) {
        return Err(WasmStorageError::new(
            WasmStorageErrorCode::InvalidIdentity,
            "The WebAssembly plugin identity is invalid.",
        ));
    }
    let plugin_directory = checked_plugin_directory(storage_root, plugin_id)?;
    let pointer = read_unbound_pointer(&plugin_directory.join(CURRENT_POINTER_FILE))?;
    validate_identity(&pointer.identity)?;
    if pointer.identity.plugin_id != plugin_id {
        return Err(invalid_bundle());
    }
    let (module_bytes, receipt) = validate_pointer_generation(&plugin_directory, &pointer)?;
    Ok(StoredWasmBundle {
        entrypoint: pointer.entrypoint,
        receipt,
        module_bytes,
        source: WasmStorageSource::Primary,
    })
}

pub fn rollback_wasm_bundle(
    storage_root: &Path,
    expected_identity: &WasmPluginIdentity,
) -> Result<StoredWasmBundle, WasmStorageError> {
    validate_identity(expected_identity)?;
    let plugin_directory = checked_plugin_directory(storage_root, &expected_identity.plugin_id)?;
    let pointer_path = plugin_directory.join(CURRENT_POINTER_FILE);
    let backup_pointer = read_pointer(&backup_path(&pointer_path), expected_identity)?;
    validate_pointer_generation(&plugin_directory, &backup_pointer)?;
    write_pointer(&pointer_path, &backup_pointer)?;
    load_from_pointer(
        &plugin_directory,
        &pointer_path,
        expected_identity,
        WasmStorageSource::Primary,
    )
}

pub fn remove_wasm_plugin_storage(
    storage_root: &Path,
    plugin_id: &str,
) -> Result<bool, WasmStorageError> {
    if !is_valid_plugin_id(plugin_id) {
        return Err(WasmStorageError::new(
            WasmStorageErrorCode::InvalidIdentity,
            "The WebAssembly plugin identity is invalid.",
        ));
    }
    if !storage_root.exists() {
        return Ok(false);
    }
    let canonical_root = fs::canonicalize(storage_root).map_err(|_| unavailable())?;
    let plugin_directory = storage_root.join(plugin_id);
    if !plugin_directory.exists() {
        return Ok(false);
    }
    if path_is_link_or_reparse(&plugin_directory)? {
        return Err(unsafe_path());
    }
    let canonical_plugin = fs::canonicalize(&plugin_directory).map_err(|_| unavailable())?;
    if canonical_plugin == canonical_root
        || canonical_plugin.parent() != Some(canonical_root.as_path())
    {
        return Err(unsafe_path());
    }
    fs::remove_dir_all(&canonical_plugin).map_err(|_| unavailable())?;
    Ok(true)
}

fn load_from_pointer(
    plugin_directory: &Path,
    pointer_path: &Path,
    expected_identity: &WasmPluginIdentity,
    source: WasmStorageSource,
) -> Result<StoredWasmBundle, WasmStorageError> {
    let pointer = read_pointer(pointer_path, expected_identity)?;
    let (module_bytes, receipt) = validate_pointer_generation(plugin_directory, &pointer)?;
    Ok(StoredWasmBundle {
        entrypoint: pointer.entrypoint,
        receipt,
        module_bytes,
        source,
    })
}

fn validate_pointer_generation(
    plugin_directory: &Path,
    pointer: &StoragePointer,
) -> Result<(Vec<u8>, WasmAdmissionReceipt), WasmStorageError> {
    let generations_directory = plugin_directory.join(GENERATIONS_DIRECTORY);
    ensure_direct_child(plugin_directory, &generations_directory)?;
    let generation_directory = generations_directory.join(&pointer.generation_id);
    ensure_direct_child(&generations_directory, &generation_directory)?;
    let module_bytes = read_bounded(
        &generation_directory.join(MODULE_FILE),
        ISOLATED_COMPUTE_POLICY_V1.max_module_bytes as u64,
    )?;
    let receipt = read_generation(&generation_directory, &pointer.identity, &module_bytes)?;
    if receipt.module_sha256 != pointer.module_sha256
        || generation_id(&pointer.entrypoint, &receipt) != pointer.generation_id
    {
        return Err(invalid_bundle());
    }
    Ok((module_bytes, receipt))
}

fn read_generation(
    generation_directory: &Path,
    expected_identity: &WasmPluginIdentity,
    expected_module: &[u8],
) -> Result<WasmAdmissionReceipt, WasmStorageError> {
    let stored_module = read_bounded(
        &generation_directory.join(MODULE_FILE),
        ISOLATED_COMPUTE_POLICY_V1.max_module_bytes as u64,
    )?;
    if stored_module != expected_module {
        return Err(invalid_bundle());
    }
    let receipt_bytes = read_bounded(&generation_directory.join(RECEIPT_FILE), MAX_RECEIPT_BYTES)?;
    let receipt: WasmAdmissionReceipt =
        serde_json::from_slice(&receipt_bytes).map_err(|_| invalid_bundle())?;
    validate_admission_receipt(&receipt, expected_identity, &stored_module)
        .map_err(|_| invalid_bundle())?;
    Ok(receipt)
}

fn read_pointer(
    path: &Path,
    expected_identity: &WasmPluginIdentity,
) -> Result<StoragePointer, WasmStorageError> {
    let pointer = read_unbound_pointer(path)?;
    if pointer.identity != *expected_identity {
        return Err(invalid_bundle());
    }
    Ok(pointer)
}

fn read_unbound_pointer(path: &Path) -> Result<StoragePointer, WasmStorageError> {
    let bytes = read_bounded(path, MAX_POINTER_BYTES)?;
    let pointer: StoragePointer = serde_json::from_slice(&bytes).map_err(|_| invalid_bundle())?;
    validate_plugin_wasm_entrypoint(&pointer.entrypoint)?;
    if pointer.schema != AXIOM_WASM_STORAGE_POINTER_SCHEMA
        || pointer.schema_version != AXIOM_WASM_STORAGE_POINTER_SCHEMA_VERSION
        || !is_generation_id(&pointer.generation_id)
        || !is_sha256(&pointer.module_sha256)
    {
        return Err(invalid_bundle());
    }
    Ok(pointer)
}

fn write_pointer(path: &Path, pointer: &StoragePointer) -> Result<(), WasmStorageError> {
    let encoded = serde_json::to_vec_pretty(pointer).map_err(|_| unavailable())?;
    atomic_write_verified(path, &encoded, true, |candidate| {
        let candidate_bytes = fs::read(candidate)?;
        let parsed: StoragePointer = serde_json::from_slice(&candidate_bytes)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if parsed != *pointer {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "WebAssembly storage pointer verification failed",
            ));
        }
        Ok(())
    })
    .map_err(|_| unavailable())
}

fn generation_id(entrypoint: &PluginWasmEntrypoint, receipt: &WasmAdmissionReceipt) -> String {
    let mut digest = Sha256::new();
    for value in [
        "axiom-wasm-storage-generation-v1",
        receipt.identity.plugin_id.as_str(),
        receipt.identity.plugin_version.as_str(),
        &receipt.identity.data_version.to_string(),
        receipt.module_sha256.as_str(),
        entrypoint.schema.as_str(),
        &entrypoint.schema_version.to_string(),
        entrypoint.abi.as_str(),
        entrypoint.module.as_str(),
    ] {
        digest.update(value.as_bytes());
        digest.update([0]);
    }
    format!("g1-{:x}", digest.finalize())
}

fn validate_identity(identity: &WasmPluginIdentity) -> Result<(), WasmStorageError> {
    validate_wasm_plugin_identity(identity).map_err(|_| {
        WasmStorageError::new(
            WasmStorageErrorCode::InvalidIdentity,
            "The WebAssembly plugin identity is invalid.",
        )
    })
}

fn ensure_directory(
    path: &Path,
    expected_parent: Option<&Path>,
) -> Result<PathBuf, WasmStorageError> {
    fs::create_dir_all(path).map_err(|_| unavailable())?;
    if expected_parent.is_some() && path_is_link_or_reparse(path)? {
        return Err(unsafe_path());
    }
    let canonical = fs::canonicalize(path).map_err(|_| unavailable())?;
    if let Some(parent) = expected_parent {
        let canonical_parent = fs::canonicalize(parent).map_err(|_| unavailable())?;
        if canonical.parent() != Some(canonical_parent.as_path()) {
            return Err(unsafe_path());
        }
    }
    Ok(canonical)
}

fn checked_plugin_directory(
    storage_root: &Path,
    plugin_id: &str,
) -> Result<PathBuf, WasmStorageError> {
    if !storage_root.exists() {
        return Err(unavailable());
    }
    let canonical_root = fs::canonicalize(storage_root).map_err(|_| unavailable())?;
    let plugin_directory = storage_root.join(plugin_id);
    ensure_direct_child(&canonical_root, &plugin_directory)
}

fn ensure_direct_child(parent: &Path, child: &Path) -> Result<PathBuf, WasmStorageError> {
    if path_is_link_or_reparse(child)? {
        return Err(unsafe_path());
    }
    let canonical_parent = fs::canonicalize(parent).map_err(|_| unavailable())?;
    let canonical_child = fs::canonicalize(child).map_err(|_| unavailable())?;
    if canonical_child == canonical_parent
        || canonical_child.parent() != Some(canonical_parent.as_path())
    {
        return Err(unsafe_path());
    }
    Ok(canonical_child)
}

fn read_bounded(path: &Path, maximum_bytes: u64) -> Result<Vec<u8>, WasmStorageError> {
    if path_is_link_or_reparse(path)? {
        return Err(unsafe_path());
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| unavailable())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > maximum_bytes {
        return Err(invalid_bundle());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)
        .map_err(|_| unavailable())?
        .take(maximum_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable())?;
    if bytes.len() as u64 > maximum_bytes {
        return Err(invalid_bundle());
    }
    Ok(bytes)
}

fn path_is_link_or_reparse(path: &Path) -> Result<bool, WasmStorageError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| unavailable())?;
    if metadata.file_type().is_symlink() {
        return Ok(true);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

        Ok(metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
    }
    #[cfg(not(windows))]
    Ok(false)
}

fn write_new_synced(path: &Path, content: &[u8]) -> Result<(), WasmStorageError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| unavailable())?;
    file.write_all(content).map_err(|_| unavailable())?;
    file.sync_all().map_err(|_| unavailable())
}

fn cleanup_staging(path: &Path) {
    let _ = fs::remove_file(path.join(MODULE_FILE));
    let _ = fs::remove_file(path.join(RECEIPT_FILE));
    let _ = fs::remove_dir(path);
}

fn is_generation_id(value: &str) -> bool {
    value.len() == 67
        && value.starts_with("g1-")
        && value[3..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn invalid_bundle() -> WasmStorageError {
    WasmStorageError::new(
        WasmStorageErrorCode::InvalidBundle,
        "The stored WebAssembly bundle is invalid or has been modified.",
    )
}

fn unavailable() -> WasmStorageError {
    WasmStorageError::new(
        WasmStorageErrorCode::Unavailable,
        "The WebAssembly bundle storage is unavailable.",
    )
}

fn unsafe_path() -> WasmStorageError {
    WasmStorageError::new(
        WasmStorageErrorCode::UnsafePath,
        "The WebAssembly bundle storage path escaped its app-owned directory.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        plugin_wasm_admission::{
            module_sha256, AXIOM_WASM_ADMISSION_SCHEMA, AXIOM_WASM_ADMISSION_SCHEMA_VERSION,
            WASM_COMPILER_CPU_TIME_LIMIT_MS, WASM_COMPILER_MEMORY_LIMIT_BYTES,
            WASM_COMPILER_WALL_DEADLINE_MS,
        },
        plugin_wasm_host::{AXIOM_WASM_ABI_VERSION, WASMTIME_ENGINE_VERSION},
    };

    fn identity(version: &str) -> WasmPluginIdentity {
        WasmPluginIdentity {
            plugin_id: "org.axiom.storage-fixture".to_owned(),
            plugin_version: version.to_owned(),
            data_version: 2,
        }
    }

    fn entrypoint() -> PluginWasmEntrypoint {
        PluginWasmEntrypoint {
            schema: AXIOM_PLUGIN_WASM_RUNTIME_SCHEMA.to_owned(),
            schema_version: AXIOM_PLUGIN_WASM_RUNTIME_SCHEMA_VERSION,
            abi: AXIOM_WASM_ABI_NAME.to_owned(),
            module: "runtime/plugin.wasm".to_owned(),
        }
    }

    fn receipt(identity: &WasmPluginIdentity, module_bytes: &[u8]) -> WasmAdmissionReceipt {
        WasmAdmissionReceipt {
            schema: AXIOM_WASM_ADMISSION_SCHEMA.to_owned(),
            schema_version: AXIOM_WASM_ADMISSION_SCHEMA_VERSION,
            identity: identity.clone(),
            module_sha256: module_sha256(module_bytes),
            module_bytes: module_bytes.len() as u64,
            compiled_artifact_bytes: 4096,
            abi_name: AXIOM_WASM_ABI_NAME.to_owned(),
            abi_version: AXIOM_WASM_ABI_VERSION,
            compute_policy_version: ISOLATED_COMPUTE_POLICY_V1.policy_version,
            engine: "wasmtime".to_owned(),
            engine_version: WASMTIME_ENGINE_VERSION.to_owned(),
            helper_memory_limit_bytes: WASM_COMPILER_MEMORY_LIMIT_BYTES as u64,
            helper_cpu_time_limit_ms: WASM_COMPILER_CPU_TIME_LIMIT_MS,
            helper_wall_deadline_ms: WASM_COMPILER_WALL_DEADLINE_MS,
        }
    }

    #[test]
    fn entrypoint_contract_is_versioned_and_portable() {
        validate_plugin_wasm_entrypoint(&entrypoint()).unwrap();
        for module in [
            "../plugin.wasm",
            "plugin.wasm",
            "runtime/plugin.js",
            "runtime\\plugin.wasm",
        ] {
            let mut invalid = entrypoint();
            invalid.module = module.to_owned();
            assert_eq!(
                validate_plugin_wasm_entrypoint(&invalid).unwrap_err().code,
                WasmStorageErrorCode::InvalidEntrypoint
            );
        }
    }

    #[test]
    fn stores_updates_loads_and_atomically_rolls_back_identity_bound_bundles() {
        let directory = tempfile::tempdir().unwrap();
        let first_identity = identity("1.0.0");
        let second_identity = identity("1.1.0");
        let first_module = b"first-module";
        let second_module = b"second-module";

        store_wasm_bundle(
            directory.path(),
            &entrypoint(),
            &receipt(&first_identity, first_module),
            &first_identity,
            first_module,
        )
        .unwrap();
        store_wasm_bundle(
            directory.path(),
            &entrypoint(),
            &receipt(&second_identity, second_module),
            &second_identity,
            second_module,
        )
        .unwrap();

        let current = load_wasm_bundle(directory.path(), &second_identity).unwrap();
        assert_eq!(current.module_bytes, second_module);
        assert_eq!(current.source, WasmStorageSource::Primary);
        assert_eq!(
            load_current_wasm_bundle(directory.path(), &second_identity.plugin_id)
                .unwrap()
                .receipt
                .identity,
            second_identity
        );
        let previous = load_wasm_bundle(directory.path(), &first_identity).unwrap();
        assert_eq!(previous.module_bytes, first_module);
        assert_eq!(previous.source, WasmStorageSource::Backup);

        let rolled_back = rollback_wasm_bundle(directory.path(), &first_identity).unwrap();
        assert_eq!(rolled_back.module_bytes, first_module);
        assert_eq!(rolled_back.source, WasmStorageSource::Primary);
        assert_eq!(
            load_wasm_bundle(directory.path(), &second_identity)
                .unwrap()
                .source,
            WasmStorageSource::Backup
        );
    }

    #[test]
    fn rejects_tampering_and_a_failed_update_leaves_current_usable() {
        let directory = tempfile::tempdir().unwrap();
        let first_identity = identity("1.0.0");
        let first_module = b"first-module";
        store_wasm_bundle(
            directory.path(),
            &entrypoint(),
            &receipt(&first_identity, first_module),
            &first_identity,
            first_module,
        )
        .unwrap();

        let second_identity = identity("1.1.0");
        let second_module = b"second-module";
        let invalid_update = store_wasm_bundle(
            directory.path(),
            &entrypoint(),
            &receipt(&second_identity, second_module),
            &second_identity,
            b"different-module",
        )
        .unwrap_err();
        assert_eq!(invalid_update.code, WasmStorageErrorCode::InvalidAdmission);
        assert_eq!(
            load_wasm_bundle(directory.path(), &first_identity)
                .unwrap()
                .module_bytes,
            first_module
        );

        let plugin_directory = directory.path().join(&first_identity.plugin_id);
        let pointer: StoragePointer =
            serde_json::from_slice(&fs::read(plugin_directory.join(CURRENT_POINTER_FILE)).unwrap())
                .unwrap();
        fs::write(
            plugin_directory
                .join(GENERATIONS_DIRECTORY)
                .join(pointer.generation_id)
                .join(MODULE_FILE),
            b"tampered",
        )
        .unwrap();
        assert_eq!(
            load_wasm_bundle(directory.path(), &first_identity)
                .unwrap_err()
                .code,
            WasmStorageErrorCode::InvalidBundle
        );
    }

    #[test]
    fn uninstall_cleanup_is_exact_and_rejects_escaping_ids() {
        let directory = tempfile::tempdir().unwrap();
        let plugin_identity = identity("1.0.0");
        let module = b"module";
        store_wasm_bundle(
            directory.path(),
            &entrypoint(),
            &receipt(&plugin_identity, module),
            &plugin_identity,
            module,
        )
        .unwrap();
        let sentinel = directory.path().join("sentinel.txt");
        fs::write(&sentinel, b"keep").unwrap();

        assert_eq!(
            remove_wasm_plugin_storage(directory.path(), "../escape")
                .unwrap_err()
                .code,
            WasmStorageErrorCode::InvalidIdentity
        );
        assert!(remove_wasm_plugin_storage(directory.path(), &plugin_identity.plugin_id).unwrap());
        assert!(sentinel.exists());
        assert!(!directory.path().join(plugin_identity.plugin_id).exists());
    }
}
