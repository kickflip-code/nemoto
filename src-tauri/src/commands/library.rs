use crate::error::AppError;
use crate::models::project::Asset;
use crate::utils::paths;
use std::fs;
use tauri::command;

#[command]
pub fn save_library(assets: Vec<Asset>) -> Result<(), AppError> {
    let dir = paths::get_config_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }

    let path = dir.join("library.json");
    let content = serde_json::to_string_pretty(&assets)?;

    fs::write(path, content)?;
    Ok(())
}

#[command]
pub fn load_library() -> Result<Vec<Asset>, AppError> {
    let path = paths::get_config_dir().join("library.json");
    if path.exists() {
        let content = fs::read_to_string(path)?;
        let assets: Vec<Asset> = serde_json::from_str(&content)?;
        Ok(assets)
    } else {
        // Return empty list if no library exists yet
        Ok(vec![])
    }
}
