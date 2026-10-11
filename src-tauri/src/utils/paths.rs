#[cfg(not(feature = "portable"))]
use directories::ProjectDirs;
use std::path::PathBuf;

/// Get the base config directory for Nemoto.
/// Uses `nemoto/nemoto` which results in:
/// Windows: %APPDATA%\nemoto\nemoto\config
/// macOS: ~/Library/Application Support/nemoto.nemoto
/// Linux: ~/.config/nemoto
pub fn get_config_dir() -> PathBuf {
    #[cfg(feature = "portable")]
    {
        // In portable mode, store data in a 'data' directory next to the executable
        std::env::current_exe()
            .map(|p| p.parent().unwrap_or(&PathBuf::from(".")).join("data"))
            .unwrap_or_else(|_| PathBuf::from("data"))
    }

    #[cfg(not(feature = "portable"))]
    {
        if let Some(proj_dirs) = ProjectDirs::from("", "nemoto", "nemoto") {
            proj_dirs.config_dir().to_path_buf()
        } else {
            // Fallback
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        }
    }
}
pub fn get_config_path() -> PathBuf {
    get_config_dir().join("config.json")
}

pub fn get_portfolio_path() -> PathBuf {
    get_config_dir().join("portfolio.json")
}

pub fn get_temp_portfolios_dir() -> PathBuf {
    get_config_dir().join("temp_portfolios")
}

pub fn get_plugins_dir() -> PathBuf {
    get_config_dir().join("plugins")
}

pub fn get_themes_dir() -> PathBuf {
    get_config_dir().join("themes")
}

pub fn get_theme_path(theme_id: &str) -> PathBuf {
    get_themes_dir().join(format!("{theme_id}.axiom-theme.json"))
}

pub fn get_plugin_path(plugin_id: &str) -> PathBuf {
    get_plugins_dir().join(format!("{plugin_id}.json"))
}

pub fn get_plugin_runtime_storage_dir() -> PathBuf {
    get_config_dir().join("plugin-runtime")
}

pub fn get_plugin_runtime_storage_path(plugin_id: &str) -> PathBuf {
    get_plugin_runtime_storage_dir().join(plugin_id)
}

pub fn get_plugin_install_transactions_dir() -> PathBuf {
    get_config_dir().join("plugin-install-transactions")
}

pub fn get_plugin_device_settings_dir() -> PathBuf {
    get_config_dir().join("plugin-device-settings")
}

pub fn get_plugin_device_settings_path(plugin_id: &str) -> PathBuf {
    get_plugin_device_settings_dir().join(format!("{plugin_id}.json"))
}

pub fn get_plugin_secret_index_dir() -> PathBuf {
    get_config_dir().join("plugin-secret-indexes")
}

pub fn get_plugin_secret_index_path(plugin_id: &str) -> PathBuf {
    get_plugin_secret_index_dir().join(format!("{plugin_id}.json"))
}

pub fn get_temp_portfolio_path(name: &str) -> PathBuf {
    get_temp_portfolios_dir().join(format!("{}.json", name))
}

pub fn validate_path(path: &str, allowed_extensions: &[&str]) -> Result<(), String> {
    let p = std::path::Path::new(path);

    // 1. Basic Traversal Check (Reject ".." and null bytes)
    // While OS dialogs are usually safe, we must defend against a compromised frontend
    let path_str = p.to_string_lossy();
    if path_str.contains("..") || path_str.contains('\0') {
        return Err("Invalid path: contains illegal characters or traversal attempts".into());
    }

    // 2. Extension Check
    // Ensure we only touch files we are supposed to
    if !allowed_extensions.is_empty() {
        if let Some(ext) = p.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if !allowed_extensions.contains(&ext_str.as_str()) {
                return Err(format!(
                    "Invalid file extension. Expected one of: {:?}",
                    allowed_extensions
                ));
            }
        } else {
            return Err(format!(
                "File has no extension. Expected one of: {:?}",
                allowed_extensions
            ));
        }
    }

    Ok(())
}
