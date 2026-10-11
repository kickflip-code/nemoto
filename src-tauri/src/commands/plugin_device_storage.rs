use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::Path;
use std::sync::Mutex;

use chrono::{DateTime, SecondsFormat, Utc};
use keyring::v1::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::command;

use crate::commands::plugins::is_valid_plugin_id;
use crate::error::AppError;
use crate::utils::atomic_file::atomic_write_json;
use crate::utils::paths::{get_plugin_device_settings_dir, get_plugin_secret_index_dir};
use crate::utils::paths::{get_plugin_device_settings_path, get_plugin_secret_index_path};

const SETTINGS_STATE_SCHEMA: &str = "axiom.plugin-device-settings-state";
const SETTINGS_TRANSACTION_SCHEMA: &str = "axiom.plugin-device-settings-transaction";
const SETTINGS_RESULT_SCHEMA: &str = "axiom.plugin-device-settings-transaction-result";
const SETTINGS_SCOPE: &str = "device-settings";
const SECRET_INDEX_SCHEMA: &str = "axiom.plugin-device-secret-index";
const SECRET_SET_SCHEMA: &str = "axiom.plugin-device-secret-set";
const SECRET_DELETE_SCHEMA: &str = "axiom.plugin-device-secret-delete";
const SECRET_RESULT_SCHEMA: &str = "axiom.plugin-device-secret-mutation-result";
const SECRET_SNAPSHOT_SCHEMA: &str = "axiom.plugin-device-secret";
const SECRETS_SCOPE: &str = "device-secrets";
const SCHEMA_VERSION: u32 = 1;
const MAX_SETTINGS_BYTES: usize = 1024 * 1024;
const MAX_SETTING_BYTES: usize = 128 * 1024;
const MAX_SETTINGS_DOCUMENTS: usize = 500;
const MAX_SETTINGS_OPERATIONS: usize = 50;
const MAX_SECRET_BYTES: usize = 2_048;
const MAX_SECRETS: usize = 64;

static DEVICE_STORAGE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredSetting {
    document_version: u64,
    updated_at: String,
    value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeviceSettingsState {
    schema: String,
    schema_version: u32,
    plugin_id: String,
    revision: u64,
    documents: BTreeMap<String, StoredSetting>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum SettingsOperation {
    #[serde(rename = "put")]
    Put {
        operation_id: String,
        key: String,
        expected_document_version: Option<u64>,
        value: Value,
    },
    #[serde(rename = "delete")]
    Delete {
        operation_id: String,
        key: String,
        expected_document_version: Option<u64>,
    },
}

impl SettingsOperation {
    fn operation_id(&self) -> &str {
        match self {
            Self::Put { operation_id, .. } | Self::Delete { operation_id, .. } => operation_id,
        }
    }

    fn key(&self) -> &str {
        match self {
            Self::Put { key, .. } | Self::Delete { key, .. } => key,
        }
    }

    fn expected_document_version(&self) -> Option<u64> {
        match self {
            Self::Put {
                expected_document_version,
                ..
            }
            | Self::Delete {
                expected_document_version,
                ..
            } => *expected_document_version,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsTransaction {
    schema: String,
    schema_version: u32,
    scope: String,
    expected_namespace_revision: u64,
    operations: Vec<SettingsOperation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsOperationResult {
    operation_id: String,
    key: String,
    document_version: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsTransactionResult {
    schema: &'static str,
    schema_version: u32,
    scope: &'static str,
    namespace_revision: u64,
    operations: Vec<SettingsOperationResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SecretMetadata {
    secret_version: u64,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SecretIndex {
    schema: String,
    schema_version: u32,
    plugin_id: String,
    revision: u64,
    entries: BTreeMap<String, SecretMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SecretSetRequest {
    schema: String,
    schema_version: u32,
    scope: String,
    key: String,
    expected_secret_version: Option<u64>,
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SecretDeleteRequest {
    schema: String,
    schema_version: u32,
    scope: String,
    key: String,
    expected_secret_version: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretMutationResult {
    schema: &'static str,
    schema_version: u32,
    scope: &'static str,
    namespace_revision: u64,
    key: String,
    secret_version: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretSnapshot {
    schema: &'static str,
    schema_version: u32,
    scope: &'static str,
    namespace_revision: u64,
    key: String,
    secret_version: u64,
    updated_at: String,
    value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceStorageAdminSummary {
    plugin_id: String,
    has_settings: bool,
    settings_document_count: usize,
    settings_bytes: usize,
    has_secret_index: bool,
    secret_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceStorageClearResult {
    plugin_id: String,
    settings_removed: bool,
    settings_documents_cleared: usize,
    secret_index_removed: bool,
    secrets_cleared: usize,
}

trait CredentialStore {
    fn get(&self, plugin_id: &str, key: &str) -> Result<Option<String>, AppError>;
    fn set(&self, plugin_id: &str, key: &str, value: &str) -> Result<(), AppError>;
    fn delete(&self, plugin_id: &str, key: &str) -> Result<(), AppError>;
}

struct OsCredentialStore;

impl OsCredentialStore {
    fn entry(plugin_id: &str, key: &str) -> Result<Entry, AppError> {
        Entry::new(&format!("axiom.plugin.{plugin_id}"), key)
            .map_err(|_| AppError::PluginSecretStoreUnavailable)
    }
}

impl CredentialStore for OsCredentialStore {
    fn get(&self, plugin_id: &str, key: &str) -> Result<Option<String>, AppError> {
        match Self::entry(plugin_id, key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err(AppError::PluginSecretStoreUnavailable),
        }
    }

    fn set(&self, plugin_id: &str, key: &str, value: &str) -> Result<(), AppError> {
        Self::entry(plugin_id, key)?
            .set_password(value)
            .map_err(|_| AppError::PluginSecretStoreUnavailable)
    }

    fn delete(&self, plugin_id: &str, key: &str) -> Result<(), AppError> {
        match Self::entry(plugin_id, key)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(_) => Err(AppError::PluginSecretStoreUnavailable),
        }
    }
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn validate_plugin_id(plugin_id: &str) -> Result<(), AppError> {
    if is_valid_plugin_id(plugin_id) {
        Ok(())
    } else {
        Err(AppError::Validation(
            "Plugin ID must be a lowercase reverse-domain identifier".to_string(),
        ))
    }
}

fn is_valid_key(key: &str) -> bool {
    if key.is_empty() || key.len() > 160 || key.ends_with('/') {
        return false;
    }
    if !key.as_bytes().iter().enumerate().all(|(index, byte)| {
        byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b'/' | b'-'))
    }) {
        return false;
    }
    key.split('/').all(|segment| {
        !segment.is_empty()
            && !matches!(
                segment,
                "." | ".." | "__proto__" | "constructor" | "prototype"
            )
    })
}

fn validate_key(key: &str) -> Result<(), AppError> {
    if is_valid_key(key) {
        Ok(())
    } else {
        Err(AppError::Validation(
            "Invalid plugin device-storage key".to_string(),
        ))
    }
}

fn empty_settings(plugin_id: &str) -> DeviceSettingsState {
    DeviceSettingsState {
        schema: SETTINGS_STATE_SCHEMA.to_string(),
        schema_version: SCHEMA_VERSION,
        plugin_id: plugin_id.to_string(),
        revision: 0,
        documents: BTreeMap::new(),
    }
}

fn validate_settings_state(state: &DeviceSettingsState, plugin_id: &str) -> Result<(), AppError> {
    if state.schema != SETTINGS_STATE_SCHEMA
        || state.schema_version != SCHEMA_VERSION
        || state.plugin_id != plugin_id
        || state.documents.len() > MAX_SETTINGS_DOCUMENTS
    {
        return Err(AppError::PluginDeviceStorageData);
    }
    for (key, document) in &state.documents {
        if !is_valid_key(key) {
            return Err(AppError::PluginDeviceStorageData);
        }
        if document.document_version == 0
            || document.updated_at.len() > 64
            || DateTime::parse_from_rfc3339(&document.updated_at).is_err()
            || serde_json::to_vec(&document.value)?.len() > MAX_SETTING_BYTES
        {
            return Err(AppError::PluginDeviceStorageData);
        }
    }
    if serde_json::to_vec(state)?.len() > MAX_SETTINGS_BYTES {
        return Err(AppError::PluginDeviceStorageData);
    }
    Ok(())
}

fn read_settings_at(path: &Path, plugin_id: &str) -> Result<DeviceSettingsState, AppError> {
    validate_plugin_id(plugin_id)?;
    if !path.exists() {
        return Ok(empty_settings(plugin_id));
    }
    if fs::metadata(path)?.len() > MAX_SETTINGS_BYTES as u64 {
        return Err(AppError::PluginDeviceStorageData);
    }
    let state: DeviceSettingsState =
        serde_json::from_slice(&fs::read(path)?).map_err(|_| AppError::PluginDeviceStorageData)?;
    validate_settings_state(&state, plugin_id)?;
    Ok(state)
}

fn write_settings_at(path: &Path, state: &DeviceSettingsState) -> Result<(), AppError> {
    validate_settings_state(state, &state.plugin_id)?;
    let content = serde_json::to_string(state)?;
    atomic_write_json(path, &content, false)?;
    Ok(())
}

fn validate_settings_transaction(transaction: &SettingsTransaction) -> Result<(), AppError> {
    if transaction.schema != SETTINGS_TRANSACTION_SCHEMA
        || transaction.schema_version != SCHEMA_VERSION
        || transaction.scope != SETTINGS_SCOPE
        || transaction.operations.is_empty()
        || transaction.operations.len() > MAX_SETTINGS_OPERATIONS
    {
        return Err(AppError::Validation(
            "Invalid plugin device-settings transaction".to_string(),
        ));
    }
    let mut operation_ids = HashSet::new();
    let mut keys = HashSet::new();
    for operation in &transaction.operations {
        if operation.operation_id().is_empty()
            || operation.operation_id().len() > 160
            || !operation_ids.insert(operation.operation_id())
            || !keys.insert(operation.key())
        {
            return Err(AppError::Validation(
                "Invalid plugin device-settings transaction".to_string(),
            ));
        }
        validate_key(operation.key())?;
        if let SettingsOperation::Put { value, .. } = operation {
            if serde_json::to_vec(value)?.len() > MAX_SETTING_BYTES {
                return Err(AppError::Validation(
                    "A plugin device setting exceeds the size limit".to_string(),
                ));
            }
        }
    }
    Ok(())
}

fn transact_settings_at(
    path: &Path,
    plugin_id: &str,
    transaction_value: Value,
    timestamp: &str,
) -> Result<SettingsTransactionResult, AppError> {
    let transaction: SettingsTransaction = serde_json::from_value(transaction_value)?;
    validate_settings_transaction(&transaction)?;
    let mut state = read_settings_at(path, plugin_id)?;
    if transaction.expected_namespace_revision != state.revision {
        return Err(AppError::PluginDeviceStorageRevisionConflict {
            expected_revision: transaction.expected_namespace_revision,
            actual_revision: state.revision,
        });
    }
    let mut changed = false;
    let mut results = Vec::with_capacity(transaction.operations.len());
    for operation in transaction.operations {
        let key = operation.key().to_string();
        let actual_version = state.documents.get(&key).map(|item| item.document_version);
        if actual_version != operation.expected_document_version() {
            return Err(AppError::PluginDeviceDocumentConflict {
                key,
                expected_version: operation.expected_document_version(),
                actual_version,
            });
        }
        match operation {
            SettingsOperation::Put {
                operation_id,
                value,
                ..
            } => {
                let document_version = actual_version.unwrap_or(0) + 1;
                state.documents.insert(
                    key.clone(),
                    StoredSetting {
                        document_version,
                        updated_at: timestamp.to_string(),
                        value,
                    },
                );
                changed = true;
                results.push(SettingsOperationResult {
                    operation_id,
                    key,
                    document_version: Some(document_version),
                });
            }
            SettingsOperation::Delete { operation_id, .. } => {
                if state.documents.remove(&key).is_some() {
                    changed = true;
                }
                results.push(SettingsOperationResult {
                    operation_id,
                    key,
                    document_version: None,
                });
            }
        }
    }
    if changed {
        state.revision += 1;
        if state.documents.len() > MAX_SETTINGS_DOCUMENTS
            || serde_json::to_vec(&state)?.len() > MAX_SETTINGS_BYTES
        {
            return Err(AppError::PluginDeviceStorageQuota);
        }
        write_settings_at(path, &state)?;
    }
    Ok(SettingsTransactionResult {
        schema: SETTINGS_RESULT_SCHEMA,
        schema_version: SCHEMA_VERSION,
        scope: SETTINGS_SCOPE,
        namespace_revision: state.revision,
        operations: results,
    })
}

fn empty_secret_index(plugin_id: &str) -> SecretIndex {
    SecretIndex {
        schema: SECRET_INDEX_SCHEMA.to_string(),
        schema_version: SCHEMA_VERSION,
        plugin_id: plugin_id.to_string(),
        revision: 0,
        entries: BTreeMap::new(),
    }
}

fn validate_secret_index(index: &SecretIndex, plugin_id: &str) -> Result<(), AppError> {
    if index.schema != SECRET_INDEX_SCHEMA
        || index.schema_version != SCHEMA_VERSION
        || index.plugin_id != plugin_id
        || index.entries.len() > MAX_SECRETS
    {
        return Err(AppError::PluginDeviceStorageData);
    }
    for (key, metadata) in &index.entries {
        if !is_valid_key(key) {
            return Err(AppError::PluginDeviceStorageData);
        }
        if metadata.secret_version == 0
            || metadata.updated_at.len() > 64
            || DateTime::parse_from_rfc3339(&metadata.updated_at).is_err()
        {
            return Err(AppError::PluginDeviceStorageData);
        }
    }
    Ok(())
}

fn read_secret_index_at(path: &Path, plugin_id: &str) -> Result<SecretIndex, AppError> {
    validate_plugin_id(plugin_id)?;
    if !path.exists() {
        return Ok(empty_secret_index(plugin_id));
    }
    if fs::metadata(path)?.len() > 64 * 1024 {
        return Err(AppError::PluginDeviceStorageData);
    }
    let index: SecretIndex =
        serde_json::from_slice(&fs::read(path)?).map_err(|_| AppError::PluginDeviceStorageData)?;
    validate_secret_index(&index, plugin_id)?;
    Ok(index)
}

fn write_secret_index_at(path: &Path, index: &SecretIndex) -> Result<(), AppError> {
    validate_secret_index(index, &index.plugin_id)?;
    let content = serde_json::to_string(index)?;
    if content.len() > 64 * 1024 {
        return Err(AppError::Validation(
            "Plugin secret metadata exceeds the size limit".to_string(),
        ));
    }
    atomic_write_json(path, &content, false)?;
    Ok(())
}

fn validate_secret_request_header(
    schema: &str,
    expected_schema: &str,
    version: u32,
    scope: &str,
) -> Result<(), AppError> {
    if schema == expected_schema && version == SCHEMA_VERSION && scope == SECRETS_SCOPE {
        Ok(())
    } else {
        Err(AppError::Validation(
            "Invalid plugin secret request".to_string(),
        ))
    }
}

fn get_secret_at(
    index_path: &Path,
    store: &dyn CredentialStore,
    plugin_id: &str,
    key: &str,
) -> Result<Option<SecretSnapshot>, AppError> {
    validate_key(key)?;
    let index = read_secret_index_at(index_path, plugin_id)?;
    let Some(metadata) = index.entries.get(key) else {
        return Ok(None);
    };
    let Some(value) = store.get(plugin_id, key)? else {
        return Ok(None);
    };
    if value.is_empty() || value.len() > MAX_SECRET_BYTES {
        return Err(AppError::Validation(
            "Stored plugin secret exceeds the supported size".to_string(),
        ));
    }
    Ok(Some(SecretSnapshot {
        schema: SECRET_SNAPSHOT_SCHEMA,
        schema_version: SCHEMA_VERSION,
        scope: SECRETS_SCOPE,
        namespace_revision: index.revision,
        key: key.to_string(),
        secret_version: metadata.secret_version,
        updated_at: metadata.updated_at.clone(),
        value,
    }))
}

fn set_secret_at(
    index_path: &Path,
    store: &dyn CredentialStore,
    plugin_id: &str,
    request_value: Value,
    timestamp: &str,
) -> Result<SecretMutationResult, AppError> {
    let request: SecretSetRequest = serde_json::from_value(request_value)?;
    validate_secret_request_header(
        &request.schema,
        SECRET_SET_SCHEMA,
        request.schema_version,
        &request.scope,
    )?;
    validate_key(&request.key)?;
    if request.value.is_empty() || request.value.len() > MAX_SECRET_BYTES {
        return Err(AppError::Validation(
            "Plugin secret exceeds the supported size".to_string(),
        ));
    }
    let mut index = read_secret_index_at(index_path, plugin_id)?;
    let actual_version = index
        .entries
        .get(&request.key)
        .map(|item| item.secret_version);
    if actual_version != request.expected_secret_version {
        return Err(AppError::PluginDeviceDocumentConflict {
            key: request.key,
            expected_version: request.expected_secret_version,
            actual_version,
        });
    }
    if actual_version.is_none() && index.entries.len() >= MAX_SECRETS {
        return Err(AppError::PluginDeviceStorageQuota);
    }
    let previous = store.get(plugin_id, &request.key)?;
    store.set(plugin_id, &request.key, &request.value)?;
    let secret_version = actual_version.unwrap_or(0) + 1;
    index.entries.insert(
        request.key.clone(),
        SecretMetadata {
            secret_version,
            updated_at: timestamp.to_string(),
        },
    );
    index.revision += 1;
    if let Err(error) = write_secret_index_at(index_path, &index) {
        let rollback = match previous {
            Some(ref value) => store.set(plugin_id, &request.key, value),
            None => store.delete(plugin_id, &request.key),
        };
        if rollback.is_err() {
            return Err(AppError::Internal(
                "Credential update could not be completed safely".to_string(),
            ));
        }
        return Err(error);
    }
    Ok(SecretMutationResult {
        schema: SECRET_RESULT_SCHEMA,
        schema_version: SCHEMA_VERSION,
        scope: SECRETS_SCOPE,
        namespace_revision: index.revision,
        key: request.key,
        secret_version: Some(secret_version),
    })
}

fn delete_secret_at(
    index_path: &Path,
    store: &dyn CredentialStore,
    plugin_id: &str,
    request_value: Value,
) -> Result<SecretMutationResult, AppError> {
    let request: SecretDeleteRequest = serde_json::from_value(request_value)?;
    validate_secret_request_header(
        &request.schema,
        SECRET_DELETE_SCHEMA,
        request.schema_version,
        &request.scope,
    )?;
    validate_key(&request.key)?;
    let mut index = read_secret_index_at(index_path, plugin_id)?;
    let actual_version = index
        .entries
        .get(&request.key)
        .map(|item| item.secret_version);
    if actual_version != request.expected_secret_version {
        return Err(AppError::PluginDeviceDocumentConflict {
            key: request.key,
            expected_version: request.expected_secret_version,
            actual_version,
        });
    }
    let previous = store.get(plugin_id, &request.key)?;
    store.delete(plugin_id, &request.key)?;
    if actual_version.is_some() {
        index.entries.remove(&request.key);
        index.revision += 1;
        if let Err(error) = write_secret_index_at(index_path, &index) {
            if let Some(value) = previous {
                if store.set(plugin_id, &request.key, &value).is_err() {
                    return Err(AppError::Internal(
                        "Credential deletion could not be completed safely".to_string(),
                    ));
                }
            }
            return Err(error);
        }
    }
    Ok(SecretMutationResult {
        schema: SECRET_RESULT_SCHEMA,
        schema_version: SCHEMA_VERSION,
        scope: SECRETS_SCOPE,
        namespace_revision: index.revision,
        key: request.key,
        secret_version: None,
    })
}

fn collect_namespace_ids(directory: &Path, ids: &mut BTreeSet<String>) -> Result<(), AppError> {
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some(plugin_id) = path.file_stem().and_then(|value| value.to_str()) else {
            return Err(AppError::PluginDeviceStorageData);
        };
        if !is_valid_plugin_id(plugin_id) {
            return Err(AppError::PluginDeviceStorageData);
        }
        ids.insert(plugin_id.to_string());
    }
    Ok(())
}

fn list_device_storage_at(
    settings_directory: &Path,
    secret_index_directory: &Path,
) -> Result<Vec<DeviceStorageAdminSummary>, AppError> {
    let mut ids = BTreeSet::new();
    collect_namespace_ids(settings_directory, &mut ids)?;
    collect_namespace_ids(secret_index_directory, &mut ids)?;

    ids.into_iter()
        .map(|plugin_id| {
            let settings_path = settings_directory.join(format!("{plugin_id}.json"));
            let secret_index_path = secret_index_directory.join(format!("{plugin_id}.json"));
            let has_settings = settings_path.exists();
            let has_secret_index = secret_index_path.exists();
            let settings = read_settings_at(&settings_path, &plugin_id)?;
            let index = read_secret_index_at(&secret_index_path, &plugin_id)?;
            Ok(DeviceStorageAdminSummary {
                plugin_id,
                has_settings,
                settings_document_count: settings.documents.len(),
                settings_bytes: serde_json::to_vec(&settings)?.len(),
                has_secret_index,
                secret_count: index.entries.len(),
            })
        })
        .collect()
}

fn restore_credentials(
    store: &dyn CredentialStore,
    plugin_id: &str,
    credentials: &[(String, String)],
) -> Result<(), AppError> {
    for (key, value) in credentials {
        store.set(plugin_id, key, value).map_err(|_| {
            AppError::Internal("Plugin device data could not be restored safely".to_string())
        })?;
    }
    Ok(())
}

fn clear_device_storage_at(
    settings_path: &Path,
    secret_index_path: &Path,
    store: &dyn CredentialStore,
    plugin_id: &str,
) -> Result<DeviceStorageClearResult, AppError> {
    validate_plugin_id(plugin_id)?;
    let settings_existed = settings_path.exists();
    let secret_index_existed = secret_index_path.exists();
    let settings = read_settings_at(settings_path, plugin_id)?;
    let index = read_secret_index_at(secret_index_path, plugin_id)?;
    let mut credentials = Vec::with_capacity(index.entries.len());
    for key in index.entries.keys() {
        if let Some(value) = store.get(plugin_id, key)? {
            credentials.push((key.clone(), value));
        }
    }

    for key in index.entries.keys() {
        if let Err(error) = store.delete(plugin_id, key) {
            restore_credentials(store, plugin_id, &credentials)?;
            return Err(error);
        }
    }

    if secret_index_existed {
        if let Err(error) = fs::remove_file(secret_index_path) {
            restore_credentials(store, plugin_id, &credentials)?;
            return Err(error.into());
        }
    }

    if settings_existed {
        if let Err(error) = fs::remove_file(settings_path) {
            if secret_index_existed {
                write_secret_index_at(secret_index_path, &index).map_err(|_| {
                    AppError::Internal(
                        "Plugin device data could not be restored safely".to_string(),
                    )
                })?;
            }
            restore_credentials(store, plugin_id, &credentials)?;
            return Err(error.into());
        }
    }

    Ok(DeviceStorageClearResult {
        plugin_id: plugin_id.to_string(),
        settings_removed: settings_existed,
        settings_documents_cleared: settings.documents.len(),
        secret_index_removed: secret_index_existed,
        secrets_cleared: index.entries.len(),
    })
}

#[command]
pub fn read_plugin_device_settings_state(plugin_id: String) -> Result<Value, AppError> {
    let _guard = DEVICE_STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::Internal("Plugin device storage lock is unavailable".to_string()))?;
    Ok(serde_json::to_value(read_settings_at(
        &get_plugin_device_settings_path(&plugin_id),
        &plugin_id,
    )?)?)
}

#[command]
pub fn transact_plugin_device_settings(
    plugin_id: String,
    transaction: Value,
) -> Result<Value, AppError> {
    let _guard = DEVICE_STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::Internal("Plugin device storage lock is unavailable".to_string()))?;
    Ok(serde_json::to_value(transact_settings_at(
        &get_plugin_device_settings_path(&plugin_id),
        &plugin_id,
        transaction,
        &now(),
    )?)?)
}

#[command]
pub fn read_plugin_secret_index(plugin_id: String) -> Result<Value, AppError> {
    let _guard = DEVICE_STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::Internal("Plugin device storage lock is unavailable".to_string()))?;
    Ok(serde_json::to_value(read_secret_index_at(
        &get_plugin_secret_index_path(&plugin_id),
        &plugin_id,
    )?)?)
}

#[command]
pub fn get_plugin_device_secret(plugin_id: String, key: String) -> Result<Option<Value>, AppError> {
    let _guard = DEVICE_STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::Internal("Plugin device storage lock is unavailable".to_string()))?;
    get_secret_at(
        &get_plugin_secret_index_path(&plugin_id),
        &OsCredentialStore,
        &plugin_id,
        &key,
    )?
    .map(serde_json::to_value)
    .transpose()
    .map_err(AppError::from)
}

#[command]
pub fn set_plugin_device_secret(plugin_id: String, input: Value) -> Result<Value, AppError> {
    let _guard = DEVICE_STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::Internal("Plugin device storage lock is unavailable".to_string()))?;
    Ok(serde_json::to_value(set_secret_at(
        &get_plugin_secret_index_path(&plugin_id),
        &OsCredentialStore,
        &plugin_id,
        input,
        &now(),
    )?)?)
}

#[command]
pub fn delete_plugin_device_secret(plugin_id: String, input: Value) -> Result<Value, AppError> {
    let _guard = DEVICE_STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::Internal("Plugin device storage lock is unavailable".to_string()))?;
    Ok(serde_json::to_value(delete_secret_at(
        &get_plugin_secret_index_path(&plugin_id),
        &OsCredentialStore,
        &plugin_id,
        input,
    )?)?)
}

#[command]
pub fn list_plugin_device_storage() -> Result<Value, AppError> {
    let _guard = DEVICE_STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::Internal("Plugin device storage lock is unavailable".to_string()))?;
    Ok(serde_json::to_value(list_device_storage_at(
        &get_plugin_device_settings_dir(),
        &get_plugin_secret_index_dir(),
    )?)?)
}

#[command]
pub fn clear_plugin_device_storage(plugin_id: String) -> Result<Value, AppError> {
    let _guard = DEVICE_STORAGE_LOCK
        .lock()
        .map_err(|_| AppError::Internal("Plugin device storage lock is unavailable".to_string()))?;
    Ok(serde_json::to_value(clear_device_storage_at(
        &get_plugin_device_settings_path(&plugin_id),
        &get_plugin_secret_index_path(&plugin_id),
        &OsCredentialStore,
        &plugin_id,
    )?)?)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[derive(Default)]
    struct MemoryCredentialStore {
        values: Mutex<HashMap<(String, String), String>>,
    }

    impl CredentialStore for MemoryCredentialStore {
        fn get(&self, plugin_id: &str, key: &str) -> Result<Option<String>, AppError> {
            Ok(self
                .values
                .lock()
                .unwrap()
                .get(&(plugin_id.to_string(), key.to_string()))
                .cloned())
        }

        fn set(&self, plugin_id: &str, key: &str, value: &str) -> Result<(), AppError> {
            self.values
                .lock()
                .unwrap()
                .insert((plugin_id.to_string(), key.to_string()), value.to_string());
            Ok(())
        }

        fn delete(&self, plugin_id: &str, key: &str) -> Result<(), AppError> {
            self.values
                .lock()
                .unwrap()
                .remove(&(plugin_id.to_string(), key.to_string()));
            Ok(())
        }
    }

    struct FailingDeleteCredentialStore {
        values: Mutex<HashMap<(String, String), String>>,
        fail_key: String,
    }

    impl CredentialStore for FailingDeleteCredentialStore {
        fn get(&self, plugin_id: &str, key: &str) -> Result<Option<String>, AppError> {
            Ok(self
                .values
                .lock()
                .unwrap()
                .get(&(plugin_id.to_string(), key.to_string()))
                .cloned())
        }

        fn set(&self, plugin_id: &str, key: &str, value: &str) -> Result<(), AppError> {
            self.values
                .lock()
                .unwrap()
                .insert((plugin_id.to_string(), key.to_string()), value.to_string());
            Ok(())
        }

        fn delete(&self, plugin_id: &str, key: &str) -> Result<(), AppError> {
            if key == self.fail_key {
                return Err(AppError::PluginSecretStoreUnavailable);
            }
            self.values
                .lock()
                .unwrap()
                .remove(&(plugin_id.to_string(), key.to_string()));
            Ok(())
        }
    }

    #[test]
    fn settings_are_namespaced_revisioned_and_atomic() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join("org.axiom.declarative-conformance.json");
        let result = transact_settings_at(
            &path,
            "org.axiom.declarative-conformance",
            serde_json::json!({
                "schema": SETTINGS_TRANSACTION_SCHEMA,
                "schemaVersion": 1,
                "scope": SETTINGS_SCOPE,
                "expectedNamespaceRevision": 0,
                "operations": [{
                    "operationId": "put-layout",
                    "kind": "put",
                    "key": "ui/layout",
                    "expectedDocumentVersion": null,
                    "value": { "density": "compact" }
                }]
            }),
            "2026-08-27T10:00:00.000Z",
        )
        .unwrap();

        assert_eq!(result.namespace_revision, 1);
        let state = read_settings_at(&path, "org.axiom.declarative-conformance").unwrap();
        assert_eq!(state.documents["ui/layout"].document_version, 1);
        assert_eq!(state.documents["ui/layout"].value["density"], "compact");

        let before = fs::read_to_string(&path).unwrap();
        assert!(transact_settings_at(
            &path,
            "org.axiom.declarative-conformance",
            serde_json::json!({
                "schema": SETTINGS_TRANSACTION_SCHEMA,
                "schemaVersion": 1,
                "scope": SETTINGS_SCOPE,
                "expectedNamespaceRevision": 0,
                "operations": [{
                    "operationId": "stale",
                    "kind": "delete",
                    "key": "ui/layout",
                    "expectedDocumentVersion": 1
                }]
            }),
            "2026-08-27T10:01:00.000Z",
        )
        .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
    }

    #[test]
    fn secrets_keep_values_out_of_the_metadata_file() {
        let directory = tempfile::tempdir().unwrap();
        let index_path = directory
            .path()
            .join("org.axiom.declarative-conformance.json");
        let store = MemoryCredentialStore::default();
        let result = set_secret_at(
            &index_path,
            &store,
            "org.axiom.declarative-conformance",
            serde_json::json!({
                "schema": SECRET_SET_SCHEMA,
                "schemaVersion": 1,
                "scope": SECRETS_SCOPE,
                "key": "providers/example/token",
                "expectedSecretVersion": null,
                "value": "super-secret-token"
            }),
            "2026-08-27T10:00:00.000Z",
        )
        .unwrap();

        assert_eq!(result.secret_version, Some(1));
        let metadata = fs::read_to_string(&index_path).unwrap();
        assert!(metadata.contains("providers/example/token"));
        assert!(!metadata.contains("super-secret-token"));
        let snapshot = get_secret_at(
            &index_path,
            &store,
            "org.axiom.declarative-conformance",
            "providers/example/token",
        )
        .unwrap()
        .unwrap();
        assert_eq!(snapshot.value, "super-secret-token");

        delete_secret_at(
            &index_path,
            &store,
            "org.axiom.declarative-conformance",
            serde_json::json!({
                "schema": SECRET_DELETE_SCHEMA,
                "schemaVersion": 1,
                "scope": SECRETS_SCOPE,
                "key": "providers/example/token",
                "expectedSecretVersion": 1
            }),
        )
        .unwrap();
        assert!(get_secret_at(
            &index_path,
            &store,
            "org.axiom.declarative-conformance",
            "providers/example/token",
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn rejects_keys_that_could_escape_or_pollute_namespaces() {
        for key in ["../escape", "a//b", "__proto__", "/absolute", "trailing/"] {
            assert!(!is_valid_key(key), "accepted {key}");
        }
        assert!(is_valid_key("providers/example-token.v1"));
    }

    #[test]
    fn secret_mutations_require_their_exact_request_schema() {
        let directory = tempfile::tempdir().unwrap();
        let index_path = directory
            .path()
            .join("org.axiom.declarative-conformance.json");
        let store = MemoryCredentialStore::default();

        assert!(set_secret_at(
            &index_path,
            &store,
            "org.axiom.declarative-conformance",
            serde_json::json!({
                "schema": SECRET_DELETE_SCHEMA,
                "schemaVersion": 1,
                "scope": SECRETS_SCOPE,
                "key": "providers/example/token",
                "expectedSecretVersion": null,
                "value": "secret"
            }),
            "2026-08-27T10:00:00.000Z",
        )
        .is_err());
    }

    #[test]
    fn inventories_and_clears_retained_device_data_without_secret_values() {
        let directory = tempfile::tempdir().unwrap();
        let settings_directory = directory.path().join("settings");
        let secret_directory = directory.path().join("secrets");
        let settings_path = settings_directory.join("org.axiom.declarative-conformance.json");
        let secret_path = secret_directory.join("org.axiom.declarative-conformance.json");
        let store = MemoryCredentialStore::default();

        transact_settings_at(
            &settings_path,
            "org.axiom.declarative-conformance",
            serde_json::json!({
                "schema": SETTINGS_TRANSACTION_SCHEMA,
                "schemaVersion": 1,
                "scope": SETTINGS_SCOPE,
                "expectedNamespaceRevision": 0,
                "operations": [{
                    "operationId": "put-layout",
                    "kind": "put",
                    "key": "ui/layout",
                    "expectedDocumentVersion": null,
                    "value": { "density": "compact" }
                }]
            }),
            "2026-08-27T10:00:00.000Z",
        )
        .unwrap();
        set_secret_at(
            &secret_path,
            &store,
            "org.axiom.declarative-conformance",
            serde_json::json!({
                "schema": SECRET_SET_SCHEMA,
                "schemaVersion": 1,
                "scope": SECRETS_SCOPE,
                "key": "providers/example/token",
                "expectedSecretVersion": null,
                "value": "never-list-this-value"
            }),
            "2026-08-27T10:00:00.000Z",
        )
        .unwrap();

        let inventory = list_device_storage_at(&settings_directory, &secret_directory).unwrap();
        assert_eq!(inventory.len(), 1);
        assert_eq!(inventory[0].plugin_id, "org.axiom.declarative-conformance");
        assert_eq!(inventory[0].settings_document_count, 1);
        assert_eq!(inventory[0].secret_count, 1);
        let inventory_json = serde_json::to_string(&inventory).unwrap();
        assert!(!inventory_json.contains("providers/example/token"));
        assert!(!inventory_json.contains("never-list-this-value"));

        let result = clear_device_storage_at(
            &settings_path,
            &secret_path,
            &store,
            "org.axiom.declarative-conformance",
        )
        .unwrap();
        assert_eq!(result.settings_documents_cleared, 1);
        assert_eq!(result.secrets_cleared, 1);
        assert!(!settings_path.exists());
        assert!(!secret_path.exists());
        assert!(store
            .get(
                "org.axiom.declarative-conformance",
                "providers/example/token"
            )
            .unwrap()
            .is_none());
        assert!(
            list_device_storage_at(&settings_directory, &secret_directory)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn failed_clear_restores_earlier_credential_deletions_and_keeps_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let settings_path = directory.path().join("settings.json");
        let secret_path = directory.path().join("secrets.json");
        let store = FailingDeleteCredentialStore {
            values: Mutex::new(HashMap::new()),
            fail_key: "providers/b-token".to_string(),
        };

        for (key, value) in [
            ("providers/a-token", "secret-a"),
            ("providers/b-token", "secret-b"),
        ] {
            set_secret_at(
                &secret_path,
                &store,
                "org.axiom.declarative-conformance",
                serde_json::json!({
                    "schema": SECRET_SET_SCHEMA,
                    "schemaVersion": 1,
                    "scope": SECRETS_SCOPE,
                    "key": key,
                    "expectedSecretVersion": null,
                    "value": value
                }),
                "2026-08-27T10:00:00.000Z",
            )
            .unwrap();
        }

        assert!(clear_device_storage_at(
            &settings_path,
            &secret_path,
            &store,
            "org.axiom.declarative-conformance",
        )
        .is_err());
        assert!(secret_path.exists());
        assert_eq!(
            store
                .get("org.axiom.declarative-conformance", "providers/a-token")
                .unwrap()
                .as_deref(),
            Some("secret-a")
        );
        assert_eq!(
            store
                .get("org.axiom.declarative-conformance", "providers/b-token")
                .unwrap()
                .as_deref(),
            Some("secret-b")
        );
    }
}
