use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============ META ============
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub version: String,
    pub title: String,
    pub author: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// ============ GRAPH ============
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub swimlanes: Vec<Swimlane>,
    #[serde(default)]
    pub mode: crate::models::portfolio::CanvasMode,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeType {
    Start,
    End,
    Action,
    Decision,
    System,
    #[serde(rename = "post-it")]
    PostIt,
    Group,
    Swimlane,
    Arrow,
    Resource,
    Event,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventDatePrecision {
    Year,
    Month,
    Day,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    #[default]
    Generic,
    Message,
    Signal,
    Condition,
    Timer,
    Error,
    Milestone,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventBehavior {
    Observed,
    Emitted,
    Neutral,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum EventTemporalValue {
    Date {
        value: String,
        precision: EventDatePrecision,
        #[serde(flatten)]
        extra: HashMap<String, serde_json::Value>,
    },
    Datetime {
        value: String,
        #[serde(default, rename = "timeZone")]
        time_zone: Option<String>,
        #[serde(flatten)]
        extra: HashMap<String, serde_json::Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EventTiming {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<EventTemporalValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<EventTemporalValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all_day: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<HashMap<String, serde_json::Value>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EventData {
    #[serde(default)]
    pub kind: EventKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub behavior: Option<EventBehavior>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing: Option<EventTiming>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<HashMap<String, serde_json::Value>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: NodeType,
    #[serde(default)]
    pub label: Option<String>,
    pub position: Position,

    /// Optional explicit node dimensions.
    pub width: Option<f64>,
    pub height: Option<f64>,

    /// Custom data (key-value)
    #[serde(default)]
    pub data: serde_json::Value,

    /// Optional swimlane association
    #[serde(default)]
    pub swimlane_id: Option<String>,

    /// Optional parent/group association
    #[serde(default)]
    pub parent_id: Option<String>,

    /// Linked asset IDs
    #[serde(default)]
    pub asset_ids: Vec<String>,

    /// Drill-down: Reference to Process.sub_graphs
    #[serde(default)]
    pub sub_graph_id: Option<String>,

    /// Core-owned process-event semantics, with timing as an optional facet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<EventData>,

    /// Legacy drill-down (kept for JS migration script to read)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Graph>,

    /// Preserve frontend-owned and future schema fields.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum EdgeStyle {
    #[default]
    Solid,
    Dashed,
    Dotted,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    #[serde(default)]
    pub source_handle_id: Option<String>,
    #[serde(default)]
    pub target_handle_id: Option<String>,
    #[serde(default)]
    pub style: EdgeStyle,
    pub label: Option<String>,
    #[serde(default)]
    pub label_position: Option<f64>,
    #[serde(default)]
    pub label_orientation: Option<String>,
    #[serde(default)]
    pub label_size: Option<String>,
    #[serde(default)]
    pub label_color: Option<String>,
    #[serde(default, rename = "type")]
    pub edge_type: Option<String>,
    #[serde(default)]
    pub animated: Option<bool>,

    /// Preserve frontend-owned and future schema fields.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// ============ SWIMLANE ============
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Swimlane {
    pub id: String,
    pub label: String,
    pub color: String,
    pub order: i32,
    #[serde(default = "default_swimlane_height")]
    pub height: i32,
    /// Width for Vertical Swimlanes (optional)
    #[serde(default)]
    pub width: Option<i32>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

fn default_swimlane_height() -> i32 {
    300
}

// ============ ASSETS ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub asset_type: String,
    pub parent_id: Option<String>,

    /// Flexible metadata storage for custom form data
    #[serde(default)]
    pub metadata: serde_json::Value,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// ============ INCIDENTS ============
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub timestamp: String,
    pub text: String,
    #[serde(default)]
    pub linked_node_ids: Vec<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Incident {
    pub id: String,
    pub title: String,
    pub created_at: String,
    #[serde(default)]
    pub findings: Vec<Finding>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// ============ ROOT PROJECT ============
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxiomProject {
    pub meta: ProjectMeta,
    #[serde(default)]
    pub assets: Vec<Asset>,
    pub graph: Graph,
    #[serde(default)]
    pub incidents: Vec<Incident>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn semantic_drilldown_round_trip_and_removed_type_rejection() {
        let input = json!({
            "id": "action-1", "type": "action", "label": "Diagnose",
            "position": { "x": 10.0, "y": 20.0 }, "subGraphId": "diagnosis",
            "assetIds": ["identity"], "extensions": { "org.example": { "keep": true } }
        });
        let node: Node = serde_json::from_value(input.clone()).unwrap();
        let output = serde_json::to_value(node).unwrap();
        for key in [
            "id",
            "type",
            "label",
            "position",
            "subGraphId",
            "assetIds",
            "extensions",
        ] {
            assert_eq!(output[key], input[key]);
        }
        let mut removed = input;
        removed["type"] = json!("subprocess");
        assert!(serde_json::from_value::<Node>(removed).is_err());
    }

    #[test]
    fn event_node_round_trip_preserves_process_timing_and_extension_fields() {
        let input = json!({
            "id": "event-1",
            "type": "event",
            "label": "Payment confirmed",
            "position": { "x": 10.0, "y": 20.0 },
            "event": {
                "kind": "message",
                "behavior": "observed",
                "timing": {
                    "start": {
                        "kind": "datetime",
                        "value": "2026-09-05T08:00:00Z",
                        "timeZone": "Europe/Stockholm",
                        "extensions": { "org.example.source": { "id": "42" } }
                    },
                    "end": {
                        "kind": "datetime",
                        "value": "2026-09-05T09:00:00Z",
                        "timeZone": "Europe/Stockholm"
                    },
                    "allDay": false,
                    "extensions": { "org.example.timing": { "precision": "exact" } },
                    "futureTimingField": ["kept"]
                },
                "metadata": { "owner": "operations" },
                "extensions": { "org.example.process": { "portable": true } },
                "futureEventField": ["kept"]
            }
        });

        let node: Node = serde_json::from_value(input.clone()).unwrap();
        let output = serde_json::to_value(node).unwrap();

        assert_eq!(output["type"], json!("event"));
        assert_eq!(output["event"], input["event"]);
    }
}
