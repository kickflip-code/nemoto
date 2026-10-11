//! ADR-034 protocol reservation. This module registers no execution command.
//! Requirements describe compatibility, never runtime availability or grants.

use std::collections::BTreeSet;

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const PLUGIN_UI_MINIMUM_HOST_API: &str = "1.8.0";
pub const PLUGIN_UI_PROTOCOL_VERSION: u32 = 1;
pub const UI_PRIMITIVES: &[&str] = &[
    "stack",
    "grid",
    "text",
    "button",
    "text-input",
    "date-input",
    "checkbox",
    "select",
    "list",
    "dialog",
    "rich-text",
    "form",
    "presentation",
];
pub const UI_EFFECTS: &[&str] = &[
    "read.search",
    "read.entity",
    "read.relations",
    "storage.collection.read-page",
    "storage.collection.query-page",
    "storage.collection.transact",
    "storage.document.get",
    "storage.document.list",
    "storage.document.transact",
    "workspace.context",
    "workspace.open",
    "output.text-file",
    "output.clipboard-text",
    "output.text-buffer",
    "notice.show",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUiLimits {
    pub request_bytes: usize,
    pub result_bytes: usize,
    pub state_bytes: usize,
    pub event_bytes: usize,
    pub tree_bytes: usize,
    pub tree_nodes: usize,
    pub tree_depth: usize,
    pub children_per_node: usize,
    pub effects_per_result: usize,
    pub storage_batches_per_result: usize,
    pub snapshot_page_bytes: usize,
    pub snapshot_page_items: usize,
    pub queued_events: usize,
    pub in_flight_per_instance: usize,
    pub instances_per_plugin: usize,
    pub reductions_per_second: usize,
    pub reductions_per_minute: usize,
    pub deadline_ms: u64,
    pub text_output_bytes: usize,
}

pub const PLUGIN_UI_LIMITS: PluginUiLimits = PluginUiLimits {
    request_bytes: 240 * 1024,
    result_bytes: 512 * 1024,
    state_bytes: 64 * 1024,
    event_bytes: 64 * 1024,
    tree_bytes: 256 * 1024,
    tree_nodes: 1_000,
    tree_depth: 16,
    children_per_node: 100,
    effects_per_result: 16,
    storage_batches_per_result: 1,
    snapshot_page_bytes: 64 * 1024,
    snapshot_page_items: 100,
    queued_events: 32,
    in_flight_per_instance: 1,
    instances_per_plugin: 2,
    reductions_per_second: 20,
    reductions_per_minute: 600,
    deadline_ms: 1_000,
    text_output_bytes: 128 * 1024,
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginUiProtocolRequirement {
    pub schema: String,
    pub schema_version: u32,
    pub protocol_version: u32,
    pub tree_version: u32,
    pub effects_version: u32,
    pub abi: String,
    pub required_primitives: Vec<String>,
    pub required_effects: Vec<String>,
}

impl PluginUiProtocolRequirement {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.schema != "axiom.plugin-ui"
            || self.schema_version != 1
            || self.protocol_version != PLUGIN_UI_PROTOCOL_VERSION
            || self.tree_version != 1
            || self.effects_version != 1
            || self.abi != "axiom-wasm-v1"
            || self.required_primitives.is_empty()
            || !is_unique_subset(&self.required_primitives, UI_PRIMITIVES)
            || !is_unique_subset(&self.required_effects, UI_EFFECTS)
        {
            return Err("Unsupported plugin UI protocol requirement.");
        }
        Ok(())
    }
}

fn is_unique_subset(values: &[String], allowed: &[&str]) -> bool {
    let mut seen = BTreeSet::new();
    values.len() <= allowed.len()
        && values
            .iter()
            .all(|value| allowed.contains(&value.as_str()) && seen.insert(value))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginUiWireErrorCode {
    InvalidJson,
    DuplicateJsonKey,
    RequestTooLarge,
    ResultTooLarge,
    InvalidInput,
    InvalidResult,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PluginUiInputWire {
    schema: String,
    schema_version: u32,
    protocol_version: u32,
    instance_id: String,
    sequence: u64,
    ui_revision: u64,
    portfolio_revision: u64,
    event: Value,
    state: Value,
    snapshots: Vec<Value>,
    environment: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PluginUiResultWire {
    schema: String,
    schema_version: u32,
    protocol_version: u32,
    instance_id: String,
    sequence: u64,
    ui_revision: u64,
    portfolio_revision: u64,
    state: Value,
    tree: Value,
    effects: Vec<Value>,
}

pub fn validate_plugin_ui_input_json(source: &[u8]) -> Result<(), PluginUiWireErrorCode> {
    if source.len() > PLUGIN_UI_LIMITS.request_bytes {
        return Err(PluginUiWireErrorCode::RequestTooLarge);
    }
    reject_duplicate_json_keys(source)?;
    let input: PluginUiInputWire =
        serde_json::from_slice(source).map_err(|_| PluginUiWireErrorCode::InvalidJson)?;
    if input.schema != "axiom.plugin-ui-input"
        || input.schema_version != 1
        || input.protocol_version != 1
        || !valid_id(&input.instance_id)
        || input.sequence == 0
        || input.sequence > 9_007_199_254_740_991
        || input.ui_revision > 9_007_199_254_740_991
        || input.portfolio_revision > 9_007_199_254_740_991
        || !bounded_json(&input.state, PLUGIN_UI_LIMITS.state_bytes)
        || !validate_event(&input.event)
        || !bounded_json(&input.event, PLUGIN_UI_LIMITS.event_bytes)
        || !validate_environment(&input.environment)
        || input.snapshots.len() > 100
        || input
            .snapshots
            .iter()
            .any(|snapshot| !validate_snapshot(snapshot, input.portfolio_revision))
    {
        return Err(PluginUiWireErrorCode::InvalidInput);
    }
    Ok(())
}

pub fn validate_plugin_ui_result_json(source: &[u8]) -> Result<(), PluginUiWireErrorCode> {
    if source.len() > PLUGIN_UI_LIMITS.result_bytes {
        return Err(PluginUiWireErrorCode::ResultTooLarge);
    }
    reject_duplicate_json_keys(source)?;
    let result: PluginUiResultWire =
        serde_json::from_slice(source).map_err(|_| PluginUiWireErrorCode::InvalidJson)?;
    let mut keys = BTreeSet::new();
    let mut actions = BTreeSet::new();
    let mut node_count = 0;
    let mut dialogs = 0;
    let tree_valid = validate_tree(
        &result.tree,
        1,
        &mut node_count,
        &mut dialogs,
        &mut keys,
        &mut actions,
    );
    let effect_ids: Vec<&str> = result
        .effects
        .iter()
        .filter_map(|effect| effect.get("id").and_then(Value::as_str))
        .collect();
    let storage_batches = result
        .effects
        .iter()
        .filter(|effect| {
            matches!(
                effect.get("kind").and_then(Value::as_str),
                Some("storage.collection.transact" | "storage.document.transact")
            )
        })
        .count();
    let notices = result
        .effects
        .iter()
        .filter(|effect| effect.get("kind").and_then(Value::as_str) == Some("notice.show"))
        .count();
    let state_valid = bounded_json(&result.state, PLUGIN_UI_LIMITS.state_bytes);
    let tree_size_valid = serialized_within(&result.tree, PLUGIN_UI_LIMITS.tree_bytes);
    let effects_valid = result.effects.iter().all(validate_effect);
    if result.schema != "axiom.plugin-ui-result"
        || result.schema_version != 1
        || result.protocol_version != 1
        || !valid_id(&result.instance_id)
        || result.sequence == 0
        || result.sequence > 9_007_199_254_740_991
        || result.ui_revision > 9_007_199_254_740_991
        || result.portfolio_revision > 9_007_199_254_740_991
        || !state_valid
        || !tree_size_valid
        || !matches!(
            result.tree.get("type").and_then(Value::as_str),
            Some("stack" | "grid")
        )
        || !tree_valid
        || result.effects.len() > PLUGIN_UI_LIMITS.effects_per_result
        || !effects_valid
        || effect_ids.len() != result.effects.len()
        || effect_ids.iter().collect::<BTreeSet<_>>().len() != effect_ids.len()
        || storage_batches > PLUGIN_UI_LIMITS.storage_batches_per_result
        || notices > 1
    {
        return Err(PluginUiWireErrorCode::InvalidResult);
    }
    Ok(())
}

/// Validates a guest reduction result against the exact Core-authored input
/// and the effects declared by the admitted contribution.
pub fn validate_plugin_ui_reduction_json(
    input_source: &[u8],
    result_source: &[u8],
    declared_primitives: &[String],
    declared_effects: &[String],
) -> Result<(), PluginUiWireErrorCode> {
    validate_plugin_ui_input_json(input_source)?;
    validate_plugin_ui_result_json(result_source)?;
    let input: PluginUiInputWire =
        serde_json::from_slice(input_source).map_err(|_| PluginUiWireErrorCode::InvalidJson)?;
    let result: PluginUiResultWire =
        serde_json::from_slice(result_source).map_err(|_| PluginUiWireErrorCode::InvalidJson)?;
    let declared = declared_effects
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let declared_nodes = declared_primitives
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let mut pending = vec![&result.tree];
    while let Some(node) = pending.pop() {
        if node
            .get("type")
            .and_then(Value::as_str)
            .is_none_or(|kind| !declared_nodes.contains(kind))
        {
            return Err(PluginUiWireErrorCode::InvalidResult);
        }
        if let Some(children) = node.get("children").and_then(Value::as_array) {
            pending.extend(children);
        }
    }
    if result.instance_id != input.instance_id
        || result.sequence != input.sequence
        || result.ui_revision != input.ui_revision
        || result.portfolio_revision != input.portfolio_revision
        || result.effects.iter().any(|effect| {
            effect
                .get("kind")
                .and_then(Value::as_str)
                .is_none_or(|kind| !declared.contains(kind))
        })
    {
        return Err(PluginUiWireErrorCode::InvalidResult);
    }
    Ok(())
}

fn object_with_exact_keys<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Map<String, Value>> {
    let object = value.as_object()?;
    (object.len() == keys.len() && object.keys().all(|key| keys.contains(&key.as_str())))
        .then_some(object)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
}

fn validate_event(value: &Value) -> bool {
    let Some(kind) = value.get("kind").and_then(Value::as_str) else {
        return false;
    };
    match kind {
        "mount" => object_with_exact_keys(value, &["kind", "surface", "capturedContext"])
            .is_some_and(|object| {
                matches!(
                    object["surface"].as_str(),
                    Some("app-rail" | "canvas-dialog")
                ) && (object["capturedContext"].is_null()
                    || validate_reference(&object["capturedContext"]))
            }),
        "action" => object_with_exact_keys(
            value,
            &["kind", "controlKey", "actionId", "value", "draftRevision"],
        )
        .is_some_and(|object| {
            object["controlKey"].as_str().is_some_and(valid_id)
                && object["actionId"].as_str().is_some_and(valid_id)
                && (object["draftRevision"].is_null()
                    || safe_u64(&object["draftRevision"]).is_some())
                && bounded_json(&object["value"], PLUGIN_UI_LIMITS.event_bytes)
        }),
        "invalidate" => object_with_exact_keys(value, &["kind", "flags"]).is_some_and(|object| {
            object_with_exact_keys(
                &object["flags"],
                &["data", "workspace", "viewport", "theme"],
            )
            .is_some_and(|flags| {
                flags.values().all(Value::is_boolean)
                    && flags.values().any(|flag| flag == &Value::Bool(true))
            })
        }),
        "effect-result" => {
            let Some(object) = value.as_object() else {
                return false;
            };
            let ok = object.get("ok").and_then(Value::as_bool);
            let exact = match ok {
                Some(true) => &["kind", "effectId", "ok", "result"][..],
                Some(false) => &["kind", "effectId", "ok", "error"][..],
                None => return false,
            };
            object_with_exact_keys(value, exact).is_some_and(|object| {
                object["effectId"].as_str().is_some_and(valid_id)
                    && match ok {
                        Some(true) => bounded_json(&object["result"], PLUGIN_UI_LIMITS.event_bytes),
                        Some(false) => object_with_exact_keys(
                            &object["error"],
                            &["code", "message", "retryable", "outcomeUnknown"],
                        )
                        .is_some_and(|error| {
                            error["code"].as_str().is_some_and(|code| {
                                code.len() >= 3
                                    && code.len() <= 80
                                    && code.bytes().all(|byte| {
                                        byte.is_ascii_uppercase()
                                            || byte.is_ascii_digit()
                                            || byte == b'_'
                                    })
                            }) && error["message"].as_str().is_some_and(|message| {
                                !message.is_empty() && message.encode_utf16().count() <= 500
                            }) && error["retryable"].is_boolean()
                                && error["outcomeUnknown"].is_boolean()
                        }),
                        None => false,
                    }
            })
        }
        _ => false,
    }
}

fn validate_environment(value: &Value) -> bool {
    object_with_exact_keys(
        value,
        &[
            "observedAt",
            "localDate",
            "timezoneOffsetMinutes",
            "viewport",
            "theme",
            "allocatedIds",
        ],
    )
    .is_some_and(|object| {
        object["observedAt"]
            .as_str()
            .is_some_and(valid_utc_timestamp)
            && object["localDate"]
                .as_str()
                .is_some_and(valid_calendar_date)
            && object["timezoneOffsetMinutes"]
                .as_i64()
                .is_some_and(|offset| (-840..=840).contains(&offset))
            && matches!(object["viewport"].as_str(), Some("compact" | "wide"))
            && object_with_exact_keys(&object["theme"], &["colorScheme", "density"]).is_some_and(
                |theme| {
                    matches!(theme["colorScheme"].as_str(), Some("light" | "dark"))
                        && matches!(
                            theme["density"].as_str(),
                            Some("compact" | "comfortable" | "spacious")
                        )
                },
            )
            && object["allocatedIds"].as_array().is_some_and(|ids| {
                ids.len() <= 16
                    && ids.iter().all(|id| id.as_str().is_some_and(valid_uuid))
                    && ids
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<BTreeSet<_>>()
                        .len()
                        == ids.len()
            })
    })
}

fn validate_snapshot(value: &Value, portfolio_revision: u64) -> bool {
    match value.get("kind").and_then(Value::as_str) {
        Some("entity") => object_with_exact_keys(value, &["kind", "value"]).is_some_and(|object| {
            validate_entity_snapshot(&object["value"], portfolio_revision)
                && bounded_json(&object["value"], PLUGIN_UI_LIMITS.snapshot_page_bytes)
        }),
        Some("storage-page") => object_with_exact_keys(
            value,
            &[
                "kind",
                "source",
                "portfolioRevision",
                "subject",
                "cursor",
                "nextCursor",
                "items",
            ],
        )
        .is_some_and(|object| {
            matches!(object["source"].as_str(), Some("collection" | "document"))
                && object["portfolioRevision"].as_u64() == Some(portfolio_revision)
                && object["subject"].as_str().is_some_and(|subject| {
                    !subject.is_empty() && subject.encode_utf16().count() <= 160
                })
                && object["items"]
                    .as_array()
                    .is_some_and(|items| items.len() <= PLUGIN_UI_LIMITS.snapshot_page_items)
                && nullable_bounded_string(&object["cursor"], 120, false)
                && nullable_bounded_string(&object["nextCursor"], 120, false)
                && bounded_json(value, PLUGIN_UI_LIMITS.snapshot_page_bytes)
        }),
        _ => false,
    }
}

fn validate_tree(
    value: &Value,
    depth: usize,
    count: &mut usize,
    dialogs: &mut usize,
    keys: &mut BTreeSet<String>,
    actions: &mut BTreeSet<String>,
) -> bool {
    fn children(object: &Map<String, Value>) -> Option<&Vec<Value>> {
        object
            .get("children")
            .and_then(Value::as_array)
            .filter(|items| items.len() <= PLUGIN_UI_LIMITS.children_per_node)
    }
    *count += 1;
    if depth > PLUGIN_UI_LIMITS.tree_depth || *count > PLUGIN_UI_LIMITS.tree_nodes {
        return false;
    }
    let Some(object) = value.as_object() else {
        return false;
    };
    let Some(key) = object.get("key").and_then(Value::as_str) else {
        return false;
    };
    if !valid_id(key) || !keys.insert(key.to_owned()) {
        return false;
    }
    let Some(kind) = object.get("type").and_then(Value::as_str) else {
        return false;
    };
    let register_action = |name: &str, actions: &mut BTreeSet<String>| {
        object
            .get(name)
            .and_then(Value::as_str)
            .is_some_and(|id| valid_id(id) && actions.insert(id.to_owned()))
    };
    match kind {
        "presentation" => {
            object_with_exact_keys(value, &["key", "type", "presentation", "children"]).is_some()
                && validate_presentation(&object["presentation"])
                && children(object).is_some_and(|items| (object["presentation"]["layout"].is_string() || items.len() == 1) && items.iter().all(|child|
                    validate_tree(child, depth + 1, count, dialogs, keys, actions)))
        }
        "stack" => {
            object_with_exact_keys(
                value,
                &["key", "type", "direction", "gap", "wrap", "children"],
            )
            .is_some()
                && matches!(
                    object["direction"].as_str(),
                    Some("vertical" | "horizontal")
                )
                && valid_gap(&object["gap"])
                && object["wrap"].is_boolean()
                && children(object).is_some_and(|items| {
                    items
                        .iter()
                        .all(|child| validate_tree(child, depth + 1, count, dialogs, keys, actions))
                })
        }
        "grid" => {
            object_with_exact_keys(value, &["key", "type", "columns", "gap", "children"]).is_some()
                && valid_gap(&object["gap"])
                && object_with_exact_keys(&object["columns"], &["compact", "wide"]).is_some_and(
                    |columns| {
                        columns.values().all(|value| {
                            value.as_u64().is_some_and(|value| (1..=4).contains(&value))
                        })
                    },
                )
                && children(object).is_some_and(|items| {
                    items
                        .iter()
                        .all(|child| validate_tree(child, depth + 1, count, dialogs, keys, actions))
                })
        }
        "text" => {
            object_with_exact_keys(value, &["key", "type", "text", "role", "tone"]).is_some()
                && object["text"]
                    .as_str()
                    .is_some_and(|text| text.encode_utf16().count() <= 4_000)
                && matches!(
                    object["role"].as_str(),
                    Some("body" | "heading" | "caption" | "status")
                )
                && matches!(
                    object["tone"].as_str(),
                    Some("default" | "muted" | "danger")
                )
        }
        "button" => {
            object_with_exact_keys(
                value,
                &["key", "type", "label", "actionId", "disabled", "variant"],
            )
            .is_some()
                && valid_label(&object["label"])
                && register_action("actionId", actions)
                && object["disabled"].is_boolean()
                && matches!(
                    object["variant"].as_str(),
                    Some("primary" | "secondary" | "ghost")
                )
        }
        "text-input" => {
            object_with_exact_keys(
                value,
                &[
                    "key",
                    "type",
                    "label",
                    "actionId",
                    "value",
                    "required",
                    "disabled",
                    "maxLength",
                ],
            )
            .is_some()
                && valid_label(&object["label"])
                && register_action("actionId", actions)
                && object["required"].is_boolean()
                && object["disabled"].is_boolean()
                && object["maxLength"].as_u64().is_some_and(|max| {
                    (1..=4_000).contains(&max)
                        && object["value"]
                            .as_str()
                            .is_some_and(|value| value.encode_utf16().count() <= max as usize)
                })
        }
        "date-input" => {
            object_with_exact_keys(
                value,
                &[
                    "key", "type", "label", "actionId", "value", "required", "disabled",
                ],
            )
            .is_some()
                && valid_label(&object["label"])
                && register_action("actionId", actions)
                && object["required"].is_boolean()
                && object["disabled"].is_boolean()
                && object["value"]
                    .as_str()
                    .is_some_and(|date| date.is_empty() || valid_calendar_date(date))
        }
        "checkbox" => {
            object_with_exact_keys(
                value,
                &["key", "type", "label", "actionId", "checked", "disabled"],
            )
            .is_some()
                && valid_label(&object["label"])
                && register_action("actionId", actions)
                && object["checked"].is_boolean()
                && object["disabled"].is_boolean()
        }
        "select" => {
            object_with_exact_keys(
                value,
                &[
                    "key", "type", "label", "actionId", "value", "disabled", "options",
                ],
            )
            .is_some()
                && valid_label(&object["label"])
                && register_action("actionId", actions)
                && object["disabled"].is_boolean()
                && validate_options(&object["options"], object["value"].as_str())
        }
        "list" => {
            object_with_exact_keys(value, &["key", "type", "label", "children"]).is_some()
                && valid_label(&object["label"])
                && children(object).is_some_and(|items| {
                    items
                        .iter()
                        .all(|child| validate_tree(child, depth + 1, count, dialogs, keys, actions))
                })
        }
        "form" => {
            object_with_exact_keys(
                value,
                &[
                    "key", "type", "label", "actionId", "dirty", "disabled", "children",
                ],
            )
            .is_some()
                && valid_label(&object["label"])
                && register_action("actionId", actions)
                && object["dirty"].is_boolean()
                && object["disabled"].is_boolean()
                && children(object).is_some_and(|items| {
                    items
                        .iter()
                        .all(|child| validate_tree(child, depth + 1, count, dialogs, keys, actions))
                })
        }
        "dialog" => {
            *dialogs += 1;
            object_with_exact_keys(
                value,
                &["key", "type", "label", "closeActionId", "dirty", "children"],
            )
            .is_some()
                && *dialogs <= 1
                && valid_label(&object["label"])
                && register_action("closeActionId", actions)
                && object["dirty"].is_boolean()
                && children(object).is_some_and(|items| {
                    items
                        .iter()
                        .all(|child| validate_tree(child, depth + 1, count, dialogs, keys, actions))
                })
        }
        "rich-text" => {
            object_with_exact_keys(
                value,
                &[
                    "key",
                    "type",
                    "label",
                    "actionId",
                    "value",
                    "editable",
                    "draftRevision",
                ],
            )
            .is_some()
                && valid_label(&object["label"])
                && register_action("actionId", actions)
                && object["editable"].is_boolean()
                && safe_u64(&object["draftRevision"]).is_some()
                && validate_rich_text(&object["value"])
        }
        _ => false,
    }
}

fn validate_presentation(value: &Value) -> bool {
    let Some(fields) = value.as_object() else { return false; };
    (value["control"] != "icon" || value["icon"].is_string()) && fields.iter().all(|(key, value)| match key.as_str() {
        "layout" => matches!(value.as_str(), Some("row" | "column")),
        "gap" => valid_gap(value),
        "wrap" => value.is_boolean(),
        "width" => matches!(value.as_str(), Some("auto" | "grow" | "double" | "compact")),
        "align" => matches!(value.as_str(), Some("start" | "center" | "end" | "stretch")),
        "justify" => matches!(value.as_str(), Some("start" | "center" | "end" | "between")),
        "surface" => matches!(value.as_str(), Some("plain" | "card" | "badge" | "segmented")),
        "tone" => matches!(value.as_str(), Some("default" | "muted" | "accent" | "success" | "warning" | "danger")),
        "textSize" => matches!(value.as_str(), Some("caption" | "body" | "section" | "title")),
        "padding" => matches!(value.as_str(), Some("none" | "small" | "medium" | "large")),
        "label" => matches!(value.as_str(), Some("visible" | "hidden")),
        "icon" => matches!(value.as_str(), Some("search" | "copy" | "download" | "external-link" | "trash" | "plus" | "link" | "unlink")),
        "control" => matches!(value.as_str(), Some("standard" | "segment" | "icon" | "matrix" | "link")),
        "editorHeight" => matches!(value.as_str(), Some("small" | "medium" | "large")),
        "accessibleLabel" => valid_label(value),
        "placeholder" => value.as_str().is_some_and(|text| text.encode_utf16().count() <= 500),
        "selected" => value.is_boolean(),
        _ => false,
    })
}

fn validate_effect(value: &Value) -> bool {
    let Some(object) = object_with_exact_keys(value, &["id", "kind", "payload"]) else {
        return false;
    };
    let Some(kind) = object["kind"].as_str() else {
        return false;
    };
    if !object["id"].as_str().is_some_and(valid_id) || !UI_EFFECTS.contains(&kind) {
        return false;
    }
    let Some(payload) = object["payload"].as_object() else {
        return false;
    };
    match kind {
        "workspace.context" => payload.is_empty(),
        "notice.show" => object_with_exact_keys(&object["payload"], &["message", "severity"])
            .is_some_and(|notice| {
                notice["message"].as_str().is_some_and(|message| {
                    !message.is_empty() && message.encode_utf16().count() <= 500
                }) && matches!(
                    notice["severity"].as_str(),
                    Some("info" | "success" | "warning" | "error")
                )
            }),
        "output.text-file" => {
            if let Some(output) =
                object_with_exact_keys(&object["payload"], &["suggestedBaseName", "buffered"])
            {
                return output["buffered"] == true
                    && output["suggestedBaseName"]
                        .as_str()
                        .is_some_and(valid_base_name);
            }
            object_with_exact_keys(&object["payload"], &["suggestedBaseName", "text"]).is_some_and(
                |output| {
                    output["suggestedBaseName"]
                        .as_str()
                        .is_some_and(valid_base_name)
                        && output["text"]
                            .as_str()
                            .is_some_and(|text| text.len() <= PLUGIN_UI_LIMITS.text_output_bytes)
                },
            )
        }
        "output.text-buffer" => object_with_exact_keys(&object["payload"], &["operation", "text"])
            .is_some_and(|output| {
                output["operation"]
                    .as_str()
                    .is_some_and(|op| ["reset", "append"].contains(&op))
                    && output["text"]
                        .as_str()
                        .is_some_and(|text| text.len() <= PLUGIN_UI_LIMITS.text_output_bytes)
            }),
        "output.clipboard-text" => {
            object_with_exact_keys(&object["payload"], &["buffered"])
                .is_some_and(|output| output["buffered"] == true)
                || object_with_exact_keys(&object["payload"], &["text"]).is_some_and(|output| {
                    output["text"]
                        .as_str()
                        .is_some_and(|text| text.len() <= PLUGIN_UI_LIMITS.text_output_bytes)
                })
        }
        "read.search" => object_with_exact_keys(&object["payload"], &["query", "kinds", "limit"])
            .is_some_and(|search| {
                search["query"].as_str().is_some_and(|query| {
                    !query.trim().is_empty() && query.encode_utf16().count() <= 240
                }) && search["kinds"].as_array().is_some_and(|kinds| {
                    kinds.len() <= 13
                        && kinds
                            .iter()
                            .all(|kind| kind.as_str().is_some_and(valid_core_kind))
                }) && search["limit"]
                    .as_u64()
                    .is_some_and(|limit| (1..=100).contains(&limit))
            }),
        "read.entity" => object_with_exact_keys(&object["payload"], &["reference"])
            .is_some_and(|payload| validate_reference(&payload["reference"])),
        "read.relations" => object_with_exact_keys(
            &object["payload"],
            &[
                "schema",
                "schemaVersion",
                "reference",
                "direction",
                "relationKinds",
                "limit",
                "cursor",
            ],
        )
        .is_some_and(|query| {
            query["schema"] == "axiom.plugin.relation-query"
                && query["schemaVersion"] == 1
                && validate_reference(&query["reference"])
                && matches!(
                    query["direction"].as_str(),
                    Some("outgoing" | "incoming" | "both")
                )
                && query["relationKinds"].as_array().is_some_and(|kinds| {
                    kinds.len() <= 50
                        && kinds
                            .iter()
                            .all(|kind| kind.as_str().is_some_and(valid_relation_kind))
                })
                && query["limit"]
                    .as_u64()
                    .is_some_and(|limit| (1..=100).contains(&limit))
                && nullable_bounded_string(&query["cursor"], 120, true)
        }),
        "storage.collection.read-page" => {
            object_with_exact_keys(&object["payload"], &["collectionId", "cursor", "limit"])
                .is_some_and(|read| {
                    read["collectionId"].as_str().is_some_and(valid_id)
                        && nullable_bounded_string(&read["cursor"], 120, true)
                        && read["limit"]
                            .as_u64()
                            .is_some_and(|limit| (1..=100).contains(&limit))
                })
        }
        "storage.collection.query-page" => object_with_exact_keys(
            &object["payload"],
            &["collectionId", "cursor", "limit", "query"],
        )
        .is_some_and(|read| {
            read["collectionId"].as_str().is_some_and(valid_id)
                && nullable_bounded_string(&read["cursor"], 120, true)
                && read["limit"]
                    .as_u64()
                    .is_some_and(|n| (1..=100).contains(&n))
                && valid_collection_query(&read["query"])
        }),
        "storage.collection.transact" => object_with_exact_keys(
            &object["payload"],
            &["collectionId", "expectedPortfolioRevision", "operations"],
        )
        .is_some_and(validate_collection_transaction),
        "storage.document.get" => object_with_exact_keys(&object["payload"], &["key"])
            .is_some_and(|get| get["key"].as_str().is_some_and(valid_storage_key)),
        "storage.document.list" => object_with_exact_keys(
            &object["payload"],
            &[
                "schema",
                "schemaVersion",
                "scope",
                "prefix",
                "limit",
                "cursor",
            ],
        )
        .is_some_and(|list| {
            list["schema"] == "axiom.plugin-storage-list"
                && list["schemaVersion"] == 1
                && list["scope"] == "portfolio"
                && list["prefix"]
                    .as_str()
                    .is_some_and(|prefix| prefix.encode_utf16().count() <= 160)
                && list["limit"]
                    .as_u64()
                    .is_some_and(|limit| (1..=100).contains(&limit))
                && nullable_bounded_string(&list["cursor"], 120, true)
        }),
        "storage.document.transact" => validate_document_transaction(payload),
        "workspace.open" => object_with_exact_keys(
            &object["payload"],
            &["schema", "schemaVersion", "action", "reference"],
        )
        .is_some_and(|open| {
            open["schema"] == "axiom.plugin-navigation-intent"
                && open["schemaVersion"] == 1
                && matches!(open["action"].as_str(), Some("reveal" | "inspect"))
                && validate_reference(&open["reference"])
        }),
        _ => false,
    }
}

fn valid_gap(value: &Value) -> bool {
    matches!(value.as_str(), Some("none" | "small" | "medium" | "large"))
}
fn safe_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .filter(|number| *number <= 9_007_199_254_740_991)
}
fn valid_label(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|label| !label.is_empty() && label.encode_utf16().count() <= 500)
}
fn nullable_bounded_string(value: &Value, max: usize, require_nonempty: bool) -> bool {
    value.is_null()
        || value
            .as_str()
            .is_some_and(|value| value.len() <= max && (!require_nonempty || !value.is_empty()))
}
fn valid_base_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 120
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
        })
}
fn valid_core_kind(value: &str) -> bool {
    matches!(
        value,
        "core.process"
            | "core.process-folder"
            | "core.node"
            | "core.edge"
            | "core.swimlane"
            | "core.asset"
            | "core.asset-category"
            | "core.journal-entry"
            | "core.journal-notebook"
            | "core.journal-folder"
            | "core.tag"
            | "core.incident"
            | "core.finding"
    )
}
fn valid_plugin_type(value: &str) -> bool {
    let Some((owner, suffix)) = value.split_once('/') else {
        return false;
    };
    value.len() <= 240
        && !suffix.contains('/')
        && valid_plugin_id(owner)
        && valid_lower_name(suffix, true)
}
fn valid_plugin_id(value: &str) -> bool {
    (3..=160).contains(&value.len())
        && value.split('.').count() >= 2
        && value.split('.').all(|part| valid_lower_name(part, false))
}
fn valid_lower_name(value: &str, allow_dot: bool) -> bool {
    !value.is_empty()
        && value
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && value
            .as_bytes()
            .last()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || byte == b'-'
                || (allow_dot && byte == b'.')
        })
}
fn valid_relation_kind(value: &str) -> bool {
    value.strip_prefix("core.relation.").is_some_and(|suffix| {
        !suffix.is_empty()
            && suffix.split('-').all(|part| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
            })
    }) || valid_plugin_type(value)
}
fn valid_storage_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && !value.ends_with('/')
        && value.split('/').all(|part| {
            !part.is_empty()
                && !matches!(part, "." | ".." | "__proto__" | "constructor" | "prototype")
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        })
}
fn valid_stable_id(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 240
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'@' | b'/' | b'-')
        })
}
fn valid_uuid(value: &str) -> bool {
    value.len() == 36 && uuid::Uuid::parse_str(value).is_ok()
}
fn valid_utc_timestamp(value: &str) -> bool {
    value.ends_with('Z')
        && DateTime::parse_from_rfc3339(value)
            .is_ok_and(|timestamp| timestamp.offset().local_minus_utc() == 0)
}
fn valid_calendar_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| ![4, 7].contains(&index) && !byte.is_ascii_digit())
    {
        return false;
    }
    let year: i32 = value[0..4].parse().unwrap_or(0);
    let month: u32 = value[5..7].parse().unwrap_or(0);
    let day: u32 = value[8..10].parse().unwrap_or(0);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1 && day <= max
}
fn validate_options(value: &Value, selected: Option<&str>) -> bool {
    let Some(options) = value.as_array().filter(|options| options.len() <= 100) else {
        return false;
    };
    let values: Vec<&str> = options
        .iter()
        .filter_map(|option| {
            object_with_exact_keys(option, &["value", "label"])
                .and_then(|option| option["value"].as_str())
                .filter(|value| value.encode_utf16().count() <= 500)
        })
        .collect();
    values.len() == options.len()
        && values.iter().collect::<BTreeSet<_>>().len() == values.len()
        && selected.is_some_and(|selected| selected.is_empty() || values.contains(&selected))
        && options.iter().all(|option| valid_label(&option["label"]))
}
fn validate_reference(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object.len() < 4
        || object.len() > 5
        || object.keys().any(|key| {
            !["schema", "schemaVersion", "kind", "id", "location"].contains(&key.as_str())
        })
        || object.get("schema").and_then(Value::as_str) != Some("axiom.entity-reference")
        || object.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || !object
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(valid_stable_id)
    {
        return false;
    }
    let Some(kind) = object.get("kind").and_then(Value::as_str) else {
        return false;
    };
    if !valid_core_kind(kind) && !valid_plugin_type(kind) {
        return false;
    }
    let location = object.get("location");
    if matches!(kind, "core.node" | "core.edge" | "core.swimlane")
        && !location
            .and_then(|value| value.get("processId"))
            .and_then(Value::as_str)
            .is_some_and(valid_stable_id)
    {
        return false;
    }
    if kind == "core.finding"
        && !location
            .and_then(|value| value.get("incidentId"))
            .and_then(Value::as_str)
            .is_some_and(valid_stable_id)
    {
        return false;
    }
    location.is_none_or(validate_location)
}
fn validate_location(value: &Value) -> bool {
    let Some(location) = value.as_object() else {
        return false;
    };
    !location.is_empty()
        && location
            .keys()
            .all(|key| ["processId", "graphPath", "incidentId"].contains(&key.as_str()))
        && location
            .get("processId")
            .is_none_or(|value| value.as_str().is_some_and(valid_stable_id))
        && location
            .get("incidentId")
            .is_none_or(|value| value.as_str().is_some_and(valid_stable_id))
        && location.get("graphPath").is_none_or(|value| {
            value.as_array().is_some_and(|path| {
                path.len() <= 64
                    && path
                        .iter()
                        .all(|id| id.as_str().is_some_and(valid_stable_id))
            })
        })
        && (location.get("graphPath").is_none() || location.get("processId").is_some())
}
fn validate_entity_snapshot(value: &Value, revision: u64) -> bool {
    object_with_exact_keys(
        value,
        &[
            "schema",
            "schemaVersion",
            "portfolioRevision",
            "reference",
            "label",
            "fields",
            "omittedFields",
        ],
    )
    .is_some_and(|snapshot| {
        snapshot["schema"] == "axiom.plugin.entity-snapshot"
            && snapshot["schemaVersion"] == 1
            && snapshot["portfolioRevision"] == revision
            && validate_reference(&snapshot["reference"])
            && snapshot["label"].as_str().is_some_and(|label| {
                !label.trim().is_empty() && label.encode_utf16().count() <= 500
            })
            && snapshot["fields"].is_object()
            && snapshot["omittedFields"].as_array().is_some_and(|fields| {
                fields.len() <= 100
                    && fields.iter().all(|field| {
                        field.as_str().is_some_and(|field| {
                            !field.trim().is_empty() && field.encode_utf16().count() <= 160
                        })
                    })
            })
    })
}
fn valid_query_operand(value: &Value) -> bool {
    object_with_exact_keys(value, &["path", "localDate"]).is_some_and(|operand| {
        operand["localDate"].is_boolean()
            && operand["path"].as_array().is_some_and(|path| {
                (1..=5).contains(&path.len())
                    && path.iter().all(|part| {
                        part.as_str().is_some_and(|key| {
                            !["__proto__", "prototype", "constructor"].contains(&key)
                                && !key.is_empty()
                                && key.len() <= 64
                                && key
                                    .bytes()
                                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                        })
                    })
            })
    })
}

fn valid_collection_query(value: &Value) -> bool {
    let keys: &[&str] = if value.get("distinctBy").is_some() {
        &["where", "order", "timezoneOffsetMinutes", "distinctBy"]
    } else {
        &["where", "order", "timezoneOffsetMinutes"]
    };
    object_with_exact_keys(value, keys).is_some_and(|query| {
        query.get("distinctBy").is_none_or(|value| {
            value.as_array().is_some_and(|operands| {
                (1..=2).contains(&operands.len()) && operands.iter().all(valid_query_operand)
            })
        }) && query["timezoneOffsetMinutes"]
            .as_i64()
            .is_some_and(|n| (-840..=840).contains(&n))
            && query["where"].as_array().is_some_and(|groups| {
                groups.len() <= 8
                    && groups.iter().all(|group| {
                        group.as_array().is_some_and(|tests| {
                            (1..=4).contains(&tests.len())
                                && tests.iter().all(|test| {
                                    object_with_exact_keys(test, &["operand", "operation", "value"])
                                        .is_some_and(|test| {
                                            valid_query_operand(&test["operand"])
                                                && test["operation"].as_str().is_some_and(|op| {
                                                    ["equals", "contains", "at-least", "at-most"]
                                                        .contains(&op)
                                                })
                                                && (test["value"].is_null()
                                                    || test["value"].is_boolean()
                                                    || test["value"].as_str().is_some_and(|s| {
                                                        s.encode_utf16().count() <= 500
                                                    }))
                                        })
                                })
                        })
                    })
            })
            && query["order"].as_array().is_some_and(|orders| {
                orders.len() <= 4
                    && orders.iter().all(|order| {
                        object_with_exact_keys(order, &["operand", "descending", "emptyLast"])
                            .is_some_and(|order| {
                                valid_query_operand(&order["operand"])
                                    && order["descending"].is_boolean()
                                    && order["emptyLast"].is_boolean()
                            })
                    })
            })
    })
}

fn validate_collection_transaction(payload: &Map<String, Value>) -> bool {
    if !payload["collectionId"].as_str().is_some_and(valid_id)
        || safe_u64(&payload["expectedPortfolioRevision"]).is_none()
    {
        return false;
    }
    let Some(operations) = payload["operations"]
        .as_array()
        .filter(|operations| !operations.is_empty() && operations.len() <= 100)
    else {
        return false;
    };
    let mut operation_ids = BTreeSet::new();
    let mut item_ids = BTreeSet::new();
    operations.iter().all(|operation| {
        let Some(kind) = operation.get("kind").and_then(Value::as_str) else {
            return false;
        };
        match kind {
            "put" => object_with_exact_keys(operation, &["operationId", "kind", "item"])
                .is_some_and(|operation| {
                    operation["operationId"]
                        .as_str()
                        .is_some_and(|id| valid_id(id) && operation_ids.insert(id.to_owned()))
                        && operation["item"]
                            .get("id")
                            .and_then(Value::as_str)
                            .is_some_and(|id| {
                                !id.trim().is_empty()
                                    && id.encode_utf16().count() <= 160
                                    && item_ids.insert(id.to_owned())
                            })
                        && validate_collection_item(&operation["item"])
                        && bounded_json(&operation["item"], PLUGIN_UI_LIMITS.snapshot_page_bytes)
                }),
            "delete" => object_with_exact_keys(
                operation,
                &["operationId", "kind", "itemId", "expectedUpdatedAt"],
            )
            .is_some_and(|operation| {
                operation["operationId"]
                    .as_str()
                    .is_some_and(|id| valid_id(id) && operation_ids.insert(id.to_owned()))
                    && operation["itemId"]
                        .as_str()
                        .is_some_and(|id| valid_id(id) && item_ids.insert(id.to_owned()))
                    && (operation["expectedUpdatedAt"].is_null()
                        || operation["expectedUpdatedAt"]
                            .as_str()
                            .is_some_and(valid_utc_timestamp))
            }),
            _ => false,
        }
    })
}
fn validate_collection_item(value: &Value) -> bool {
    let Some(item) = value.as_object() else {
        return false;
    };
    if item.len() < 4
        || item.len() > 5
        || item.keys().any(|key| {
            !["id", "createdAt", "updatedAt", "values", "details"].contains(&key.as_str())
        })
        || !item["id"]
            .as_str()
            .is_some_and(|id| !id.trim().is_empty() && id.encode_utf16().count() <= 160)
        || !item["createdAt"].as_str().is_some_and(valid_utc_timestamp)
        || !item["updatedAt"].as_str().is_some_and(valid_utc_timestamp)
        || !item["values"].as_object().is_some_and(|values| {
            values
                .values()
                .all(|value| value.is_string() || value.is_boolean())
        })
    {
        return false;
    }
    item.get("details").is_none_or(validate_record_details)
}
fn validate_record_details(value: &Value) -> bool {
    object_with_exact_keys(
        value,
        &["schemaVersion", "context", "description", "completedAt"],
    )
    .is_some_and(|details| {
        details["schemaVersion"] == 1
            && (details["context"].is_null()
                || object_with_exact_keys(
                    &details["context"],
                    &["reference", "labelSnapshot", "locationSnapshot"],
                )
                .is_some_and(|context| {
                    validate_reference(&context["reference"])
                        && matches!(
                            context["reference"].get("kind").and_then(Value::as_str),
                            Some("core.node" | "core.process")
                        )
                        && context["labelSnapshot"].as_str().is_some_and(|label| {
                            !label.trim().is_empty() && label.encode_utf16().count() <= 500
                        })
                        && context["locationSnapshot"]
                            .as_str()
                            .is_some_and(|location| location.encode_utf16().count() <= 2_000)
                }))
            && validate_record_rich_text(&details["description"])
            && (details["completedAt"].is_null()
                || details["completedAt"]
                    .as_str()
                    .is_some_and(valid_utc_timestamp))
    })
}
fn validate_record_rich_text(value: &Value) -> bool {
    fn visit(value: &Value) -> bool {
        let Some(node) = value.as_object() else {
            return false;
        };
        if node
            .keys()
            .any(|key| !["type", "text", "content", "marks"].contains(&key.as_str()))
        {
            return false;
        }
        let Some(kind) = node.get("type").and_then(Value::as_str) else {
            return false;
        };
        let marks_ok = node.get("marks").is_none_or(|marks| {
            marks.as_array().is_some_and(|marks| {
                marks.iter().all(|mark| {
                    object_with_exact_keys(mark, &["type"]).is_some_and(|mark| {
                        matches!(mark["type"].as_str(), Some("bold" | "italic" | "strike"))
                    })
                })
            })
        });
        if !marks_ok {
            return false;
        }
        if kind == "text" {
            return node.get("content").is_none()
                && node
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| !text.is_empty());
        }
        if node.get("text").is_some() {
            return false;
        }
        if kind == "hardBreak" {
            return node.get("content").is_none();
        }
        let Some(children) = node
            .get("content")
            .map_or(Some(&[][..]), |value| value.as_array().map(Vec::as_slice))
        else {
            return false;
        };
        if !children.iter().all(visit) {
            return false;
        }
        match kind {
            "paragraph" => children.iter().all(|child| {
                matches!(
                    child.get("type").and_then(Value::as_str),
                    Some("text" | "hardBreak")
                )
            }),
            "doc" => {
                !children.is_empty()
                    && children.iter().all(|child| {
                        matches!(
                            child.get("type").and_then(Value::as_str),
                            Some("paragraph" | "bulletList")
                        )
                    })
            }
            "bulletList" => {
                !children.is_empty()
                    && children
                        .iter()
                        .all(|child| child.get("type").and_then(Value::as_str) == Some("listItem"))
            }
            "listItem" => {
                !children.is_empty()
                    && children[0].get("type").and_then(Value::as_str) == Some("paragraph")
                    && children.iter().all(|child| {
                        matches!(
                            child.get("type").and_then(Value::as_str),
                            Some("paragraph" | "bulletList")
                        )
                    })
            }
            _ => false,
        }
    }
    bounded_json(value, PLUGIN_UI_LIMITS.event_bytes)
        && value.get("type").and_then(Value::as_str) == Some("doc")
        && visit(value)
}
fn validate_document_transaction(payload: &Map<String, Value>) -> bool {
    if payload.len() != 5
        || payload["schema"] != "axiom.plugin-storage-transaction"
        || payload["schemaVersion"] != 1
        || payload["scope"] != "portfolio"
        || safe_u64(&payload["expectedPortfolioRevision"]).is_none()
    {
        return false;
    }
    let Some(operations) = payload["operations"]
        .as_array()
        .filter(|operations| !operations.is_empty() && operations.len() <= 100)
    else {
        return false;
    };
    let mut operation_ids = BTreeSet::new();
    let mut keys = BTreeSet::new();
    operations.iter().all(|operation| {
        let Some(kind) = operation.get("kind").and_then(Value::as_str) else {
            return false;
        };
        let expected_keys = match kind {
            "put" => &[
                "operationId",
                "kind",
                "key",
                "expectedDocumentVersion",
                "value",
            ][..],
            "delete" => &["operationId", "kind", "key", "expectedDocumentVersion"][..],
            _ => return false,
        };
        object_with_exact_keys(operation, expected_keys).is_some()
            && operation["operationId"].as_str().is_some_and(|id| {
                !id.trim().is_empty()
                    && id.encode_utf16().count() <= 160
                    && operation_ids.insert(id.to_owned())
            })
            && operation["key"]
                .as_str()
                .is_some_and(|key| valid_storage_key(key) && keys.insert(key.to_owned()))
            && (operation["expectedDocumentVersion"].is_null()
                || safe_u64(&operation["expectedDocumentVersion"])
                    .is_some_and(|version| version > 0))
            && (kind != "put"
                || bounded_json(&operation["value"], PLUGIN_UI_LIMITS.snapshot_page_bytes))
    }) && bounded_json(&Value::Object(payload.clone()), 2 * 1024 * 1024)
}
fn validate_rich_text(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("doc")
        && bounded_json(value, PLUGIN_UI_LIMITS.event_bytes)
}

fn bounded_json(value: &Value, byte_limit: usize) -> bool {
    if !serialized_within(value, byte_limit) {
        return false;
    }
    let mut pending = vec![(value, 0_usize)];
    let mut nodes = 0;
    while let Some((value, depth)) = pending.pop() {
        nodes += 1;
        if nodes > 10_000 || depth > 16 {
            return false;
        }
        match value {
            Value::Array(values) => {
                if values.len() > 1_000 {
                    return false;
                }
                pending.extend(values.iter().map(|value| (value, depth + 1)));
            }
            Value::Object(values) => {
                if values.len() > 500
                    || values.keys().any(|key| {
                        key.is_empty()
                            || key.len() > 160
                            || matches!(key.as_str(), "__proto__" | "constructor" | "prototype")
                    })
                {
                    return false;
                }
                pending.extend(values.values().map(|value| (value, depth + 1)));
            }
            Value::String(value) if value.encode_utf16().count() > 100_000 => return false,
            _ => {}
        }
    }
    true
}

fn serialized_within(value: &Value, byte_limit: usize) -> bool {
    serde_json::to_vec(value).is_ok_and(|bytes| bytes.len() <= byte_limit)
}

fn reject_duplicate_json_keys(source: &[u8]) -> Result<(), PluginUiWireErrorCode> {
    fn skip(source: &[u8], offset: &mut usize) {
        while source.get(*offset).is_some_and(u8::is_ascii_whitespace) {
            *offset += 1;
        }
    }
    fn string(source: &[u8], offset: &mut usize) -> Result<String, PluginUiWireErrorCode> {
        let start = *offset;
        *offset += 1;
        while let Some(byte) = source.get(*offset) {
            if *byte == b'\\' {
                *offset += 2;
                continue;
            }
            *offset += 1;
            if *byte == b'"' {
                return serde_json::from_slice(&source[start..*offset])
                    .map_err(|_| PluginUiWireErrorCode::InvalidJson);
            }
        }
        Err(PluginUiWireErrorCode::InvalidJson)
    }
    fn value(source: &[u8], offset: &mut usize) -> Result<(), PluginUiWireErrorCode> {
        skip(source, offset);
        match source.get(*offset) {
            Some(b'{') => {
                *offset += 1;
                skip(source, offset);
                let mut keys = BTreeSet::new();
                if source.get(*offset) == Some(&b'}') {
                    *offset += 1;
                    return Ok(());
                }
                loop {
                    skip(source, offset);
                    if source.get(*offset) != Some(&b'"') {
                        return Err(PluginUiWireErrorCode::InvalidJson);
                    }
                    let key = string(source, offset)?;
                    if !keys.insert(key) {
                        return Err(PluginUiWireErrorCode::DuplicateJsonKey);
                    }
                    skip(source, offset);
                    if source.get(*offset) != Some(&b':') {
                        return Err(PluginUiWireErrorCode::InvalidJson);
                    }
                    *offset += 1;
                    value(source, offset)?;
                    skip(source, offset);
                    match source.get(*offset) {
                        Some(b'}') => {
                            *offset += 1;
                            return Ok(());
                        }
                        Some(b',') => *offset += 1,
                        _ => return Err(PluginUiWireErrorCode::InvalidJson),
                    }
                }
            }
            Some(b'[') => {
                *offset += 1;
                skip(source, offset);
                if source.get(*offset) == Some(&b']') {
                    *offset += 1;
                    return Ok(());
                }
                loop {
                    value(source, offset)?;
                    skip(source, offset);
                    match source.get(*offset) {
                        Some(b']') => {
                            *offset += 1;
                            return Ok(());
                        }
                        Some(b',') => *offset += 1,
                        _ => return Err(PluginUiWireErrorCode::InvalidJson),
                    }
                }
            }
            Some(b'"') => {
                string(source, offset)?;
                Ok(())
            }
            Some(_) => {
                let start = *offset;
                while source.get(*offset).is_some_and(|byte| {
                    !byte.is_ascii_whitespace() && !matches!(byte, b',' | b']' | b'}')
                }) {
                    *offset += 1;
                }
                if start == *offset {
                    Err(PluginUiWireErrorCode::InvalidJson)
                } else {
                    Ok(())
                }
            }
            None => Err(PluginUiWireErrorCode::InvalidJson),
        }
    }
    let mut offset = 0;
    value(source, &mut offset)?;
    skip(source, &mut offset);
    if offset == source.len() {
        Ok(())
    } else {
        Err(PluginUiWireErrorCode::InvalidJson)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_compute_policy::ISOLATED_COMPUTE_POLICY_V1;
    use serde_json::{json, Value};

    fn fixture() -> Value {
        serde_json::from_str(include_str!("../../fixtures/plugins/protocol/ui-v1.json")).unwrap()
    }

    fn wire_fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../fixtures/plugins/protocol/ui-wire-v1.json"
        ))
        .unwrap()
    }

    fn set_pointer(document: &mut Value, pointer: &str, value: Value) {
        let parts: Vec<String> = pointer
            .strip_prefix('/')
            .unwrap()
            .split('/')
            .map(|part| part.replace("~1", "/").replace("~0", "~"))
            .collect();
        let mut current = document;
        for part in &parts[..parts.len() - 1] {
            current = match current {
                Value::Object(object) => object.get_mut(part).unwrap(),
                Value::Array(array) => &mut array[part.parse::<usize>().unwrap()],
                _ => panic!("invalid fixture pointer"),
            };
        }
        match current {
            Value::Object(object) => {
                object.insert(parts.last().unwrap().clone(), value);
            }
            Value::Array(array) => array[parts.last().unwrap().parse::<usize>().unwrap()] = value,
            _ => panic!("invalid fixture pointer parent"),
        }
    }

    fn text_node(key: String) -> Value {
        json!({ "key": key, "type": "text", "text": "", "role": "body", "tone": "default" })
    }

    fn stack_node(key: String, children: Vec<Value>) -> Value {
        json!({ "key": key, "type": "stack", "direction": "vertical", "gap": "none", "wrap": false, "children": children })
    }

    #[test]
    fn ui_protocol_profile_matches_the_shared_contract() {
        let fixture = fixture();
        assert_eq!(fixture["minimumUiHostApi"], PLUGIN_UI_MINIMUM_HOST_API);
        assert_eq!(
            fixture["limits"],
            serde_json::to_value(PLUGIN_UI_LIMITS).unwrap()
        );
        assert_eq!(fixture["primitives"], json!(UI_PRIMITIVES));
        assert_eq!(fixture["effects"], json!(UI_EFFECTS));
        const {
            assert!(PLUGIN_UI_LIMITS.request_bytes < ISOLATED_COMPUTE_POLICY_V1.max_input_bytes);
            assert!(PLUGIN_UI_LIMITS.result_bytes < ISOLATED_COMPUTE_POLICY_V1.max_output_bytes);
            assert!(
                PLUGIN_UI_LIMITS.deadline_ms
                    < ISOLATED_COMPUTE_POLICY_V1.wall_time_per_entrypoint_ms
            );
        }
    }

    #[test]
    fn ui_protocol_requirements_match_shared_acceptance_and_rejection_cases() {
        let fixture = fixture();
        for case in fixture["cases"].as_array().unwrap() {
            let mut value = fixture["requirement"].clone();
            value
                .as_object_mut()
                .unwrap()
                .extend(case["patch"].as_object().unwrap().clone());
            let valid = serde_json::from_value::<PluginUiProtocolRequirement>(value)
                .is_ok_and(|requirement| requirement.validate().is_ok());
            assert_eq!(valid, case["valid"].as_bool().unwrap(), "{}", case["name"]);
        }
        let mut all = fixture["requirement"].clone();
        all["requiredPrimitives"] = fixture["primitives"].clone();
        all["requiredEffects"] = fixture["effects"].clone();
        assert!(serde_json::from_value::<PluginUiProtocolRequirement>(all)
            .unwrap()
            .validate()
            .is_ok());
    }

    #[test]
    fn ui_wire_contract_matches_shared_acceptance_and_rejection_cases() {
        let fixture = wire_fixture();
        for case in fixture["cases"].as_array().unwrap() {
            let document = case["document"].as_str().unwrap();
            let mut value = fixture[document].clone();
            if let Some(pointer) = case["pointer"]
                .as_str()
                .filter(|pointer| !pointer.is_empty())
            {
                set_pointer(&mut value, pointer, case["value"].clone());
            }
            let bytes = serde_json::to_vec(&value).unwrap();
            let valid = match document {
                "input" => validate_plugin_ui_input_json(&bytes).is_ok(),
                "result" => validate_plugin_ui_result_json(&bytes).is_ok(),
                _ => panic!("invalid fixture document"),
            };
            assert_eq!(valid, case["valid"].as_bool().unwrap(), "{}", case["name"]);
        }
    }

    #[test]
    fn ui_wire_accepts_every_shared_effect_payload() {
        let fixture = wire_fixture();
        for effect in fixture["effectSamples"].as_array().unwrap() {
            let mut result = fixture["result"].clone();
            result["effects"] = json!([effect]);
            assert!(
                validate_plugin_ui_result_json(&serde_json::to_vec(&result).unwrap()).is_ok(),
                "{}",
                effect["kind"]
            );
        }
    }

    #[test]
    fn collection_queries_match_shared_validation_cases() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../fixtures/plugins/protocol/collection-query-v1.json"
        ))
        .unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            let mut query = fixture["query"].clone();
            let pointer = case["pointer"].as_str().unwrap();
            if !pointer.is_empty() {
                set_pointer(&mut query, pointer, case["value"].clone());
            }
            assert_eq!(
                valid_collection_query(&query),
                case["valid"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
        }
    }

    #[test]
    fn ui_reduction_binds_correlation_and_declared_vocabulary() {
        let fixture = wire_fixture();
        let input = serde_json::to_vec(&fixture["input"]).unwrap();
        let result = serde_json::to_vec(&fixture["result"]).unwrap();
        let primitives = vec!["stack".to_owned(), "text".to_owned(), "button".to_owned()];
        let effects = vec!["notice.show".to_owned()];
        assert!(validate_plugin_ui_reduction_json(&input, &result, &primitives, &effects).is_ok());
        assert!(validate_plugin_ui_reduction_json(
            &input,
            &result,
            &["stack".to_owned()],
            &effects
        )
        .is_err());
        assert!(validate_plugin_ui_reduction_json(&input, &result, &primitives, &[]).is_err());
        let mut wrong = fixture["result"].clone();
        wrong["uiRevision"] = serde_json::json!(1);
        assert!(validate_plugin_ui_reduction_json(
            &input,
            &serde_json::to_vec(&wrong).unwrap(),
            &primitives,
            &effects
        )
        .is_err());
    }

    #[test]
    fn ui_wire_accepts_every_shared_ui_primitive() {
        let fixture = wire_fixture();
        for node in fixture["nodeSamples"].as_array().unwrap() {
            let mut result = fixture["result"].clone();
            result["tree"] = stack_node("sample-root".into(), vec![node.clone()]);
            assert!(
                validate_plugin_ui_result_json(&serde_json::to_vec(&result).unwrap()).is_ok(),
                "{}",
                node["type"]
            );
        }
    }

    #[test]
    fn ui_wire_rejects_shared_raw_json_failures_before_deserialization() {
        let fixture = wire_fixture();
        for case in fixture["rawCases"].as_array().unwrap() {
            let bytes = case["json"].as_str().unwrap().as_bytes();
            let error = match case["document"].as_str().unwrap() {
                "input" => validate_plugin_ui_input_json(bytes).unwrap_err(),
                "result" => validate_plugin_ui_result_json(bytes).unwrap_err(),
                _ => panic!("invalid fixture document"),
            };
            let expected = match case["code"].as_str().unwrap() {
                "DUPLICATE_JSON_KEY" => PluginUiWireErrorCode::DuplicateJsonKey,
                "INVALID_JSON" => PluginUiWireErrorCode::InvalidJson,
                _ => panic!("invalid fixture error"),
            };
            assert_eq!(error, expected, "{}", case["name"]);
        }
    }

    #[test]
    fn ui_wire_enforces_utf8_component_and_envelope_boundaries() {
        let fixture = wire_fixture();
        let mut result = fixture["result"].clone();
        result["state"] = json!({ "value": "å".repeat(PLUGIN_UI_LIMITS.state_bytes / 2 + 1) });
        assert_eq!(
            validate_plugin_ui_result_json(&serde_json::to_vec(&result).unwrap()),
            Err(PluginUiWireErrorCode::InvalidResult)
        );
        assert_eq!(
            validate_plugin_ui_input_json(&vec![b' '; PLUGIN_UI_LIMITS.request_bytes + 1]),
            Err(PluginUiWireErrorCode::RequestTooLarge)
        );
        assert_eq!(
            validate_plugin_ui_result_json(&vec![b' '; PLUGIN_UI_LIMITS.result_bytes + 1]),
            Err(PluginUiWireErrorCode::ResultTooLarge)
        );
        let mut input = serde_json::to_vec(&fixture["input"]).unwrap();
        input.resize(PLUGIN_UI_LIMITS.request_bytes, b' ');
        assert!(validate_plugin_ui_input_json(&input).is_ok());
        let mut output = serde_json::to_vec(&fixture["result"]).unwrap();
        output.resize(PLUGIN_UI_LIMITS.result_bytes, b' ');
        assert!(validate_plugin_ui_result_json(&output).is_ok());
    }

    #[test]
    fn ui_wire_enforces_exact_tree_limits() {
        let fixture = wire_fixture();
        let nested = |depth: usize| {
            let mut tree = text_node("leaf".into());
            for level in 1..depth {
                tree = stack_node(format!("depth:{level}"), vec![tree]);
            }
            tree
        };
        let validate_tree = |tree: Value| {
            let mut result = fixture["result"].clone();
            result["tree"] = tree;
            validate_plugin_ui_result_json(&serde_json::to_vec(&result).unwrap()).is_ok()
        };
        assert!(validate_tree(nested(PLUGIN_UI_LIMITS.tree_depth)));
        assert!(!validate_tree(nested(PLUGIN_UI_LIMITS.tree_depth + 1)));

        let leaves = |prefix: &str, count: usize| {
            (0..count)
                .map(|index| text_node(format!("{prefix}:{index}")))
                .collect::<Vec<_>>()
        };
        assert!(validate_tree(stack_node(
            "root".into(),
            leaves("child", PLUGIN_UI_LIMITS.children_per_node),
        )));
        assert!(!validate_tree(stack_node(
            "root".into(),
            leaves("child", PLUGIN_UI_LIMITS.children_per_node + 1),
        )));

        let mut branches = (0..10)
            .map(|index| {
                let count = if index == 9 { 89 } else { 100 };
                stack_node(
                    format!("branch:{index}"),
                    leaves(&format!("branch:{index}:leaf"), count),
                )
            })
            .collect::<Vec<_>>();
        assert!(validate_tree(stack_node("root".into(), branches.clone())));
        branches[9]
            .get_mut("children")
            .unwrap()
            .as_array_mut()
            .unwrap()
            .push(text_node("node:1001".into()));
        assert!(!validate_tree(stack_node("root".into(), branches)));
    }
}
