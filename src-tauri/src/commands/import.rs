use crate::commands::portfolio::{load_portfolio, save_portfolio, save_temp_portfolio};
use crate::error::AppError;
use crate::models::portfolio::{
    AssetPreview, ImportOptions, ImportPreview, IncidentPreview, Portfolio, ProcessPreview,
};
use crate::utils::paths::validate_path;
use std::fs;
use tauri::command;

/// Preview the contents of an .axiom archive or .ax process fragment before importing.
#[command]
pub fn preview_import(path: String) -> Result<ImportPreview, AppError> {
    validate_path(&path, &["ax", "axiom"]).map_err(AppError::Validation)?;

    let content = fs::read_to_string(&path)?;
    let portfolio: Portfolio = serde_json::from_str(&content)?;

    Ok(ImportPreview {
        processes: portfolio
            .processes
            .iter()
            .map(|p| ProcessPreview {
                id: p.id.clone(),
                title: p.title.clone(),
                node_count: p.graph.nodes.len(),
            })
            .collect(),
        assets: portfolio
            .assets
            .iter()
            .map(|a| AssetPreview {
                id: a.id.clone(),
                name: a.name.clone(),
            })
            .collect(),
        incidents: portfolio
            .incidents
            .iter()
            .map(|i| IncidentPreview {
                id: i.id.clone(),
                title: i.title.clone(),
                finding_count: i.findings.len(),
            })
            .collect(),
    })
}

/// Import selected items from an .axiom archive or .ax process fragment.
#[command]
pub fn import_to_portfolio(path: String, options: ImportOptions) -> Result<(), AppError> {
    validate_path(&path, &["ax", "axiom"]).map_err(AppError::Validation)?;

    let content = fs::read_to_string(&path)?;
    let source: Portfolio = serde_json::from_str(&content)?;
    let source_extra = source.extra.clone();

    // Filter selected items
    let selected_processes: Vec<_> = source
        .processes
        .into_iter()
        .filter(|p| options.process_ids.contains(&p.id))
        .collect();
    let selected_assets: Vec<_> = source
        .assets
        .into_iter()
        .filter(|a| options.asset_ids.contains(&a.id))
        .collect();
    let selected_incidents: Vec<_> = source
        .incidents
        .into_iter()
        .filter(|i| options.incident_ids.contains(&i.id))
        .collect();

    if options.target == "main" {
        // Import to main portfolio
        let mut main = load_portfolio()?;

        // Add with conflict resolution (suffix if ID exists)
        for mut process in selected_processes {
            if main.processes.iter().any(|p| p.id == process.id) {
                process.id = format!("{}-imported", process.id);
                process.title = format!("{} (Imported)", process.title);
            }
            main.processes.push(process);
        }

        for mut asset in selected_assets {
            if main.assets.iter().any(|a| a.id == asset.id) {
                asset.id = format!("{}-imported", asset.id);
                asset.name = format!("{} (Imported)", asset.name);
            }
            main.assets.push(asset);
        }

        for mut incident in selected_incidents {
            if main.incidents.iter().any(|i| i.id == incident.id) {
                incident.id = format!("{}-imported", incident.id);
                incident.title = format!("{} (Imported)", incident.title);
            }
            main.incidents.push(incident);
        }

        save_portfolio(main)?;
    } else {
        // Create new temp portfolio
        let temp = Portfolio {
            version: "1.0".into(),
            last_modified: chrono::Utc::now().to_rfc3339(),
            last_backup: None,
            processes: selected_processes,
            assets: selected_assets,
            asset_categories: vec![],
            incidents: selected_incidents,
            journal: Default::default(),
            process_folders: vec![], // Initialize empty folders for temp portfolio
            extra: source_extra,
        };

        save_temp_portfolio(options.target, temp)?;
    }

    Ok(())
}
