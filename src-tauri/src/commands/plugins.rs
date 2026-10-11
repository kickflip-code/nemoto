use std::fs;
use std::path::Path;

use serde_json::Value;
use tauri::{command, State};

use crate::error::AppError;
use crate::plugin_executable_package::ExecutablePackageAdapter;
use crate::plugin_wasm_admission::NativeWasmAdmission;
#[cfg(test)]
use crate::plugin_wasm_storage::remove_wasm_plugin_storage;
use crate::utils::atomic_file::atomic_write_json;
#[cfg(test)]
use crate::utils::atomic_file::backup_path;
use crate::utils::paths::{get_plugin_path, get_plugins_dir};

const MAX_INSTALLED_PLUGIN_BYTES: usize = 25 * 1024 * 1024;

pub(crate) fn is_valid_plugin_id(plugin_id: &str) -> bool {
    if plugin_id.len() < 3 || plugin_id.len() > 160 || !plugin_id.contains('.') {
        return false;
    }
    plugin_id.split('.').all(|segment| {
        !segment.is_empty()
            && segment.chars().all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
            })
            && segment.chars().next().is_some_and(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit()
            })
            && segment.chars().last().is_some_and(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit()
            })
    })
}

fn plugin_id_from_document(document: &Value) -> Result<&str, AppError> {
    if document.get("schema").and_then(Value::as_str) != Some("axiom.installed-plugin")
        || document.get("schemaVersion").and_then(Value::as_u64) != Some(1)
    {
        return Err(AppError::Validation(
            "Invalid installed plugin document header".to_string(),
        ));
    }

    let plugin_id = document
        .get("manifest")
        .and_then(|manifest| manifest.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::Validation("Installed plugin document has no plugin ID".to_string())
        })?;
    if !is_valid_plugin_id(plugin_id) {
        return Err(AppError::Validation(
            "Plugin ID must be a lowercase reverse-domain identifier".to_string(),
        ));
    }
    Ok(plugin_id)
}

fn document_requests_executable_runtime(document: &Value) -> bool {
    document
        .get("manifest")
        .and_then(|manifest| manifest.get("runtime"))
        .is_some()
        || document
            .get("manifest")
            .and_then(|manifest| manifest.get("capabilities"))
            .and_then(Value::as_array)
            .is_some_and(|capabilities| {
                capabilities
                    .iter()
                    .any(|capability| capability.as_str() == Some("compute.isolated"))
            })
}

fn list_installed_plugins_from(directory: &Path) -> Result<Vec<Value>, AppError> {
    if !directory.exists() {
        return Ok(Vec::new());
    }

    let mut paths = fs::read_dir(directory)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect::<Vec<_>>();
    paths.sort();

    paths
        .into_iter()
        .map(|path| {
            let metadata = fs::metadata(&path)?;
            if metadata.len() > MAX_INSTALLED_PLUGIN_BYTES as u64 {
                return Err(AppError::Validation(format!(
                    "Installed plugin file {} exceeds the size limit",
                    path.display()
                )));
            }
            let content = fs::read_to_string(&path)?;
            let document: Value = serde_json::from_str(&content)?;
            let plugin_id = plugin_id_from_document(&document)?;
            if path.file_stem().and_then(|name| name.to_str()) != Some(plugin_id) {
                return Err(AppError::Validation(format!(
                    "Installed plugin file {} does not match its manifest ID",
                    path.display()
                )));
            }
            Ok(document)
        })
        .collect()
}

#[command]
pub fn list_installed_plugins() -> Result<Vec<Value>, AppError> {
    list_installed_plugins_from(&get_plugins_dir())
}

fn install_plugin_at(path: &Path, document: &Value) -> Result<(), AppError> {
    let plugin_id = plugin_id_from_document(document)?;
    if path.file_stem().and_then(|name| name.to_str()) != Some(plugin_id) {
        return Err(AppError::Validation(
            "Installed plugin path does not match its manifest ID".to_string(),
        ));
    }
    let content = serde_json::to_string_pretty(document)?;
    if content.len() > MAX_INSTALLED_PLUGIN_BYTES {
        return Err(AppError::Validation(
            "Installed plugin document exceeds the 25 MB limit".to_string(),
        ));
    }

    atomic_write_json(path, &content, true)?;
    Ok(())
}

#[command]
pub fn install_plugin(document: Value) -> Result<(), AppError> {
    let plugin_id = plugin_id_from_document(&document)?;
    if document_requests_executable_runtime(&document) {
        return Err(AppError::Validation(
            "Executable plugin metadata can only be installed through native package admission"
                .to_string(),
        ));
    }
    let path = get_plugin_path(plugin_id);
    if path.exists() {
        let existing: Value = serde_json::from_str(&fs::read_to_string(&path)?)?;
        if document_requests_executable_runtime(&existing) {
            return Err(AppError::Validation(
                "Executable plugin metadata can only be updated through native package admission"
                    .to_string(),
            ));
        }
    }
    install_plugin_at(&path, &document)
}

#[cfg(test)]
fn uninstall_plugin_at(
    path: &Path,
    runtime_storage_root: &Path,
    plugin_id: &str,
) -> Result<(), AppError> {
    remove_wasm_plugin_storage(runtime_storage_root, plugin_id).map_err(|_| {
        AppError::Validation("Executable plugin storage could not be removed safely".to_string())
    })?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    let backup = backup_path(path);
    if backup.exists() {
        fs::remove_file(backup)?;
    }
    Ok(())
}

#[command]
pub fn uninstall_plugin(
    plugin_id: String,
    adapter: State<'_, ExecutablePackageAdapter<NativeWasmAdmission>>,
) -> Result<(), AppError> {
    if !is_valid_plugin_id(&plugin_id) {
        return Err(AppError::Validation(
            "Plugin ID must be a lowercase reverse-domain identifier".to_string(),
        ));
    }

    adapter.uninstall(&plugin_id).map_err(|_| {
        AppError::Validation("The plugin could not be revoked and uninstalled safely".to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_portable_reverse_domain_plugin_ids() {
        assert!(is_valid_plugin_id("org.axiom.declarative-conformance"));
        assert!(is_valid_plugin_id("se.example2.tasks"));
    }

    #[test]
    fn rejects_ids_that_could_escape_the_plugin_directory() {
        for plugin_id in [
            "../escape",
            "org/escape",
            "Org.example",
            "org..example",
            "org.-bad",
        ] {
            assert!(!is_valid_plugin_id(plugin_id), "accepted {plugin_id}");
        }
    }

    #[test]
    fn document_id_is_taken_only_from_a_valid_document_header() {
        let document = serde_json::json!({
            "schema": "axiom.installed-plugin",
            "schemaVersion": 1,
            "manifest": { "id": "org.axiom.declarative-conformance" }
        });
        assert_eq!(
            plugin_id_from_document(&document).unwrap(),
            "org.axiom.declarative-conformance"
        );
    }

    #[test]
    fn executable_metadata_cannot_use_the_declarative_install_path() {
        let runtime = serde_json::json!({
            "schema": "axiom.installed-plugin",
            "schemaVersion": 1,
            "manifest": {
                "id": "org.axiom.compute",
                "runtime": { "module": "runtime/plugin.wasm" }
            }
        });
        let capability_only = serde_json::json!({
            "schema": "axiom.installed-plugin",
            "schemaVersion": 1,
            "manifest": {
                "id": "org.axiom.compute",
                "capabilities": ["compute.isolated"]
            }
        });

        assert!(document_requests_executable_runtime(&runtime));
        assert!(document_requests_executable_runtime(&capability_only));
    }

    #[test]
    fn installs_lists_updates_and_uninstalls_only_the_selected_document() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join("org.axiom.declarative-conformance.json");
        let runtime_storage = directory.path().join("plugin-runtime");
        let mut document = serde_json::json!({
            "schema": "axiom.installed-plugin",
            "schemaVersion": 1,
            "manifest": { "id": "org.axiom.declarative-conformance", "version": "1.0.0" }
        });

        install_plugin_at(&path, &document).unwrap();
        assert_eq!(
            list_installed_plugins_from(directory.path()).unwrap(),
            vec![document.clone()]
        );

        document["manifest"]["version"] = serde_json::json!("1.0.1");
        install_plugin_at(&path, &document).unwrap();
        assert_eq!(
            list_installed_plugins_from(directory.path()).unwrap(),
            vec![document]
        );
        assert!(backup_path(&path).exists());

        fs::create_dir_all(runtime_storage.join("org.axiom.declarative-conformance")).unwrap();
        fs::write(
            runtime_storage
                .join("org.axiom.declarative-conformance")
                .join("sentinel"),
            b"runtime",
        )
        .unwrap();
        uninstall_plugin_at(&path, &runtime_storage, "org.axiom.declarative-conformance").unwrap();
        assert!(!path.exists());
        assert!(!backup_path(&path).exists());
        assert!(!runtime_storage
            .join("org.axiom.declarative-conformance")
            .exists());
    }
}
