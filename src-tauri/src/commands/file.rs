use crate::error::AppError;
use crate::models::project::AxiomProject;
use crate::utils::atomic_file::atomic_write_json;
use crate::utils::paths::validate_path;
use std::fs;
use std::path::Path;
use tauri::command;

#[command]
pub fn save_project(path: String, project: AxiomProject) -> Result<(), AppError> {
    validate_path(&path, &["nemoto", "nemoto-process", "ax", "axiom"])
        .map_err(AppError::Validation)?;

    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(&project)?;
    atomic_write_json(Path::new(&path), &content, true)?;
    Ok(())
}

#[command]
pub fn write_axiom_file_atomic(
    path: String,
    content: String,
    create_backup: bool,
) -> Result<(), AppError> {
    validate_path(&path, &["nemoto", "nemoto-process", "ax", "axiom"])
        .map_err(AppError::Validation)?;
    atomic_write_json(Path::new(&path), &content, create_backup)?;
    Ok(())
}

#[command]
pub fn load_project(path: String) -> Result<AxiomProject, AppError> {
    validate_path(&path, &["nemoto", "nemoto-process", "ax", "axiom"])
        .map_err(AppError::Validation)?;

    let content = fs::read_to_string(&path)?;
    let project: AxiomProject = serde_json::from_str(&content)?;
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renamed_and_legacy_exports_keep_atomic_recovery_and_content() {
        let directory = tempfile::tempdir().unwrap();
        for extension in ["nemoto", "nemoto-process", "axiom", "ax"] {
            let path = directory.path().join(format!("Återläsning.{extension}"));
            let path_string = path.to_string_lossy().into_owned();
            let original = r#"{"format":"axiom","data":{"label":"Axiom / Nemoto / Åäö"}}"#;
            let changed =
                r#"{"format":"axiom","data":{"label":"Axiom / Nemoto / Åäö","changed":true}}"#;
            write_axiom_file_atomic(path_string.clone(), original.into(), false).unwrap();
            write_axiom_file_atomic(path_string, changed.into(), true).unwrap();
            assert_eq!(fs::read_to_string(&path).unwrap(), changed);
            assert_eq!(
                fs::read_to_string(path.with_extension(format!("{extension}.bak"))).unwrap(),
                original
            );
        }
        let forbidden = directory.path().join("unrelated.txt");
        assert!(write_axiom_file_atomic(
            forbidden.to_string_lossy().into_owned(),
            "{}".into(),
            false
        )
        .is_err());
        assert!(!forbidden.exists());
    }
}
