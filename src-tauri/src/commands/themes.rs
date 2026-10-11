use std::fs;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::command;

use crate::commands::config::{get_config, read_config_from, set_config, write_config_to};
use crate::error::AppError;
use crate::utils::atomic_file::{atomic_write_json, atomic_write_verified, backup_path};
use crate::utils::paths::{get_config_path, get_themes_dir};

const THEME_FILE_SUFFIX: &str = ".axiom-theme.json";
const MAX_THEME_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_THEME_ASSET_BYTES: usize = 2 * 1024 * 1024;
const MAX_THEME_ASSETS_BYTES: usize = 5 * 1024 * 1024;
const RESERVED_THEME_IDS: [&str; 5] = ["void", "soft", "hard", "polar", "brutalist"];

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeLibraryError {
    file_name: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeLibraryDocument {
    file_name: String,
    document: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeLibrarySnapshot {
    documents: Vec<ThemeLibraryDocument>,
    errors: Vec<ThemeLibraryError>,
}

pub(crate) fn is_valid_theme_id(theme_id: &str) -> bool {
    let length = theme_id.len();
    if !(3..=128).contains(&length)
        || theme_id.contains("..")
        || RESERVED_THEME_IDS.contains(&theme_id)
    {
        return false;
    }
    let mut characters = theme_id.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    let Some(last) = theme_id.chars().last() else {
        return false;
    };
    let is_edge = |character: char| character.is_ascii_lowercase() || character.is_ascii_digit();
    is_edge(first)
        && is_edge(last)
        && theme_id.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '.' | '_' | '-')
        })
}

fn theme_id_from_document(document: &Value) -> Result<&str, AppError> {
    if document.get("schema").and_then(Value::as_str) != Some("axiom.theme")
        || document.get("version").and_then(Value::as_u64) != Some(2)
    {
        return Err(AppError::Validation(
            "Invalid theme document header; only axiom.theme version 2 can be installed"
                .to_string(),
        ));
    }
    let theme_id = document
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Validation("Theme document has no stable ID".to_string()))?;
    if !is_valid_theme_id(theme_id) {
        return Err(AppError::Validation(
            "Theme ID is invalid or reserved by a built-in theme".to_string(),
        ));
    }
    if document
        .get("themeVersion")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
        || document
            .get("label")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        || !document.get("tokens").is_some_and(Value::is_object)
    {
        return Err(AppError::Validation(
            "Theme document is missing themeVersion, label, or tokens".to_string(),
        ));
    }
    Ok(theme_id)
}

fn validate_embedded_assets(document: &Value) -> Result<(), AppError> {
    let Some(assets) = document.get("assets") else {
        return Ok(());
    };
    let assets = assets
        .as_object()
        .ok_or_else(|| AppError::Validation("Theme assets must be an object".to_string()))?;
    let mut total_bytes = 0usize;

    for (asset_id, asset) in assets {
        let asset = asset.as_object().ok_or_else(|| {
            AppError::Validation(format!("Theme asset {asset_id} must be an object"))
        })?;
        let media_type = asset
            .get("mediaType")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AppError::Validation(format!("Theme asset {asset_id} has no media type"))
            })?;
        if !matches!(media_type, "image/png" | "image/webp" | "font/woff2") {
            return Err(AppError::Validation(format!(
                "Theme asset {asset_id} uses an unsupported media type"
            )));
        }
        let data = asset.get("data").and_then(Value::as_str).ok_or_else(|| {
            AppError::Validation(format!("Theme asset {asset_id} has no base64 data"))
        })?;
        let decoded = BASE64_STANDARD.decode(data).map_err(|_| {
            AppError::Validation(format!(
                "Theme asset {asset_id} contains invalid base64 data"
            ))
        })?;
        if decoded.len() > MAX_THEME_ASSET_BYTES {
            return Err(AppError::Validation(format!(
                "Theme asset {asset_id} exceeds the 2 MiB limit"
            )));
        }
        total_bytes = total_bytes.saturating_add(decoded.len());
        if total_bytes > MAX_THEME_ASSETS_BYTES {
            return Err(AppError::Validation(
                "Theme assets exceed the 5 MiB combined limit".to_string(),
            ));
        }

        let signature_matches = match media_type {
            "image/png" => decoded.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
            "image/webp" => {
                decoded.len() >= 12 && &decoded[0..4] == b"RIFF" && &decoded[8..12] == b"WEBP"
            }
            "font/woff2" => decoded.starts_with(b"wOF2"),
            _ => false,
        };
        if !signature_matches {
            return Err(AppError::Validation(format!(
                "Theme asset {asset_id} content does not match {media_type}"
            )));
        }

        let declared_sha = asset.get("sha256").and_then(Value::as_str).ok_or_else(|| {
            AppError::Validation(format!("Theme asset {asset_id} has no SHA-256 digest"))
        })?;
        if declared_sha.len() != 64
            || !declared_sha
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            return Err(AppError::Validation(format!(
                "Theme asset {asset_id} has an invalid SHA-256 digest"
            )));
        }
        let actual_sha = format!("{:x}", Sha256::digest(&decoded));
        if !actual_sha.eq_ignore_ascii_case(declared_sha) {
            return Err(AppError::Validation(format!(
                "Theme asset {asset_id} failed SHA-256 integrity verification"
            )));
        }
    }
    Ok(())
}

fn validate_theme_document(document: &Value) -> Result<&str, AppError> {
    let theme_id = theme_id_from_document(document)?;
    validate_embedded_assets(document)?;
    Ok(theme_id)
}

pub(crate) fn is_installed_theme_in(directory: &Path, theme_id: &str) -> bool {
    if !is_valid_theme_id(theme_id) {
        return false;
    }
    let path = directory.join(file_name_for_theme_id(theme_id));
    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(document) = serde_json::from_str::<Value>(&content) else {
        return false;
    };
    validate_theme_document(&document).is_ok_and(|document_id| document_id == theme_id)
}

fn file_name_for_theme_id(theme_id: &str) -> String {
    format!("{theme_id}{THEME_FILE_SUFFIX}")
}

fn read_theme_library_from(directory: &Path) -> Result<ThemeLibrarySnapshot, AppError> {
    if !directory.exists() {
        return Ok(ThemeLibrarySnapshot {
            documents: Vec::new(),
            errors: Vec::new(),
        });
    }

    let mut paths = fs::read_dir(directory)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(THEME_FILE_SUFFIX))
        })
        .collect::<Vec<_>>();
    paths.sort();

    let mut documents = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "unknown theme file".to_string());
        let result = (|| -> Result<Value, AppError> {
            if fs::metadata(&path)?.len() > MAX_THEME_FILE_BYTES as u64 {
                return Err(AppError::Validation(
                    "Theme file exceeds the 8 MiB limit".to_string(),
                ));
            }
            let document: Value = serde_json::from_str(&fs::read_to_string(&path)?)?;
            let theme_id = validate_theme_document(&document)?;
            if file_name != file_name_for_theme_id(theme_id) {
                return Err(AppError::Validation(
                    "Theme filename does not match its stable ID".to_string(),
                ));
            }
            Ok(document)
        })();

        match result {
            Ok(document) => documents.push(ThemeLibraryDocument {
                file_name,
                document,
            }),
            Err(error) => errors.push(ThemeLibraryError {
                file_name,
                message: error.to_string(),
            }),
        }
    }
    Ok(ThemeLibrarySnapshot { documents, errors })
}

fn install_theme_in(directory: &Path, document: &Value, replace: bool) -> Result<(), AppError> {
    let theme_id = validate_theme_document(document)?;
    let content = serde_json::to_string_pretty(document)?;
    if content.len() > MAX_THEME_FILE_BYTES {
        return Err(AppError::Validation(
            "Theme document exceeds the 8 MiB limit".to_string(),
        ));
    }
    let path = directory.join(file_name_for_theme_id(theme_id));
    if path.exists() && !replace {
        return Err(AppError::Validation(format!(
            "A theme with ID {theme_id} is already installed"
        )));
    }
    atomic_write_json(&path, &content, true)?;
    Ok(())
}

fn rollback_theme_install(path: &Path, previous_content: Option<&[u8]>) -> Result<(), AppError> {
    if let Some(content) = previous_content {
        atomic_write_verified(path, content, false, |_| Ok(()))?;
    } else if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn install_and_activate_theme_in(
    directory: &Path,
    config_path: &Path,
    document: &Value,
    replace: bool,
) -> Result<(), AppError> {
    let theme_id = validate_theme_document(document)?.to_string();
    let path = directory.join(file_name_for_theme_id(&theme_id));
    let previous_content = if path.exists() {
        Some(fs::read(&path)?)
    } else {
        None
    };

    install_theme_in(directory, document, replace)?;

    let mut config = read_config_from(config_path);
    config.active_theme = theme_id.clone();
    if let Err(activation_error) = write_config_to(config_path, &config) {
        // A directory-sync error can be reported after the config replacement
        // already landed. Keep the installed theme in that case so config never
        // points at a missing file; otherwise restore the exact previous bytes.
        let activation_landed =
            config_path.exists() && read_config_from(config_path).active_theme == theme_id;
        if !activation_landed {
            if let Err(rollback_error) = rollback_theme_install(&path, previous_content.as_deref())
            {
                return Err(AppError::Internal(format!(
                    "Theme activation failed ({activation_error}); installation rollback also failed ({rollback_error})"
                )));
            }
        }
        return Err(activation_error);
    }

    Ok(())
}

fn delete_theme_in(directory: &Path, theme_id: &str) -> Result<(), AppError> {
    if !is_valid_theme_id(theme_id) {
        return Err(AppError::Validation("Invalid theme ID".to_string()));
    }
    let path = directory.join(file_name_for_theme_id(theme_id));
    if path.exists() {
        fs::remove_file(&path)?;
    }
    let backup = backup_path(&path);
    if backup.exists() {
        fs::remove_file(backup)?;
    }
    Ok(())
}

#[command]
pub fn list_installed_themes() -> Result<ThemeLibrarySnapshot, AppError> {
    read_theme_library_from(&get_themes_dir())
}

#[command]
pub fn install_theme(document: Value, replace: bool) -> Result<(), AppError> {
    install_theme_in(&get_themes_dir(), &document, replace)
}

#[command]
pub fn restore_theme_and_activate(document: Value, replace: bool) -> Result<(), AppError> {
    install_and_activate_theme_in(&get_themes_dir(), &get_config_path(), &document, replace)
}

#[command]
pub fn delete_installed_theme(theme_id: String) -> Result<(), AppError> {
    delete_theme_in(&get_themes_dir(), &theme_id)?;
    let mut config = get_config();
    if config.active_theme == theme_id {
        config.active_theme = "void".to_string();
        set_config(config)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn theme(theme_id: &str) -> Value {
        serde_json::json!({
            "schema": "axiom.theme",
            "version": 2,
            "id": theme_id,
            "themeVersion": "1.0.0",
            "label": "Test",
            "basePresetId": "void",
            "tokens": { "--color-app-bg": "#000000" },
            "extensions": { "org.example.audit": { "kept": true } }
        })
    }

    #[test]
    fn accepts_portable_ids_and_rejects_paths_and_builtins() {
        assert!(is_valid_theme_id("org.example.night-mode"));
        assert!(is_valid_theme_id("theme-123"));
        for theme_id in ["../escape", "org/escape", "Bad", "void", "org..bad"] {
            assert!(!is_valid_theme_id(theme_id), "accepted {theme_id}");
        }
    }

    #[test]
    fn installs_lists_updates_and_deletes_one_file_per_theme() {
        let directory = tempfile::tempdir().unwrap();
        let mut document = theme("org.example.night-mode");

        install_theme_in(directory.path(), &document, false).unwrap();
        assert!(install_theme_in(directory.path(), &document, false).is_err());
        assert_eq!(
            read_theme_library_from(directory.path()).unwrap().documents[0]
                .document
                .clone(),
            document.clone()
        );

        document["label"] = Value::String("Night Mode 2".to_string());
        install_theme_in(directory.path(), &document, true).unwrap();
        let path = directory
            .path()
            .join("org.example.night-mode.axiom-theme.json");
        assert!(backup_path(&path).exists());
        assert_eq!(
            read_theme_library_from(directory.path()).unwrap().documents[0]
                .document
                .clone(),
            document
        );

        delete_theme_in(directory.path(), "org.example.night-mode").unwrap();
        assert!(!path.exists());
        assert!(!backup_path(&path).exists());
    }

    #[test]
    fn isolates_broken_and_future_files_without_rewriting_them() {
        let directory = tempfile::tempdir().unwrap();
        let broken_path = directory.path().join("broken.axiom-theme.json");
        let future_path = directory.path().join("future.axiom-theme.json");
        fs::write(&broken_path, "not json").unwrap();
        fs::write(
            &future_path,
            serde_json::to_string(&serde_json::json!({
                "schema": "axiom.theme",
                "version": 99,
                "id": "future"
            }))
            .unwrap(),
        )
        .unwrap();

        let snapshot = read_theme_library_from(directory.path()).unwrap();
        assert!(snapshot.documents.is_empty());
        assert_eq!(snapshot.errors.len(), 2);
        assert_eq!(fs::read_to_string(broken_path).unwrap(), "not json");
    }

    #[test]
    fn verifies_embedded_asset_signature_and_digest_before_install() {
        let directory = tempfile::tempdir().unwrap();
        let bytes = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        let digest = format!("{:x}", Sha256::digest(bytes));
        let mut document = theme("org.example.assets");
        document["assets"] = serde_json::json!({
            "brand-logo": {
                "mediaType": "image/png",
                "data": BASE64_STANDARD.encode(bytes),
                "sha256": digest,
            }
        });

        install_theme_in(directory.path(), &document, false).unwrap();
        document["assets"]["brand-logo"]["sha256"] = Value::String("0".repeat(64));
        assert!(install_theme_in(directory.path(), &document, true).is_err());

        let installed = read_theme_library_from(directory.path()).unwrap();
        assert_eq!(installed.documents.len(), 1);
        assert!(installed.errors.is_empty());
    }

    #[test]
    fn restored_theme_survives_source_removal_and_restart_reload() {
        let root = tempfile::tempdir().unwrap();
        let themes_directory = root.path().join("themes");
        let config_path = root.path().join("config.json");
        let source_path = root.path().join("downloaded.axiom-theme.json");
        let mut config = crate::models::app_config::AppConfig::default();
        config.extra.insert(
            "futureSetting".to_string(),
            serde_json::json!({ "preserved": true }),
        );
        write_config_to(&config_path, &config).unwrap();

        let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        let font = *b"wOF2";
        let mut document = theme("org.example.recovered");
        document["brand"] = serde_json::json!({
            "displayName": "Recovered Brand",
            "logoAssetId": "brand-logo"
        });
        document["typography"] = serde_json::json!({
            "fontFamily": "Recovered Sans",
            "regularAssetId": "brand-font"
        });
        document["assets"] = serde_json::json!({
            "brand-logo": {
                "mediaType": "image/png",
                "data": BASE64_STANDARD.encode(png),
                "sha256": format!("{:x}", Sha256::digest(png)),
            },
            "brand-font": {
                "mediaType": "font/woff2",
                "data": BASE64_STANDARD.encode(font),
                "sha256": format!("{:x}", Sha256::digest(font)),
            }
        });
        document["extensions"] = serde_json::json!({
            "org.example.audit": { "retained": true }
        });
        document["futureCoreField"] = serde_json::json!({ "roundTrip": [1, 2, 3] });
        fs::write(&source_path, serde_json::to_vec_pretty(&document).unwrap()).unwrap();

        let downloaded: Value = serde_json::from_slice(&fs::read(&source_path).unwrap()).unwrap();
        install_and_activate_theme_in(&themes_directory, &config_path, &downloaded, false).unwrap();
        fs::remove_file(source_path).unwrap();

        // A fresh disk read models the next application process; no source path is consulted.
        let reloaded_library = read_theme_library_from(&themes_directory).unwrap();
        let reloaded_config = read_config_from(&config_path);
        assert_eq!(reloaded_library.documents.len(), 1);
        assert_eq!(reloaded_library.documents[0].document, document);
        assert_eq!(reloaded_config.active_theme, "org.example.recovered");
        assert_eq!(
            reloaded_config.extra["futureSetting"],
            serde_json::json!({ "preserved": true })
        );
        assert!(backup_path(&config_path).exists());
        let previous_config = read_config_from(&backup_path(&config_path));
        assert_eq!(previous_config.active_theme, "soft");
        assert_eq!(
            previous_config.extra["futureSetting"],
            serde_json::json!({ "preserved": true })
        );
    }

    #[test]
    fn conflict_requires_replace_and_replacement_keeps_recovery_copy() {
        let root = tempfile::tempdir().unwrap();
        let themes_directory = root.path().join("themes");
        let config_path = root.path().join("config.json");
        let original = theme("org.example.conflict");
        let unrelated = theme("org.example.unrelated");
        let mut incoming = original.clone();
        incoming["label"] = Value::String("Backup revision".to_string());

        install_theme_in(&themes_directory, &unrelated, false).unwrap();
        install_and_activate_theme_in(&themes_directory, &config_path, &original, false).unwrap();
        assert!(
            install_and_activate_theme_in(&themes_directory, &config_path, &incoming, false,)
                .is_err()
        );
        let before_replace = read_theme_library_from(&themes_directory).unwrap();
        assert_eq!(before_replace.documents.len(), 2);
        assert!(before_replace
            .documents
            .iter()
            .any(|entry| entry.document == original));
        assert!(before_replace
            .documents
            .iter()
            .any(|entry| entry.document == unrelated));

        install_and_activate_theme_in(&themes_directory, &config_path, &incoming, true).unwrap();
        let path = themes_directory.join("org.example.conflict.axiom-theme.json");
        let recovery_document: Value =
            serde_json::from_str(&fs::read_to_string(backup_path(&path)).unwrap()).unwrap();
        let after_replace = read_theme_library_from(&themes_directory).unwrap();
        assert_eq!(after_replace.documents.len(), 2);
        assert!(after_replace
            .documents
            .iter()
            .any(|entry| entry.document == incoming));
        assert!(after_replace
            .documents
            .iter()
            .any(|entry| entry.document == unrelated));
        assert_eq!(recovery_document, original);
        assert_eq!(
            read_config_from(&config_path).active_theme,
            "org.example.conflict"
        );
    }

    #[test]
    fn config_write_failure_rolls_back_new_and_replaced_theme_files() {
        let root = tempfile::tempdir().unwrap();
        let themes_directory = root.path().join("themes");
        let blocker = root.path().join("not-a-directory");
        fs::write(&blocker, "blocked").unwrap();
        let blocked_config_path = blocker.join("config.json");

        let new_theme = theme("org.example.new-rollback");
        assert!(install_and_activate_theme_in(
            &themes_directory,
            &blocked_config_path,
            &new_theme,
            false,
        )
        .is_err());
        assert!(!themes_directory
            .join("org.example.new-rollback.axiom-theme.json")
            .exists());

        let original = theme("org.example.replace-rollback");
        install_theme_in(&themes_directory, &original, false).unwrap();
        let mut replacement = original.clone();
        replacement["label"] = Value::String("Must roll back".to_string());
        assert!(install_and_activate_theme_in(
            &themes_directory,
            &blocked_config_path,
            &replacement,
            true,
        )
        .is_err());

        let installed = read_theme_library_from(&themes_directory).unwrap();
        assert_eq!(installed.documents.len(), 1);
        assert_eq!(installed.documents[0].document, original);
    }
}
