use crate::error::AppError;
use crate::models::portfolio::Portfolio;
use crate::utils::atomic_file::{atomic_write_json, backup_path};
use crate::utils::paths::{get_portfolio_path, get_temp_portfolio_path, get_temp_portfolios_dir};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use tauri::command;

// Serialize replacement with saves from other Axiom windows.
static PORTFOLIO_WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
pub struct PortfolioRepairSnapshot {
    revision: String,
    portfolio: Value,
}

fn portfolio_revision(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}

fn repair_snapshot_at(path: &Path) -> Result<PortfolioRepairSnapshot, AppError> {
    let content = fs::read(path)?;
    Ok(PortfolioRepairSnapshot {
        revision: portfolio_revision(&content),
        portfolio: serde_json::from_slice(&content)?,
    })
}

#[command]
pub fn load_portfolio_for_repair() -> Result<PortfolioRepairSnapshot, AppError> {
    repair_snapshot_at(&get_portfolio_path())
}

fn repair_processes_at(
    path: &Path,
    expected_revision: &str,
    removed_indexes: &[usize],
) -> Result<String, AppError> {
    let preserved = path.with_file_name(format!(
        "portfolio.before-repair-{}.json",
        uuid::Uuid::new_v4()
    ));
    repair_processes_preserving_at(path, expected_revision, removed_indexes, &preserved)
}

fn repair_processes_preserving_at(
    path: &Path,
    expected_revision: &str,
    removed_indexes: &[usize],
    preserved: &Path,
) -> Result<String, AppError> {
    let original = fs::read(path)?;
    // Compare the exact bytes read for review, not JSON sent back through JS.
    // JS normalizes 1.0 to 1 and can round large integers; neither is a file edit.
    if portfolio_revision(&original) != expected_revision {
        return Err(AppError::Validation(
            "The active portfolio changed. Reload the process list before removing anything."
                .into(),
        ));
    }
    let mut candidate: Value = serde_json::from_slice(&original)?;
    let processes = candidate
        .get_mut("processes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            AppError::Validation("The active file has no readable process list.".into())
        })?;
    if removed_indexes.is_empty()
        || removed_indexes
            .iter()
            .any(|index| *index >= processes.len())
    {
        return Err(AppError::Validation(
            "Select valid process entries to remove.".into(),
        ));
    }
    let mut index = 0;
    processes.retain(|_| {
        let keep = !removed_indexes.contains(&index);
        index += 1;
        keep
    });
    // Unsupported types remain rejected. This command never repairs or converts
    // a node, and preserves every field outside the selected process entries.
    let _: Portfolio = serde_json::from_value(candidate.clone())?;
    let content = serde_json::to_string_pretty(&candidate)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(preserved)?;
    file.write_all(&original)?;
    file.sync_all()?;
    drop(file);
    // Keep the normal .bak intact; this independent copy survives later saves.
    atomic_write_json(path, &content, false)?;
    Ok(preserved.to_string_lossy().into_owned())
}

#[command]
pub fn repair_portfolio_processes(
    expected_revision: String,
    removed_indexes: Vec<usize>,
) -> Result<String, AppError> {
    let _guard = PORTFOLIO_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::Internal("Portfolio write lock failed".into()))?;
    repair_processes_at(&get_portfolio_path(), &expected_revision, &removed_indexes)
}

/// Load the main portfolio from AppData
#[command]
pub fn load_portfolio() -> Result<Portfolio, AppError> {
    let path = get_portfolio_path();

    // Ensure config directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    if path.exists() {
        let content = fs::read_to_string(&path)?;
        let portfolio = serde_json::from_str(&content)?;
        Ok(portfolio)
    } else {
        // Return default empty portfolio
        Ok(Portfolio::default())
    }
}

#[command]
pub fn has_portfolio_backup() -> bool {
    backup_path(&get_portfolio_path()).exists()
}

#[command]
pub fn load_portfolio_backup() -> Result<Value, AppError> {
    let path = get_portfolio_path();
    let recovery_path = backup_path(&path);
    if !recovery_path.exists() {
        return Err(AppError::NotFound(
            "No portfolio recovery file exists".to_string(),
        ));
    }

    let content = fs::read_to_string(&recovery_path)?;
    Ok(serde_json::from_str(&content)?)
}

fn validate_portfolio_backup(
    content: &str,
    expected_portfolio: &Value,
) -> Result<Portfolio, AppError> {
    let current_candidate: Value = serde_json::from_str(content)?;
    if current_candidate != *expected_portfolio {
        return Err(AppError::Validation(
            "The portfolio recovery file changed while it was being validated; please try again"
                .to_string(),
        ));
    }

    Ok(serde_json::from_value(current_candidate)?)
}

#[command]
pub fn restore_portfolio_backup(expected_portfolio: Value) -> Result<Portfolio, AppError> {
    let _guard = PORTFOLIO_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::Internal("Portfolio write lock failed".into()))?;
    let path = get_portfolio_path();
    let recovery_path = backup_path(&path);
    if !recovery_path.exists() {
        return Err(AppError::NotFound(
            "No portfolio recovery file exists".to_string(),
        ));
    }

    let content = fs::read_to_string(&recovery_path)?;
    let portfolio = validate_portfolio_backup(&content, &expected_portfolio)?;
    atomic_write_json(&path, &content, false)?;
    Ok(portfolio)
}

/// Save the main portfolio to AppData
#[command]
pub fn save_portfolio(portfolio: Portfolio) -> Result<(), AppError> {
    let _guard = PORTFOLIO_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::Internal("Portfolio write lock failed".into()))?;
    let path = get_portfolio_path();

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let content = serde_json::to_string_pretty(&portfolio)?;
    atomic_write_json(&path, &content, true)?;
    Ok(())
}

/// List all temp portfolios
#[command]
pub fn list_temp_portfolios() -> Result<Vec<String>, AppError> {
    let dir = get_temp_portfolios_dir();

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut names = vec![];
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            if let Some(stem) = path.file_stem() {
                names.push(stem.to_string_lossy().to_string());
            }
        }
    }
    Ok(names)
}

/// Validate that a temp portfolio name doesn't contain path traversal characters
fn validate_portfolio_name(name: &str) -> Result<(), AppError> {
    if name.contains("..") || name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err(AppError::Validation(
            "Invalid portfolio name: must not contain path separators or '..'".to_string(),
        ));
    }
    Ok(())
}

/// Load a specific temp portfolio
#[command]
pub fn load_temp_portfolio(name: String) -> Result<Portfolio, AppError> {
    validate_portfolio_name(&name)?;
    let path = get_temp_portfolio_path(&name);

    if path.exists() {
        let content = fs::read_to_string(&path)?;
        let portfolio = serde_json::from_str(&content)?;
        Ok(portfolio)
    } else {
        Err(AppError::NotFound(format!(
            "Temp portfolio '{}' not found",
            name
        )))
    }
}

/// Save a temp portfolio
#[command]
pub fn save_temp_portfolio(name: String, portfolio: Portfolio) -> Result<(), AppError> {
    validate_portfolio_name(&name)?;
    let path = get_temp_portfolio_path(&name);

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let content = serde_json::to_string_pretty(&portfolio)?;
    atomic_write_json(&path, &content, true)?;
    Ok(())
}

/// Delete a temp portfolio
#[command]
pub fn delete_temp_portfolio(name: String) -> Result<(), AppError> {
    validate_portfolio_name(&name)?;
    let path = get_temp_portfolio_path(&name);

    if path.exists() {
        fs::remove_file(&path)?;
    }
    Ok(())
}

/// Move a process from temp portfolio to main
#[command]
pub fn move_process_to_main(temp_name: String, process_id: String) -> Result<(), AppError> {
    // Load both portfolios
    let mut main = load_portfolio()?;
    let mut temp = load_temp_portfolio(temp_name.clone())?;

    // Find and remove process from temp
    let idx = temp
        .processes
        .iter()
        .position(|p| p.id == process_id)
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "Process '{}' not found in temp portfolio",
                process_id
            ))
        })?;
    let process = temp.processes.remove(idx);

    // Check for ID conflict in main, suffix if needed
    let mut final_process = process;
    if main.processes.iter().any(|p| p.id == final_process.id) {
        final_process.id = format!("{}-imported", final_process.id);
        final_process.title = format!("{} (Imported)", final_process.title);
    }

    // Add to main
    main.processes.push(final_process);

    // Save both
    save_portfolio(main)?;
    save_temp_portfolio(temp_name, temp)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn damaged_fixture() -> Value {
        let mut value = serde_json::to_value(Portfolio::default()).unwrap();
        value["processes"] = serde_json::json!([
            { "id": "good", "title": "Healthy", "graph": { "nodes": [], "edges": [], "swimlanes": [] } },
            { "id": "bad", "title": "Damaged", "graph": { "nodes": [
                { "id": "n", "type": "subprocess", "label": "Old", "position": { "x": 0, "y": 0 } }
            ], "edges": [], "swimlanes": [] } }
        ]);
        value["extensions"] = serde_json::json!({ "keep": "original metadata" });
        value
    }

    #[test]
    fn process_repair_preserves_original_bytes_backup_and_unselected_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("portfolio.json");
        let raw = damaged_fixture();
        let bytes = serde_json::to_vec_pretty(&raw).unwrap();
        fs::write(&path, &bytes).unwrap();
        fs::write(backup_path(&path), b"previous recovery bytes").unwrap();
        let snapshot = repair_snapshot_at(&path).unwrap();
        let preserved = repair_processes_at(&path, &snapshot.revision, &[1]).unwrap();
        assert_eq!(fs::read(preserved).unwrap(), bytes);
        assert_eq!(
            fs::read(backup_path(&path)).unwrap(),
            b"previous recovery bytes"
        );
        let actual: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let mut expected = raw;
        expected["processes"].as_array_mut().unwrap().remove(1);
        assert_eq!(actual, expected);
        let reopened: Portfolio = serde_json::from_value(actual).unwrap();
        assert_eq!(reopened.processes[0].id, "good");
    }

    #[test]
    fn process_repair_rejects_stale_selection_and_remaining_invalid_data_without_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("portfolio.json");
        let raw = damaged_fixture();
        let bytes = serde_json::to_vec(&raw).unwrap();
        fs::write(&path, &bytes).unwrap();
        let revision = repair_snapshot_at(&path).unwrap().revision;
        assert!(repair_processes_at(&path, "stale-revision", &[1]).is_err());
        assert!(repair_processes_at(&path, &revision, &[0]).is_err());
        assert!(repair_processes_at(&path, &revision, &[9]).is_err());
        assert!(repair_processes_at(&path, &revision, &[]).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn process_repair_does_not_replace_primary_if_preservation_cannot_be_created() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("portfolio.json");
        let preserved = dir.path().join("preserved.json");
        let raw = damaged_fixture();
        let bytes = serde_json::to_vec(&raw).unwrap();
        fs::write(&path, &bytes).unwrap();
        fs::write(&preserved, b"existing immutable copy").unwrap();
        let revision = repair_snapshot_at(&path).unwrap().revision;
        assert!(repair_processes_preserving_at(&path, &revision, &[1], &preserved).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::read(&preserved).unwrap(), b"existing immutable copy");
    }

    #[test]
    fn process_repair_survives_javascript_number_normalization() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("portfolio.json");
        let mut raw = damaged_fixture();
        raw["extensions"] =
            serde_json::json!({ "zoom": 1.0, "externalNumber": 9007199254740993_u64 });
        let bytes = serde_json::to_vec(&raw).unwrap();
        fs::write(&path, &bytes).unwrap();
        let snapshot = repair_snapshot_at(&path).unwrap();
        // A JS JSON.parse/JSON.stringify round trip represents these numbers
        // differently. The former object comparison rejected this unchanged file.
        let mut js_round_trip = snapshot.portfolio.clone();
        js_round_trip["extensions"]["zoom"] = serde_json::json!(1);
        js_round_trip["extensions"]["externalNumber"] = serde_json::json!(9007199254740992_u64);
        assert_ne!(snapshot.portfolio, js_round_trip);
        let ipc_snapshot: Value = serde_json::to_value(&snapshot).unwrap();
        let revision = ipc_snapshot["revision"].as_str().unwrap();
        let preserved = repair_processes_at(&path, revision, &[1]).unwrap();
        assert_eq!(fs::read(preserved).unwrap(), bytes);
        let actual: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(actual["extensions"], raw["extensions"]);
        assert_eq!(actual["processes"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn process_repair_rejects_real_file_changes_until_review_is_reloaded() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("portfolio.json");
        let raw = damaged_fixture();
        fs::write(&path, serde_json::to_vec(&raw).unwrap()).unwrap();
        let before = repair_snapshot_at(&path).unwrap();
        let mut changed = raw;
        changed["processes"][0]["title"] = serde_json::json!("Edited in another window");
        let new_bytes = serde_json::to_vec_pretty(&changed).unwrap();
        fs::write(&path, &new_bytes).unwrap();
        assert!(repair_processes_at(&path, &before.revision, &[1]).is_err());
        assert_eq!(fs::read(&path).unwrap(), new_bytes);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        let refreshed = repair_snapshot_at(&path).unwrap();
        let preserved = repair_processes_at(&path, &refreshed.revision, &[1]).unwrap();
        assert_eq!(fs::read(preserved).unwrap(), new_bytes);
    }

    #[test]
    fn accepts_the_exact_backup_candidate_that_was_validated() {
        let content = serde_json::to_string(&Portfolio::default()).unwrap();
        let expected: Value = serde_json::from_str(&content).unwrap();

        let recovered = validate_portfolio_backup(&content, &expected).unwrap();

        assert_eq!(recovered.version, Portfolio::default().version);
    }

    #[test]
    fn rejects_a_backup_that_changed_after_validation() {
        let content = serde_json::to_string(&Portfolio::default()).unwrap();
        let expected = serde_json::json!({ "version": "different" });

        let error = validate_portfolio_backup(&content, &expected).unwrap_err();

        assert!(matches!(error, AppError::Validation(_)));
    }
}
