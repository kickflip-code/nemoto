use crate::models::project::{Asset, Graph, Incident};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn default_version() -> String {
    "1.0".into()
}

fn now_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

// For consistency, we'll define AssetCategory here since it's portfolio-specific
// Re-exporting from project would also work, but keeping it local is cleaner

/// A single process with its own graph (includes nested sub-processes via node children)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Process {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "now_timestamp")]
    pub created_at: String,
    #[serde(default = "now_timestamp")]
    pub updated_at: String,
    pub graph: Graph,

    /// Map of subGraphId -> Graph for flattened drill-down
    #[serde(default)]
    pub sub_graphs: Option<std::collections::HashMap<String, Graph>>,

    /// Optional folder ID to link this process to a folder
    #[serde(default)]
    pub folder_id: Option<String>,

    /// Canvas visualization mode
    #[serde(default)]
    pub mode: CanvasMode,

    /// Preserve frontend-owned and future schema fields, e.g. ownerId/metaSettings.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CanvasMode {
    #[default]
    Swimlane,
    #[serde(rename = "swimlane-vertical")]
    SwimlaneVertical,
    Blank,
}

/// The main portfolio containing all user data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Portfolio {
    /// Schema version for future migrations
    #[serde(default = "default_version")]
    pub version: String,

    /// Last modification timestamp
    #[serde(default = "now_timestamp")]
    pub last_modified: String,

    /// Last backup timestamp (for reminder feature)
    pub last_backup: Option<String>,

    /// All processes owned by the user
    #[serde(default)]
    pub processes: Vec<Process>,

    /// Folder structure for processes
    #[serde(default)]
    pub process_folders: Vec<ProcessFolder>,

    /// All assets (shared across processes)
    #[serde(default)]
    pub assets: Vec<Asset>,

    /// Dynamic asset categories (user-configurable)
    #[serde(default)]
    pub asset_categories: Vec<AssetCategory>,

    /// All incidents (can be linked to processes)
    #[serde(default)]
    pub incidents: Vec<Incident>,

    /// The contextual journal (NEW)
    #[serde(default)]
    pub journal: JournalData,

    /// Preserve frontend-owned and future schema fields, e.g. customThemes/activeThemeId.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessFolder {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default = "now_timestamp")]
    pub created_at: String,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// User-defined asset categories
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetCategory {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub color: String,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JournalData {
    #[serde(default)]
    pub notebooks: Vec<JournalNotebook>,
    #[serde(default)]
    pub entries: Vec<JournalEntry>,
    #[serde(default)]
    pub folders: Vec<JournalFolder>,
    #[serde(default)]
    pub tags: Vec<JournalTag>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalFolder {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default = "now_timestamp")]
    pub created_at: String,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalNotebook {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default = "now_timestamp")]
    pub created_at: String,
    #[serde(default = "now_timestamp")]
    pub updated_at: String,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub id: String,
    #[serde(default)]
    pub notebook_id: String,
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default = "default_journal_content_format")]
    pub content_format: String,
    #[serde(default = "default_journal_content_version")]
    pub content_version: u32,
    #[serde(default)]
    pub tags: Vec<String>, // JournalTag IDs
    #[serde(default, deserialize_with = "deserialize_linked_context")]
    pub linked_context: Vec<EntityReference>, // Supports both old (string[]) and new (EntityReference[]) formats
    #[serde(default = "now_timestamp")]
    pub created_at: String,
    #[serde(default = "now_timestamp")]
    pub updated_at: String,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

fn default_journal_content_format() -> String {
    "html".to_string()
}

fn default_journal_content_version() -> u32 {
    1
}

// Custom deserializer to handle both old string[] and new EntityReference[] formats
fn deserialize_linked_context<'de, D>(deserializer: D) -> Result<Vec<EntityReference>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, Visitor};
    use serde_json::Value;

    struct LinkedContextVisitor;

    impl<'de> Visitor<'de> for LinkedContextVisitor {
        type Value = Vec<EntityReference>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("an array of strings or EntityReferences")
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: de::SeqAccess<'de>,
        {
            let mut result = Vec::new();

            while let Some(value) = seq.next_element::<Value>()? {
                match value {
                    // New format: { id: "...", type: "..." }
                    Value::Object(_) => {
                        // Lenient deserialization: skip if invalid instead of erroring
                        if let Ok(entity_ref) = serde_json::from_value::<EntityReference>(value) {
                            result.push(entity_ref);
                        }
                    }
                    // Old format: "node-123" (string)
                    Value::String(id) => {
                        // Defer legacy type resolution until the complete portfolio is
                        // available in the frontend migration. Prefixes are not stable IDs.
                        result.push(EntityReference {
                            id,
                            entity_type: "unknown".to_string(),
                            process_id: None,
                            path: Vec::new(),
                            source: None,
                            extra: HashMap::new(),
                        });
                    }
                    _ => return Err(de::Error::custom("expected object or string")),
                }
            }

            Ok(result)
        }
    }

    deserializer.deserialize_seq(LinkedContextVisitor)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityReference {
    pub id: String,
    #[serde(rename = "type")]
    pub entity_type: String, // "process" | "node" | "asset" | "journalEntry" | "tag" | "incident"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub path: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalTag {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub color: String, // Palette ID
    #[serde(default)]
    pub archived: bool,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl Default for Portfolio {
    fn default() -> Self {
        Self {
            version: "1.0".into(),
            last_modified: chrono::Utc::now().to_rfc3339(),
            last_backup: None,
            processes: vec![],
            process_folders: vec![],
            assets: vec![],
            asset_categories: vec![],
            incidents: vec![],
            journal: JournalData::default(),
            extra: HashMap::new(),
        }
    }
}

/// Wrapper for temporary portfolios (imported data)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct TempPortfolioMeta {
    pub name: String,
    pub imported_at: String,
    pub source_path: Option<String>,
}

/// Options for selective export
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub process_ids: Vec<String>,
    pub asset_ids: Vec<String>,
    pub incident_ids: Vec<String>,
}

/// Options for import destination
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    /// "main" or a temp portfolio name
    pub target: String,

    /// Which items to import
    pub process_ids: Vec<String>,
    pub asset_ids: Vec<String>,
    pub incident_ids: Vec<String>,
}

/// Preview of importable content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub processes: Vec<ProcessPreview>,
    pub assets: Vec<AssetPreview>,
    pub incidents: Vec<IncidentPreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessPreview {
    pub id: String,
    pub title: String,
    pub node_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetPreview {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentPreview {
    pub id: String,
    pub title: String,
    pub finding_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn serde_round_trip_preserves_unknown_fields_across_the_portfolio_tree() {
        let input = json!({
            "schemaVersion": 2,
            "version": "1.0",
            "lastModified": "2026-08-12T12:00:00Z",
            "futureRoot": { "enabled": true },
            "processes": [{
                "id": "process-1",
                "title": "Round trip",
                "createdAt": "2026-08-12T12:00:00Z",
                "updatedAt": "2026-08-12T12:00:00Z",
                "mode": "blank",
                "futureProcess": "preserved",
                "graph": {
                    "nodes": [{
                        "id": "node-1",
                        "type": "action",
                        "label": "A",
                        "position": { "x": 0, "y": 0 },
                        "futureNode": 42
                    }],
                    "edges": [],
                    "swimlanes": [],
                    "viewport": { "x": 1, "y": 2, "zoom": 0.8 }
                }
            }],
            "processFolders": [],
            "assets": [],
            "assetCategories": [],
            "incidents": [],
            "journal": {
                "notebooks": [],
                "folders": [],
                "entries": [],
                "tags": [],
                "futureJournal": ["plugin-data"]
            },
            "plugins": {
                "schemaVersion": 1,
                "requirements": [{
                    "pluginId": "org.axiom.fmea",
                    "version": ">=0.1.0 <1.0.0",
                    "dataVersion": 1,
                    "requirement": "required",
                    "activation": "active"
                }],
                "semanticData": {
                    "records": [{
                        "schema": "axiom.semantic-record",
                        "schemaVersion": 1,
                        "id": "failure-mode-1",
                        "type": "org.axiom.fmea/failure-mode",
                        "owner": {
                            "pluginId": "org.axiom.fmea",
                            "pluginVersion": "0.1.0",
                            "dataVersion": 1
                        },
                        "label": "Handover can fail",
                        "properties": { "severity": 8 },
                        "provenance": {
                            "assertion": "human-assessment",
                            "origin": { "kind": "human", "displayName": "Analyst" },
                            "recordedAt": "2026-08-12T12:00:00Z",
                            "sources": []
                        },
                        "createdAt": "2026-08-12T12:00:00Z",
                        "updatedAt": "2026-08-12T12:00:00Z"
                    }],
                    "relations": [],
                    "annotations": []
                }
            },
            "extensions": { "example.plugin": { "portable": true } }
        });

        let portfolio: Portfolio = serde_json::from_value(input.clone()).unwrap();
        let output = serde_json::to_value(portfolio).unwrap();

        assert_eq!(output["schemaVersion"], json!(2));
        assert_eq!(output["futureRoot"], input["futureRoot"]);
        assert_eq!(output["extensions"], input["extensions"]);
        assert_eq!(output["plugins"], input["plugins"]);
        assert_eq!(output["processes"][0]["futureProcess"], json!("preserved"));
        assert_eq!(
            output["processes"][0]["graph"]["viewport"],
            input["processes"][0]["graph"]["viewport"]
        );
        assert_eq!(
            output["processes"][0]["graph"]["nodes"][0]["futureNode"],
            json!(42)
        );
        assert_eq!(output["journal"]["futureJournal"], json!(["plugin-data"]));

        let _: Value = output;
    }
}
