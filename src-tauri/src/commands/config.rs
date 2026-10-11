use crate::error::AppError;
use crate::models::app_config::AppConfig;
use crate::utils::atomic_file::atomic_write_json;
use crate::utils::paths;
use std::fs;
use std::path::Path;
use tauri::command;

use super::themes::is_installed_theme_in;

pub(crate) fn read_config_from(path: &Path) -> AppConfig {
    if path.exists() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    AppConfig::default()
}

pub(crate) fn write_config_to(path: &Path, config: &AppConfig) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(config)?;
    atomic_write_json(path, &content, true)?;
    Ok(())
}

fn set_active_theme_in(
    config_path: &Path,
    themes_directory: &Path,
    theme: &str,
) -> Result<(), AppError> {
    let allowed_themes = ["void", "soft", "hard"];
    let is_installed_custom_theme = is_installed_theme_in(themes_directory, theme);
    if !allowed_themes.contains(&theme) && !is_installed_custom_theme {
        return Err(AppError::Validation(format!(
            "Invalid or uninstalled theme: {theme}"
        )));
    }

    let mut config = read_config_from(config_path);
    config.active_theme = theme.to_string();
    write_config_to(config_path, &config)
}

#[command]
pub fn get_config() -> AppConfig {
    read_config_from(&paths::get_config_path())
}

#[command]
pub fn set_config(config: AppConfig) -> Result<(), AppError> {
    write_config_to(&paths::get_config_path(), &config)
}

#[command]
pub fn get_active_theme() -> String {
    let config = get_config();
    config.active_theme
}

#[command]
pub fn set_active_theme(theme: String) -> Result<(), AppError> {
    set_active_theme_in(&paths::get_config_path(), &paths::get_themes_dir(), &theme)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn built_in_selection_survives_a_fresh_config_read() {
        let directory = tempfile::tempdir().unwrap();
        let config_path = directory.path().join("config.json");
        let themes_directory = directory.path().join("themes");

        assert_eq!(read_config_from(&config_path).active_theme, "soft");
        set_active_theme_in(&config_path, &themes_directory, "hard").unwrap();

        assert_eq!(read_config_from(&config_path).active_theme, "hard");
    }

    #[test]
    fn custom_selection_requires_a_valid_installed_copy_and_preserves_config() {
        let directory = tempfile::tempdir().unwrap();
        let config_path = directory.path().join("config.json");
        let themes_directory = directory.path().join("themes");
        let mut config = AppConfig::default();
        config.extra.insert(
            "futureSetting".to_string(),
            serde_json::json!({ "preserved": true }),
        );
        write_config_to(&config_path, &config).unwrap();

        assert!(
            set_active_theme_in(&config_path, &themes_directory, "org.example.missing").is_err()
        );
        assert_eq!(read_config_from(&config_path).active_theme, "soft");

        fs::create_dir_all(&themes_directory).unwrap();
        fs::write(
            themes_directory.join("org.example.installed.axiom-theme.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "schema": "axiom.theme",
                "version": 2,
                "id": "org.example.installed",
                "themeVersion": "1.0.0",
                "label": "Installed",
                "tokens": { "--color-app-bg": "#000000" }
            }))
            .unwrap(),
        )
        .unwrap();

        set_active_theme_in(&config_path, &themes_directory, "org.example.installed").unwrap();
        let reloaded = read_config_from(&config_path);
        assert_eq!(reloaded.active_theme, "org.example.installed");
        assert_eq!(
            reloaded.extra["futureSetting"],
            serde_json::json!({ "preserved": true })
        );
    }
}
