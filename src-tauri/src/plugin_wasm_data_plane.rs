//! Bounded Core-to-guest request and guest-to-Core result contracts.
//!
//! The guest receives only copied snapshots and JSON parameters. A returned
//! proposal is a draft: trusted Core supplies identity, time, base revision,
//! review, and application after this native boundary validates correlation and
//! capability state.

use std::collections::{BTreeSet, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{
    plugin_compute_policy::ISOLATED_COMPUTE_POLICY_V1,
    plugin_wasm_session::validate_stable_contract_id,
};

pub const NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA: &str = "axiom.wasm-compute-request";
pub const NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA_VERSION: u32 = 1;
pub const NEMOTO_WASM_COMPUTE_RESULT_SCHEMA: &str = "axiom.wasm-compute-result";
pub const NEMOTO_WASM_COMPUTE_RESULT_SCHEMA_VERSION: u32 = 1;
pub const NEMOTO_WASM_PROPOSAL_DRAFT_SCHEMA: &str = "axiom.wasm-proposal-draft";
pub const NEMOTO_WASM_PROPOSAL_DRAFT_SCHEMA_VERSION: u32 = 1;
pub const NEMOTO_PLUGIN_ENTITY_SNAPSHOT_SCHEMA: &str = "axiom.plugin.entity-snapshot";
pub const NEMOTO_PLUGIN_ENTITY_SNAPSHOT_SCHEMA_VERSION: u32 = 1;
pub const NEMOTO_ENTITY_REFERENCE_SCHEMA: &str = "axiom.entity-reference";
pub const NEMOTO_ENTITY_REFERENCE_SCHEMA_VERSION: u32 = 1;
pub const PORTFOLIO_READ_SCOPED_CAPABILITY: &str = "portfolio.read-scoped";
pub const PROPOSAL_CREATE_CAPABILITY: &str = "proposal.create";
pub const MAX_WASM_COMPUTE_REQUEST_BYTES: usize = 240 * 1024;
pub const MAX_WASM_COMPUTE_SNAPSHOTS: usize = 32;
pub const MAX_WASM_ENTITY_SNAPSHOT_BYTES: usize = 64 * 1024;
pub const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;

const MAX_JSON_DEPTH: usize = 16;
const MAX_JSON_NODES: usize = 10_000;
const MAX_JSON_ARRAY_ITEMS: usize = 1_000;
const MAX_JSON_OBJECT_FIELDS: usize = 500;
const MAX_JSON_KEY_BYTES: usize = 160;
const MAX_JSON_STRING_CHARS: usize = 100_000;

const CORE_ENTITY_KINDS: &[&str] = &[
    "core.process",
    "core.process-folder",
    "core.node",
    "core.edge",
    "core.swimlane",
    "core.asset",
    "core.asset-category",
    "core.journal-entry",
    "core.journal-notebook",
    "core.journal-folder",
    "core.tag",
    "core.incident",
    "core.finding",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WasmDataPlaneGrants {
    pub portfolio_read_scoped: bool,
    pub proposal_create: bool,
}

impl WasmDataPlaneGrants {
    pub fn from_capabilities(capabilities: &BTreeSet<String>) -> Self {
        Self {
            portfolio_read_scoped: capabilities.contains(PORTFOLIO_READ_SCOPED_CAPABILITY),
            proposal_create: capabilities.contains(PROPOSAL_CREATE_CAPABILITY),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WasmEntityLocation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub graph_path: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub incident_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WasmEntityReference {
    pub schema: String,
    pub schema_version: u32,
    pub kind: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<WasmEntityLocation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WasmEntitySnapshot {
    pub schema: String,
    pub schema_version: u32,
    pub portfolio_revision: u64,
    pub reference: WasmEntityReference,
    pub label: String,
    pub fields: Map<String, Value>,
    pub omitted_fields: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WasmComputeRequest {
    pub schema: String,
    pub schema_version: u32,
    pub request_id: String,
    pub base_revision: String,
    pub portfolio_revision: u64,
    pub snapshots: Vec<WasmEntitySnapshot>,
    pub parameters: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WasmProposalDraft {
    pub schema: String,
    pub schema_version: u32,
    pub proposal_schema_version: u32,
    pub id: String,
    pub origin: Value,
    pub title: String,
    pub summary: String,
    pub rationale: String,
    pub affected_entities: Vec<WasmEntityReference>,
    #[serde(default)]
    pub sources: Vec<Value>,
    pub operations: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WasmComputeResult {
    pub schema: String,
    pub schema_version: u32,
    pub request_id: String,
    pub base_revision: String,
    pub output: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_draft: Option<WasmProposalDraft>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WasmDataPlaneErrorCode {
    InvalidRequest,
    CapabilityDenied,
    InvalidResult,
    CorrelationMismatch,
    ProposalDenied,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmDataPlaneError {
    pub code: WasmDataPlaneErrorCode,
    pub message: &'static str,
}

impl std::fmt::Display for WasmDataPlaneError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for WasmDataPlaneError {}

pub fn validate_compute_request(
    request: &WasmComputeRequest,
    grants: WasmDataPlaneGrants,
) -> Result<(), WasmDataPlaneError> {
    if request.schema != NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA
        || request.schema_version != NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA_VERSION
        || request.portfolio_revision > MAX_SAFE_JSON_INTEGER
        || validate_stable_contract_id(&request.request_id).is_err()
        || validate_stable_contract_id(&request.base_revision).is_err()
        || request.snapshots.len() > MAX_WASM_COMPUTE_SNAPSHOTS
        || !validate_bounded_json(&request.parameters)
        || encoded_len(request).is_none_or(|length| length > MAX_WASM_COMPUTE_REQUEST_BYTES)
    {
        return Err(invalid_request());
    }
    if !request.snapshots.is_empty() && !grants.portfolio_read_scoped {
        return Err(WasmDataPlaneError {
            code: WasmDataPlaneErrorCode::CapabilityDenied,
            message: "Executable compute snapshots require the scoped portfolio-read grant.",
        });
    }

    let mut references = HashSet::new();
    for snapshot in &request.snapshots {
        if snapshot.portfolio_revision != request.portfolio_revision || !validate_snapshot(snapshot)
        {
            return Err(invalid_request());
        }
        let reference =
            serde_json::to_string(&snapshot.reference).map_err(|_| invalid_request())?;
        if !references.insert(reference) {
            return Err(invalid_request());
        }
    }
    Ok(())
}

pub fn validate_compute_result(
    value: Value,
    request: &WasmComputeRequest,
    grants: WasmDataPlaneGrants,
) -> Result<WasmComputeResult, WasmDataPlaneError> {
    let result: WasmComputeResult = serde_json::from_value(value).map_err(|_| invalid_result())?;
    if result.schema != NEMOTO_WASM_COMPUTE_RESULT_SCHEMA
        || result.schema_version != NEMOTO_WASM_COMPUTE_RESULT_SCHEMA_VERSION
        || validate_stable_contract_id(&result.request_id).is_err()
        || validate_stable_contract_id(&result.base_revision).is_err()
        || !validate_bounded_json(&result.output)
        || encoded_len(&result)
            .is_none_or(|length| length > ISOLATED_COMPUTE_POLICY_V1.max_output_bytes)
    {
        return Err(invalid_result());
    }
    if result.request_id != request.request_id || result.base_revision != request.base_revision {
        return Err(WasmDataPlaneError {
            code: WasmDataPlaneErrorCode::CorrelationMismatch,
            message: "The executable compute result does not match the Core-authored request.",
        });
    }
    if let Some(draft) = &result.proposal_draft {
        if !grants.proposal_create {
            return Err(WasmDataPlaneError {
                code: WasmDataPlaneErrorCode::ProposalDenied,
                message: "The executable plugin returned a proposal without proposal.create.",
            });
        }
        validate_proposal_draft(draft, request)?;
    }
    Ok(result)
}

fn validate_snapshot(snapshot: &WasmEntitySnapshot) -> bool {
    snapshot.schema == NEMOTO_PLUGIN_ENTITY_SNAPSHOT_SCHEMA
        && snapshot.schema_version == NEMOTO_PLUGIN_ENTITY_SNAPSHOT_SCHEMA_VERSION
        && snapshot.portfolio_revision <= MAX_SAFE_JSON_INTEGER
        && validate_entity_reference(&snapshot.reference)
        && bounded_trimmed(&snapshot.label, 500)
        && snapshot.omitted_fields.len() <= 100
        && snapshot
            .omitted_fields
            .iter()
            .all(|field| bounded_trimmed(field, 160))
        && validate_bounded_json(&Value::Object(snapshot.fields.clone()))
        && encoded_len(snapshot).is_some_and(|length| length <= MAX_WASM_ENTITY_SNAPSHOT_BYTES)
}

fn validate_entity_reference(reference: &WasmEntityReference) -> bool {
    if reference.schema != NEMOTO_ENTITY_REFERENCE_SCHEMA
        || reference.schema_version != NEMOTO_ENTITY_REFERENCE_SCHEMA_VERSION
        || !validate_entity_kind(&reference.kind)
        || validate_stable_contract_id(&reference.id).is_err()
    {
        return false;
    }
    let Some(location) = &reference.location else {
        return !matches!(
            reference.kind.as_str(),
            "core.node" | "core.edge" | "core.swimlane" | "core.finding"
        );
    };
    if location
        .process_id
        .as_deref()
        .is_some_and(|value| validate_stable_contract_id(value).is_err())
        || location
            .incident_id
            .as_deref()
            .is_some_and(|value| validate_stable_contract_id(value).is_err())
        || location.graph_path.len() > 64
        || location
            .graph_path
            .iter()
            .any(|value| validate_stable_contract_id(value).is_err())
        || (!location.graph_path.is_empty() && location.process_id.is_none())
    {
        return false;
    }
    if matches!(
        reference.kind.as_str(),
        "core.node" | "core.edge" | "core.swimlane"
    ) && location.process_id.is_none()
    {
        return false;
    }
    reference.kind != "core.finding" || location.incident_id.is_some()
}

fn validate_entity_kind(kind: &str) -> bool {
    CORE_ENTITY_KINDS.contains(&kind) || validate_plugin_owned_type(kind)
}

fn validate_plugin_owned_type(value: &str) -> bool {
    if !(5..=240).contains(&value.len()) {
        return false;
    }
    let Some((plugin_id, local_type)) = value.split_once('/') else {
        return false;
    };
    validate_plugin_id(plugin_id)
        && !local_type.is_empty()
        && local_type
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && local_type
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        && local_type.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
}

fn validate_plugin_id(value: &str) -> bool {
    (3..=160).contains(&value.len())
        && value.contains('.')
        && value.split('.').all(|segment| {
            !segment.is_empty()
                && segment
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && segment
                    .as_bytes()
                    .last()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

fn validate_proposal_draft(
    draft: &WasmProposalDraft,
    request: &WasmComputeRequest,
) -> Result<(), WasmDataPlaneError> {
    if draft.schema != NEMOTO_WASM_PROPOSAL_DRAFT_SCHEMA
        || draft.schema_version != NEMOTO_WASM_PROPOSAL_DRAFT_SCHEMA_VERSION
        || !(1..=3).contains(&draft.proposal_schema_version)
        || validate_stable_contract_id(&draft.id).is_err()
        || !bounded_trimmed(&draft.title, 200)
        || !bounded_trimmed(&draft.summary, 2_000)
        || !bounded_trimmed(&draft.rationale, 4_000)
        || draft.affected_entities.is_empty()
        || draft.affected_entities.len() > 500
        || draft.sources.len() > 200
        || draft.operations.is_empty()
        || draft.operations.len() > 500
        || !validate_bounded_json(&draft.origin)
        || draft
            .sources
            .iter()
            .any(|value| !validate_bounded_json(value))
        || draft
            .operations
            .iter()
            .any(|value| !validate_bounded_json(value))
    {
        return Err(invalid_result());
    }

    let supplied = request
        .snapshots
        .iter()
        .map(|snapshot| serde_json::to_string(&snapshot.reference))
        .collect::<Result<BTreeSet<_>, _>>()
        .map_err(|_| invalid_result())?;
    let mut affected = BTreeSet::new();
    for reference in &draft.affected_entities {
        if !validate_entity_reference(reference) {
            return Err(invalid_result());
        }
        let encoded = serde_json::to_string(reference).map_err(|_| invalid_result())?;
        if !supplied.contains(&encoded) || !affected.insert(encoded) {
            return Err(invalid_result());
        }
    }
    Ok(())
}

fn validate_bounded_json(value: &Value) -> bool {
    fn visit(value: &Value, depth: usize, nodes: &mut usize) -> bool {
        *nodes += 1;
        if *nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH {
            return false;
        }
        match value {
            Value::Null | Value::Bool(_) | Value::Number(_) => true,
            Value::String(value) => value.chars().count() <= MAX_JSON_STRING_CHARS,
            Value::Array(values) => {
                values.len() <= MAX_JSON_ARRAY_ITEMS
                    && values.iter().all(|value| visit(value, depth + 1, nodes))
            }
            Value::Object(values) => {
                values.len() <= MAX_JSON_OBJECT_FIELDS
                    && values.iter().all(|(key, value)| {
                        !key.is_empty()
                            && key.len() <= MAX_JSON_KEY_BYTES
                            && !matches!(key.as_str(), "__proto__" | "constructor" | "prototype")
                            && visit(value, depth + 1, nodes)
                    })
            }
        }
    }
    let mut nodes = 0;
    visit(value, 0, &mut nodes)
}

fn bounded_trimmed(value: &str, max_chars: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max_chars
}

fn encoded_len<T: Serialize>(value: &T) -> Option<usize> {
    serde_json::to_vec(value).ok().map(|encoded| encoded.len())
}

fn invalid_request() -> WasmDataPlaneError {
    WasmDataPlaneError {
        code: WasmDataPlaneErrorCode::InvalidRequest,
        message: "The Core-authored executable compute request is invalid.",
    }
}

fn invalid_result() -> WasmDataPlaneError {
    WasmDataPlaneError {
        code: WasmDataPlaneErrorCode::InvalidResult,
        message: "The executable plugin returned an invalid compute result.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference(id: &str) -> WasmEntityReference {
        WasmEntityReference {
            schema: NEMOTO_ENTITY_REFERENCE_SCHEMA.to_owned(),
            schema_version: NEMOTO_ENTITY_REFERENCE_SCHEMA_VERSION,
            kind: "core.asset-category".to_owned(),
            id: id.to_owned(),
            location: None,
        }
    }

    fn request() -> WasmComputeRequest {
        WasmComputeRequest {
            schema: NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA.to_owned(),
            schema_version: NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA_VERSION,
            request_id: "compute:risk:1".to_owned(),
            base_revision: "portfolio-revision-aabbccdd".to_owned(),
            portfolio_revision: 7,
            snapshots: vec![WasmEntitySnapshot {
                schema: NEMOTO_PLUGIN_ENTITY_SNAPSHOT_SCHEMA.to_owned(),
                schema_version: NEMOTO_PLUGIN_ENTITY_SNAPSHOT_SCHEMA_VERSION,
                portfolio_revision: 7,
                reference: reference("risk-register"),
                label: "Risk register".to_owned(),
                fields: Map::from_iter([(
                    "description".to_owned(),
                    Value::String("Reviewed".to_owned()),
                )]),
                omitted_fields: vec!["internalNotes".to_owned()],
            }],
            parameters: serde_json::json!({ "threshold": 3 }),
        }
    }

    #[test]
    fn validates_revision_bound_snapshots_and_read_grants() {
        let request = request();
        assert_eq!(
            validate_compute_request(
                &request,
                WasmDataPlaneGrants {
                    portfolio_read_scoped: false,
                    proposal_create: false,
                },
            )
            .unwrap_err()
            .code,
            WasmDataPlaneErrorCode::CapabilityDenied
        );
        validate_compute_request(
            &request,
            WasmDataPlaneGrants {
                portfolio_read_scoped: true,
                proposal_create: false,
            },
        )
        .unwrap();

        let mut stale = request.clone();
        stale.snapshots[0].portfolio_revision = 8;
        assert_eq!(
            validate_compute_request(
                &stale,
                WasmDataPlaneGrants {
                    portfolio_read_scoped: true,
                    proposal_create: false,
                },
            )
            .unwrap_err()
            .code,
            WasmDataPlaneErrorCode::InvalidRequest
        );
    }

    #[test]
    fn binds_result_correlation_and_denies_ungranted_or_hidden_proposals() {
        let request = request();
        let base = serde_json::json!({
            "schema": NEMOTO_WASM_COMPUTE_RESULT_SCHEMA,
            "schemaVersion": NEMOTO_WASM_COMPUTE_RESULT_SCHEMA_VERSION,
            "requestId": request.request_id,
            "baseRevision": request.base_revision,
            "output": { "riskCount": 1 }
        });
        let mut mismatched = base.clone();
        mismatched["requestId"] = Value::String("compute:other:1".to_owned());
        assert_eq!(
            validate_compute_result(
                mismatched,
                &request,
                WasmDataPlaneGrants {
                    portfolio_read_scoped: true,
                    proposal_create: false,
                },
            )
            .unwrap_err()
            .code,
            WasmDataPlaneErrorCode::CorrelationMismatch
        );

        let with_proposal = serde_json::json!({
            "schema": NEMOTO_WASM_COMPUTE_RESULT_SCHEMA,
            "schemaVersion": NEMOTO_WASM_COMPUTE_RESULT_SCHEMA_VERSION,
            "requestId": request.request_id,
            "baseRevision": request.base_revision,
            "output": null,
            "proposalDraft": {
                "schema": NEMOTO_WASM_PROPOSAL_DRAFT_SCHEMA,
                "schemaVersion": NEMOTO_WASM_PROPOSAL_DRAFT_SCHEMA_VERSION,
                "proposalSchemaVersion": 1,
                "id": "proposal:risk:1",
                "origin": { "kind": "plugin" },
                "title": "Review risk",
                "summary": "One risk needs review.",
                "rationale": "Bounded analysis result.",
                "affectedEntities": [reference("risk-register")],
                "sources": [],
                "operations": [{ "operationId": "operation:risk:1" }]
            }
        });
        assert_eq!(
            validate_compute_result(
                with_proposal.clone(),
                &request,
                WasmDataPlaneGrants {
                    portfolio_read_scoped: true,
                    proposal_create: false,
                },
            )
            .unwrap_err()
            .code,
            WasmDataPlaneErrorCode::ProposalDenied
        );
        assert!(validate_compute_result(
            with_proposal,
            &request,
            WasmDataPlaneGrants {
                portfolio_read_scoped: true,
                proposal_create: true,
            },
        )
        .is_ok());

        let hidden = serde_json::json!({
            "schema": NEMOTO_WASM_COMPUTE_RESULT_SCHEMA,
            "schemaVersion": NEMOTO_WASM_COMPUTE_RESULT_SCHEMA_VERSION,
            "requestId": request.request_id,
            "baseRevision": request.base_revision,
            "output": null,
            "proposalDraft": {
                "schema": NEMOTO_WASM_PROPOSAL_DRAFT_SCHEMA,
                "schemaVersion": NEMOTO_WASM_PROPOSAL_DRAFT_SCHEMA_VERSION,
                "proposalSchemaVersion": 1,
                "id": "proposal:hidden:1",
                "origin": { "kind": "plugin" },
                "title": "Hidden",
                "summary": "Hidden entity attempt.",
                "rationale": "Adversarial fixture.",
                "affectedEntities": [reference("hidden")],
                "sources": [],
                "operations": [{ "operationId": "operation:hidden:1" }]
            }
        });
        assert_eq!(
            validate_compute_result(
                hidden,
                &request,
                WasmDataPlaneGrants {
                    portfolio_read_scoped: true,
                    proposal_create: true,
                },
            )
            .unwrap_err()
            .code,
            WasmDataPlaneErrorCode::InvalidResult
        );
    }
}
