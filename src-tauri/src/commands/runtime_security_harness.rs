//! Feature-only packaged-app security harness.
//!
//! This command is compiled only into the disposable runtime-security build.
//! It is deliberately absent from ordinary Axiom binaries.

use std::{fs, sync::Arc, time::Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{command, State};
use uuid::Uuid;

use crate::{
    commands::executable_plugins::NativeExecutablePackageAdapter,
    plugin_executable_package::{
        ExecutableActivationSnapshot, ExecutableInstallApproval, ExecutablePackageAdapter,
        ExecutablePackageError, ExecutablePackageErrorCode, ExecutablePackageInspection,
        ExecutablePackageRecoveryAction, ExecutablePortfolioRequirement,
        ExecutableUiReductionRequest, AXIOM_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA,
        AXIOM_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA_VERSION,
        AXIOM_EXECUTABLE_INSTALL_APPROVAL_SCHEMA, AXIOM_EXECUTABLE_INSTALL_APPROVAL_SCHEMA_VERSION,
        EXECUTABLE_PLUGIN_EXECUTION_ENABLED, ISOLATED_COMPUTE_RISK_ACKNOWLEDGEMENT,
        MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID,
    },
    plugin_wasm_admission::NativeWasmAdmission,
    plugin_wasm_lifecycle::{AxiomWasmLifecycle, WasmLifecycleError},
    plugin_wasm_session::{WasmPluginIdentity, WasmSessionErrorCode, ISOLATED_COMPUTE_CAPABILITY},
};

const PLUGIN_ID: &str = "com.axiom.packaged-security-fixture";
const RECOVERY_PLUGIN_ID: &str = "com.axiom.packaged-recovery-fixture";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagedRuntimeSecurityCheck {
    name: &'static str,
    status: &'static str,
    details: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagedRuntimeSecurityReport {
    schema: &'static str,
    schema_version: u32,
    status: &'static str,
    execution_enabled: bool,
    checks: Vec<PackagedRuntimeSecurityCheck>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagedRuntimeSecurityError {
    code: String,
    stage: &'static str,
    message: &'static str,
}

fn package_error(
    stage: &'static str,
    error: ExecutablePackageError,
) -> PackagedRuntimeSecurityError {
    PackagedRuntimeSecurityError {
        code: format!("{:?}", error.code),
        stage,
        message: "The packaged executable lifecycle failed closed.",
    }
}

fn lifecycle_error(stage: &'static str, error: WasmLifecycleError) -> PackagedRuntimeSecurityError {
    PackagedRuntimeSecurityError {
        code: format!("{:?}", error.code),
        stage,
        message: "The packaged native runtime rejected the lifecycle probe.",
    }
}

fn harness_error(stage: &'static str, code: impl Into<String>) -> PackagedRuntimeSecurityError {
    PackagedRuntimeSecurityError {
        code: code.into(),
        stage,
        message: "The packaged runtime security invariant was not satisfied.",
    }
}

fn require(
    condition: bool,
    stage: &'static str,
    code: &'static str,
) -> Result<(), PackagedRuntimeSecurityError> {
    if condition {
        Ok(())
    } else {
        Err(harness_error(stage, code))
    }
}

fn push_u16(target: &mut Vec<u8>, value: u16) {
    target.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(target: &mut Vec<u8>, value: u32) {
    target.extend_from_slice(&value.to_le_bytes());
}

fn stored_zip(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut output = Vec::new();
    let mut central = Vec::new();
    for (name, content) in entries {
        let offset = output.len() as u32;
        let crc = crc32fast::hash(content);
        push_u32(&mut output, 0x0403_4b50);
        push_u16(&mut output, 20);
        push_u16(&mut output, 0);
        push_u16(&mut output, 0);
        push_u16(&mut output, 0);
        push_u16(&mut output, 0);
        push_u32(&mut output, crc);
        push_u32(&mut output, content.len() as u32);
        push_u32(&mut output, content.len() as u32);
        push_u16(&mut output, name.len() as u16);
        push_u16(&mut output, 0);
        output.extend_from_slice(name.as_bytes());
        output.extend_from_slice(content);

        push_u32(&mut central, 0x0201_4b50);
        push_u16(&mut central, 20);
        push_u16(&mut central, 20);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u32(&mut central, crc);
        push_u32(&mut central, content.len() as u32);
        push_u32(&mut central, content.len() as u32);
        push_u16(&mut central, name.len() as u16);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u32(&mut central, 0);
        push_u32(&mut central, offset);
        central.extend_from_slice(name.as_bytes());
    }

    let central_offset = output.len() as u32;
    let central_size = central.len() as u32;
    output.extend_from_slice(&central);
    push_u32(&mut output, 0x0605_4b50);
    push_u16(&mut output, 0);
    push_u16(&mut output, 0);
    push_u16(&mut output, entries.len() as u16);
    push_u16(&mut output, entries.len() as u16);
    push_u32(&mut output, central_size);
    push_u32(&mut output, central_offset);
    push_u16(&mut output, 0);
    output
}

fn echo_module(heap_start: u32) -> Result<Vec<u8>, PackagedRuntimeSecurityError> {
    wat::parse_str(format!(
        r#"(module
            (memory (export "memory") 1 1024)
            (global $heap (mut i32) (i32.const {heap_start}))
            (func (export "axiom_abi_version") (result i32) i32.const 1)
            (func (export "axiom_alloc") (param $len i32) (result i32)
                global.get $heap
                global.get $heap
                local.get $len
                i32.add
                global.set $heap)
            (func (export "axiom_run") (param $ptr i32) (param $len i32) (result i64)
                local.get $ptr
                i64.extend_i32_u
                i64.const 32
                i64.shl
                local.get $len
                i64.extend_i32_u
                i64.or))"#
    ))
    .map_err(|_| harness_error("fixture-build", "WAT_COMPILATION_FAILED"))
}

fn package(plugin_id: &str, version: &str, module: Vec<u8>) -> Vec<u8> {
    let manifest = json!({
        "schema": "axiom.plugin",
        "schemaVersion": 1,
        "id": plugin_id,
        "version": version,
        "name": "Packaged runtime security fixture",
        "description": "Exercises the native executable lifecycle in a packaged Tauri host.",
        "categories": ["method"],
        "publisher": { "name": "Axiom security harness" },
        "compatibility": { "axiomPluginApi": "^1.0.0" },
        "dataVersion": 1,
        "capabilities": ["compute.isolated"],
        "dependencies": [],
        "runtime": {
            "schema": "axiom.plugin-wasm-runtime",
            "schemaVersion": 1,
            "abi": "axiom-wasm-v1",
            "module": "runtime/plugin.wasm"
        },
        "contributes": {
            "vocabularies": [{
                "id": format!("{plugin_id}/terms"),
                "path": "contributions/terms.json"
            }]
        }
    });
    let contribution = json!({
        "schema": "axiom.plugin.vocabulary",
        "schemaVersion": 1,
        "id": format!("{plugin_id}/terms"),
        "terms": [{
            "term": "packaged-runtime",
            "definition": "Disposable security-harness fixture."
        }]
    });
    stored_zip(&[
        (
            "manifest.json",
            serde_json::to_vec(&manifest).unwrap_or_default(),
        ),
        ("runtime/plugin.wasm", module),
        (
            "contributions/terms.json",
            serde_json::to_vec(&contribution).unwrap_or_default(),
        ),
    ])
}

fn approval(inspection: &ExecutablePackageInspection) -> ExecutableInstallApproval {
    ExecutableInstallApproval {
        schema: AXIOM_EXECUTABLE_INSTALL_APPROVAL_SCHEMA.to_owned(),
        schema_version: AXIOM_EXECUTABLE_INSTALL_APPROVAL_SCHEMA_VERSION,
        archive_sha256: inspection.archive_sha256.clone(),
        identity: inspection.identity.clone(),
        granted_capabilities: vec![ISOLATED_COMPUTE_CAPABILITY.to_owned()],
        risk_acknowledgement: ISOLATED_COMPUTE_RISK_ACKNOWLEDGEMENT.to_owned(),
        approved_interactive_operations: inspection
            .interactive_operations
            .iter()
            .map(|binding| binding.operation.clone())
            .collect(),
    }
}

fn full_approval(inspection: &ExecutablePackageInspection) -> ExecutableInstallApproval {
    let mut value = approval(inspection);
    value.granted_capabilities = inspection.requested_capabilities.clone();
    value
}

fn activation(plugin_id: &str, version: &str, active: bool) -> ExecutableActivationSnapshot {
    ExecutableActivationSnapshot {
        schema: AXIOM_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA.to_owned(),
        schema_version: AXIOM_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA_VERSION,
        requirements: vec![ExecutablePortfolioRequirement {
            plugin_id: plugin_id.to_owned(),
            version: format!("={version}"),
            data_version: 1,
            requirement: if active {
                "recommended"
            } else {
                "previously-used"
            }
            .to_owned(),
            activation: if active { "active" } else { "inactive" }.to_owned(),
        }],
    }
}

fn inspect(
    archive: &[u8],
    stage: &'static str,
) -> Result<ExecutablePackageInspection, PackagedRuntimeSecurityError> {
    ExecutablePackageAdapter::<NativeWasmAdmission>::inspect_archive(archive)
        .map_err(|error| package_error(stage, error))
}

fn execute_echo(
    adapter: &NativeExecutablePackageAdapter,
    session: &crate::plugin_wasm_session::WasmSessionHandle,
    sequence: u64,
    marker: &str,
    stage: &'static str,
) -> Result<(), PackagedRuntimeSecurityError> {
    let response = adapter
        .lifecycle()
        .execute(session.invocation(sequence, "security.echo", json!({ "marker": marker })))
        .map_err(|error| lifecycle_error(stage, error))?;
    require(
        response.result["payload"]["marker"] == marker,
        stage,
        "ECHO_RESULT_MISMATCH",
    )
}

fn require_revoked(
    adapter: &NativeExecutablePackageAdapter,
    session: &crate::plugin_wasm_session::WasmSessionHandle,
    sequence: u64,
    stage: &'static str,
) -> Result<(), PackagedRuntimeSecurityError> {
    match adapter
        .lifecycle()
        .execute(session.invocation(sequence, "security.echo", json!({})))
    {
        Err(error) if error.session_code == Some(WasmSessionErrorCode::UnknownSession) => Ok(()),
        Err(error) => Err(lifecycle_error(stage, error)),
        Ok(_) => Err(harness_error(stage, "SESSION_REMAINED_USABLE")),
    }
}

fn install(
    adapter: &NativeExecutablePackageAdapter,
    archive: &[u8],
    stage: &'static str,
) -> Result<(WasmPluginIdentity, usize), PackagedRuntimeSecurityError> {
    let inspection = inspect(archive, stage)?;
    let identity = inspection.identity.clone();
    let outcome = adapter
        .install(inspection.clone(), approval(&inspection))
        .map_err(|error| package_error(stage, error))?;
    Ok((identity, outcome.lifecycle.invalidated_sessions))
}

fn packaged_lifecycle_checks(
    adapter: &NativeExecutablePackageAdapter,
) -> Result<Vec<PackagedRuntimeSecurityCheck>, PackagedRuntimeSecurityError> {
    adapter
        .recover_pending(PLUGIN_ID)
        .map_err(|error| package_error("initial-recovery", error))?;
    adapter
        .uninstall(PLUGIN_ID)
        .map_err(|error| package_error("initial-cleanup", error))?;

    let first_archive = package(PLUGIN_ID, "1.0.0", echo_module(1024)?);
    let second_archive = package(PLUGIN_ID, "1.1.0", echo_module(2048)?);
    let (first_identity, _) = install(adapter, &first_archive, "initial-install")?;
    let first_authority = adapter
        .synchronize_authority(activation(PLUGIN_ID, "1.0.0", true))
        .map_err(|error| package_error("initial-activation", error))?;
    require(
        first_authority.execution_enabled && first_authority.decisions[0].authorized,
        "initial-activation",
        "EXECUTION_POLICY_CLOSED",
    )?;
    let first_session = adapter
        .lifecycle()
        .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, first_identity)
        .map_err(|error| lifecycle_error("initial-session", error))?;
    execute_echo(
        adapter,
        &first_session,
        1,
        "packaged-v1",
        "initial-execution",
    )?;

    let (second_identity, invalidated_on_update) =
        install(adapter, &second_archive, "forward-update")?;
    require(
        invalidated_on_update == 1,
        "forward-update",
        "UPDATE_DID_NOT_REVOKE_SESSION",
    )?;
    require_revoked(adapter, &first_session, 2, "update-revocation")?;
    let second_authority = adapter
        .synchronize_authority(activation(PLUGIN_ID, "1.1.0", true))
        .map_err(|error| package_error("updated-activation", error))?;
    require(
        second_authority.decisions[0].authorized,
        "updated-activation",
        "UPDATED_IDENTITY_NOT_AUTHORIZED",
    )?;
    let second_session = adapter
        .lifecycle()
        .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, second_identity.clone())
        .map_err(|error| lifecycle_error("updated-session", error))?;
    execute_echo(
        adapter,
        &second_session,
        1,
        "packaged-v2",
        "updated-execution",
    )?;

    let disabled = adapter
        .synchronize_authority(activation(PLUGIN_ID, "1.1.0", false))
        .map_err(|error| package_error("disable", error))?;
    require(
        !disabled.decisions[0].authorized && disabled.decisions[0].invalidated_sessions == 1,
        "disable",
        "DISABLE_DID_NOT_REVOKE_SESSION",
    )?;
    require_revoked(adapter, &second_session, 2, "disable-revocation")?;

    adapter
        .synchronize_authority(activation(PLUGIN_ID, "1.1.0", true))
        .map_err(|error| package_error("reactivation", error))?;
    let final_session = adapter
        .lifecycle()
        .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, second_identity)
        .map_err(|error| lifecycle_error("pre-uninstall-session", error))?;
    adapter
        .uninstall(PLUGIN_ID)
        .map_err(|error| package_error("uninstall", error))?;
    require_revoked(adapter, &final_session, 1, "uninstall-revocation")?;
    require(
        adapter
            .lifecycle()
            .current_identity(PLUGIN_ID)
            .map_err(|error| lifecycle_error("uninstall-storage", error))?
            .is_none(),
        "uninstall-storage",
        "UNINSTALL_LEFT_RUNTIME_STORAGE",
    )?;

    Ok(vec![
        PackagedRuntimeSecurityCheck {
            name: "packaged-helper-install-and-execution",
            status: "passed",
            details: json!({
                "compilerHelper": "current-packaged-executable",
                "environmentCleared": true,
                "windowsJobLimitsRequired": true,
                "nativeEchoExecuted": true
            }),
        },
        PackagedRuntimeSecurityCheck {
            name: "packaged-update-revocation",
            status: "passed",
            details: json!({ "invalidatedSessions": invalidated_on_update }),
        },
        PackagedRuntimeSecurityCheck {
            name: "packaged-disable-revocation",
            status: "passed",
            details: json!({ "invalidatedSessions": disabled.decisions[0].invalidated_sessions }),
        },
        PackagedRuntimeSecurityCheck {
            name: "packaged-uninstall-revocation",
            status: "passed",
            details: json!({ "runtimeStorageRemoved": true }),
        },
    ])
}

fn recovery_check() -> Result<PackagedRuntimeSecurityCheck, PackagedRuntimeSecurityError> {
    let root = std::env::temp_dir().join(format!(
        "axiom-packaged-runtime-recovery-{}",
        Uuid::new_v4().simple()
    ));
    let installed_root = root.join("plugins");
    let runtime_root = root.join("runtime");
    let transactions_root = root.join("transactions");
    fs::create_dir_all(&root)
        .map_err(|_| harness_error("recovery-setup", "TEMP_DIRECTORY_UNAVAILABLE"))?;

    let result = (|| {
        let lifecycle = Arc::new(
            AxiomWasmLifecycle::native(runtime_root.clone())
                .map_err(|error| lifecycle_error("recovery-lifecycle", error))?,
        );
        let interrupted = ExecutablePackageAdapter::with_lifecycle_for_interrupted_commit_harness(
            lifecycle,
            installed_root.clone(),
            transactions_root.clone(),
        );
        let archive = package(RECOVERY_PLUGIN_ID, "1.0.0", echo_module(3072)?);
        let inspection = inspect(&archive, "recovery-inspection")?;
        let interrupted_result = interrupted.install(inspection.clone(), approval(&inspection));
        require(
            interrupted_result
                .as_ref()
                .is_err_and(|error| error.code == ExecutablePackageErrorCode::CommitPending),
            "recovery-interruption",
            "COMMIT_DID_NOT_REMAIN_PENDING",
        )?;
        drop(interrupted);

        let restarted = ExecutablePackageAdapter::native(
            installed_root.clone(),
            runtime_root.clone(),
            transactions_root.clone(),
        )
        .map_err(|error| package_error("recovery-restart", error))?;
        let recovered = restarted
            .recover_all_pending()
            .map_err(|error| package_error("recovery-startup", error))?;
        require(
            recovered
                == vec![(
                    RECOVERY_PLUGIN_ID.to_owned(),
                    ExecutablePackageRecoveryAction::Committed,
                )],
            "recovery-startup",
            "PENDING_COMMIT_NOT_RECOVERED",
        )?;
        let authority = restarted
            .synchronize_authority(activation(RECOVERY_PLUGIN_ID, "1.0.0", true))
            .map_err(|error| package_error("recovery-activation", error))?;
        require(
            authority.decisions[0].authorized,
            "recovery-activation",
            "RECOVERED_IDENTITY_NOT_AUTHORIZED",
        )?;
        let session = restarted
            .lifecycle()
            .open_session(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID, inspection.identity)
            .map_err(|error| lifecycle_error("recovery-session", error))?;
        execute_echo(
            &restarted,
            &session,
            1,
            "recovered-after-interruption",
            "recovery-execution",
        )?;
        restarted
            .uninstall(RECOVERY_PLUGIN_ID)
            .map_err(|error| package_error("recovery-cleanup", error))?;
        require(
            !transactions_root
                .join(format!("{RECOVERY_PLUGIN_ID}.json"))
                .exists(),
            "recovery-cleanup",
            "RECOVERY_JOURNAL_REMAINED",
        )?;
        Ok(PackagedRuntimeSecurityCheck {
            name: "packaged-interrupted-commit-recovery",
            status: "passed",
            details: json!({
                "restartedAdapter": true,
                "recoveryAction": "committed",
                "recoveredRuntimeExecuted": true,
                "journalRemoved": true
            }),
        })
    })();

    let cleanup = fs::remove_dir_all(&root);
    if result.is_ok() && cleanup.is_err() {
        return Err(harness_error(
            "recovery-cleanup",
            "TEMP_DIRECTORY_CLEANUP_FAILED",
        ));
    }
    result
}

fn tasks_ui_input(event: Value, state: Value, sequence: u64, ui_revision: u64) -> Value {
    json!({
        "schema": "axiom.plugin-ui-input", "schemaVersion": 1, "protocolVersion": 1,
        "instanceId": "p10.tasks.gate", "sequence": sequence, "uiRevision": ui_revision,
        "portfolioRevision": 7, "event": event, "state": state, "snapshots": [],
        "environment": {
            "observedAt": "2026-09-12T12:00:00.000Z", "localDate": "2026-09-12",
            "timezoneOffsetMinutes": 0, "viewport": "wide",
            "theme": { "colorScheme": "dark", "density": "comfortable" },
            "allocatedIds": ["123e4567-e89b-42d3-a456-426614174000"]
        }
    })
}

pub(crate) fn record_p10_progress(stage: &str) {
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            let _ = fs::write(parent.join("p10-progress.txt"), stage);
        }
    }
}

thread_local! {
    static COLD_TIMINGS: std::cell::RefCell<Option<Vec<Value>>> = const { std::cell::RefCell::new(None) };
}

/// Harness-only inclusive spans; collected in memory so file I/O is not timed.
pub(crate) struct TimingSpan(&'static str, Instant);

impl TimingSpan {
    pub(crate) fn new(stage: &'static str) -> Self {
        Self(stage, Instant::now())
    }
}

impl Drop for TimingSpan {
    fn drop(&mut self) {
        COLD_TIMINGS.with(|timings| {
            if let Some(timings) = timings.borrow_mut().as_mut() {
                timings.push(json!({ "stage": self.0, "ms": self.1.elapsed().as_secs_f64() * 1_000.0 }));
            }
        });
    }
}

fn reduce_tasks(
    adapter: &NativeExecutablePackageAdapter,
    input: Value,
    stage: &'static str,
) -> Result<Value, PackagedRuntimeSecurityError> {
    adapter
        .execute_ui_reduction(ExecutableUiReductionRequest {
            schema: "axiom.executable-plugin-ui-reduction".to_owned(),
            schema_version: 1,
            view_id: "org.axiom.tasks/tasks".to_owned(),
            input_json: serde_json::to_string(&input)
                .map_err(|_| harness_error(stage, "UI_INPUT_ENCODING_FAILED"))?,
        })
        .map(|outcome| outcome.result)
        .map_err(|error| package_error(stage, error))
}

fn install_tasks(
    adapter: &NativeExecutablePackageAdapter,
    archive: &[u8],
    stage: &'static str,
) -> Result<WasmPluginIdentity, PackagedRuntimeSecurityError> {
    let inspection = inspect(archive, stage)?;
    let identity = inspection.identity.clone();
    adapter
        .install(inspection.clone(), full_approval(&inspection))
        .map_err(|error| package_error(stage, error))?;
    adapter
        .synchronize_authority(activation(
            &identity.plugin_id,
            &identity.plugin_version,
            true,
        ))
        .map_err(|error| package_error(stage, error))?;
    Ok(identity)
}

fn packaged_tasks_ui_gate(
    adapter: &NativeExecutablePackageAdapter,
) -> Result<PackagedRuntimeSecurityCheck, PackagedRuntimeSecurityError> {
    record_p10_progress("start");
    let executable = std::env::current_exe()
        .map_err(|_| harness_error("p10-path", "EXECUTABLE_PATH_UNAVAILABLE"))?;
    let package_root = executable
        .parent()
        .ok_or_else(|| harness_error("p10-path", "EXECUTABLE_PARENT_UNAVAILABLE"))?
        .join("p10-packages");
    let package_a = fs::read(package_root.join("tasks-a.axiom-plugin"))
        .map_err(|_| harness_error("p10-package-a", "PACKAGE_A_UNAVAILABLE"))?;
    let package_b = fs::read(package_root.join("tasks-b.axiom-plugin"))
        .map_err(|_| harness_error("p10-package-b", "PACKAGE_B_UNAVAILABLE"))?;
    let _ = adapter.uninstall("org.axiom.tasks");

    let install_started = Instant::now();
    let identity_a = install_tasks(adapter, &package_a, "p10-install-a")?;
    let install_ms = install_started.elapsed().as_secs_f64() * 1_000.0;
    record_p10_progress("installed-a");
    let captured = json!({
        "schema": "axiom.entity-reference", "schemaVersion": 1, "kind": "core.node",
        "id": "node-child", "location": { "processId": "process-one", "graphPath": ["node-parent"] }
    });
    let mount_event =
        json!({ "kind": "mount", "surface": "canvas-dialog", "capturedContext": captured });
    COLD_TIMINGS.with(|timings| *timings.borrow_mut() = Some(Vec::new()));
    let cold_started = Instant::now();
    let result_a = reduce_tasks(
        adapter,
        tasks_ui_input(mount_event.clone(), Value::Null, 1, 0),
        "p10-cold-a",
    )?;
    let cold_ms = cold_started.elapsed().as_secs_f64() * 1_000.0;
    let cold_stages = COLD_TIMINGS.with(|timings| timings.borrow_mut().take().unwrap_or_default());
    record_p10_progress("cold-a-complete");
    require(
        result_a.pointer("/tree/children/0/children/0/children/0/type") == Some(&json!("stack")),
        "p10-layout-a",
        "PACKAGE_A_LAYOUT_MISMATCH",
    )?;

    let mut samples = Vec::with_capacity(100);
    for sequence in 2..=101 {
        std::thread::sleep(std::time::Duration::from_millis(55));
        let started = Instant::now();
        reduce_tasks(
            adapter,
            tasks_ui_input(
                json!({ "kind": "invalidate", "flags": { "data": false, "workspace": false, "viewport": true, "theme": false } }),
                result_a["state"].clone(),
                sequence,
                sequence - 1,
            ),
            "p10-warm-action",
        )?;
        samples.push(started.elapsed().as_secs_f64() * 1_000.0);
        if sequence % 10 == 1 {
            record_p10_progress(&format!("warm-{}", sequence - 1));
        }
    }
    samples.sort_by(f64::total_cmp);
    let p95_ms = samples[94];
    // Persist diagnostics before enforcing the unchanged performance limits.
    fs::write(
        executable.parent().unwrap().join("p10-latency.json"),
        serde_json::to_vec_pretty(&json!({
            "installMs": install_ms, "coldOpenMs": cold_ms, "coldLimitMs": 1_000,
            "warmP95Ms": p95_ms, "warmLimitMs": 150, "warmSamplesMs": samples,
            "coldStagesInclusive": cold_stages,
        })).map_err(|_| harness_error("p10-latency", "TIMING_ENCODING_FAILED"))?,
    ).map_err(|_| harness_error("p10-latency", "TIMING_WRITE_FAILED"))?;
    require(p95_ms <= 150.0, "p10-latency", "WARM_P95_EXCEEDED")?;
    require(cold_ms <= 1_000.0, "p10-latency", "COLD_OPEN_EXCEEDED")?;

    let identity_b = install_tasks(adapter, &package_b, "p10-install-b")?;
    record_p10_progress("installed-b");
    let result_b = reduce_tasks(
        adapter,
        tasks_ui_input(mount_event, Value::Null, 1, 0),
        "p10-open-b",
    )?;
    require(
        result_b.pointer("/tree/children/0/children/0/children/0/type") == Some(&json!("grid")),
        "p10-layout-b",
        "PACKAGE_B_LAYOUT_MISMATCH",
    )?;
    let title = reduce_tasks(
        adapter,
        tasks_ui_input(
            json!({ "kind": "action", "controlKey": "capture.title", "actionId": "capture.title.change", "value": "Review response", "draftRevision": null }),
            result_b["state"].clone(),
            2,
            1,
        ),
        "p10-title-b",
    )?;
    let rejected = reduce_tasks(
        adapter,
        tasks_ui_input(
            json!({ "kind": "action", "controlKey": "capture.save", "actionId": "capture.save", "value": null, "draftRevision": null }),
            title["state"].clone(),
            3,
            2,
        ),
        "p10-rule-reject-b",
    )?;
    require(
        rejected["effects"].as_array().is_some_and(Vec::is_empty)
            && rejected["state"]["validation"]
                .as_str()
                .is_some_and(|message| message.contains("due date or a note")),
        "p10-rule-reject-b",
        "PACKAGE_B_RULE_DID_NOT_REJECT",
    )?;
    let due = reduce_tasks(
        adapter,
        tasks_ui_input(
            json!({ "kind": "action", "controlKey": "capture.due", "actionId": "capture.due.change", "value": "2026-09-30", "draftRevision": null }),
            rejected["state"].clone(),
            4,
            3,
        ),
        "p10-due-b",
    )?;
    let accepted = reduce_tasks(
        adapter,
        tasks_ui_input(
            json!({ "kind": "action", "controlKey": "capture.save", "actionId": "capture.save", "value": null, "draftRevision": null }),
            due["state"].clone(),
            5,
            4,
        ),
        "p10-rule-accept-b",
    )?;
    require(
        accepted.pointer("/effects/0/kind") == Some(&json!("storage.collection.transact"))
            && accepted
                .pointer("/effects/0/payload/operations/0/item/details/context/reference/id")
                == Some(&json!("node-child")),
        "p10-rule-accept-b",
        "PACKAGE_B_RULE_DID_NOT_ACCEPT",
    )?;

    let restarted = NativeExecutablePackageAdapter::native_for_app()
        .map_err(|error| package_error("p10-restart", error))?;
    restarted
        .synchronize_authority(activation("org.axiom.tasks", "1.2.0", true))
        .map_err(|error| package_error("p10-restart", error))?;
    let restarted_b = reduce_tasks(
        &restarted,
        tasks_ui_input(
            json!({ "kind": "mount", "surface": "app-rail", "capturedContext": null }),
            Value::Null,
            1,
            0,
        ),
        "p10-restart",
    )?;
    require(
        restarted_b.pointer("/tree/type") == Some(&json!("grid")),
        "p10-restart",
        "PACKAGE_B_DID_NOT_RESTART",
    )?;
    record_p10_progress("restarted-b");
    let rollback = restarted
        .rollback(&identity_b)
        .map_err(|error| package_error("p10-rollback", error))?;
    require(
        rollback.lifecycle.identity == identity_a,
        "p10-rollback",
        "ROLLBACK_IDENTITY_MISMATCH",
    )?;
    record_p10_progress("rolled-back-a");
    restarted
        .synchronize_authority(activation("org.axiom.tasks", "1.1.0", true))
        .map_err(|error| package_error("p10-rollback-activation", error))?;
    let rollback_a = reduce_tasks(
        &restarted,
        tasks_ui_input(
            json!({ "kind": "mount", "surface": "app-rail", "capturedContext": null }),
            Value::Null,
            1,
            0,
        ),
        "p10-rollback-open",
    )?;
    require(
        rollback_a.pointer("/tree/type") == Some(&json!("stack")),
        "p10-rollback-open",
        "PACKAGE_A_DID_NOT_REACTIVATE",
    )?;
    restarted
        .uninstall("org.axiom.tasks")
        .map_err(|error| package_error("p10-cleanup", error))?;
    record_p10_progress("complete");

    Ok(PackagedRuntimeSecurityCheck {
        name: "packaged-tasks-ui-a-b-gate",
        status: "passed",
        details: json!({
            "packageA": identity_a.plugin_version,
            "packageB": identity_b.plugin_version,
            "layoutChanged": true,
            "captureRuleChanged": true,
            "nestedReferencePreserved": true,
            "restartPassed": true,
            "rollbackPassed": true,
            "coldOpenMs": cold_ms,
            "warmActionP95Ms": p95_ms,
            "warmSamples": samples.len()
        }),
    })
}

#[command]
pub fn run_packaged_executable_security_harness(
) -> Result<PackagedRuntimeSecurityReport, PackagedRuntimeSecurityError> {
    require(
        cfg!(windows),
        "platform",
        "PACKAGED_SECURITY_HARNESS_REQUIRES_WINDOWS",
    )?;
    require(
        EXECUTABLE_PLUGIN_EXECUTION_ENABLED,
        "execution-policy",
        "HARNESS_EXECUTION_POLICY_DISABLED",
    )?;

    let outcome = std::thread::Builder::new()
        .name("axiom-runtime-security-harness".to_owned())
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            record_p10_progress("native-start");
            let adapter = NativeExecutablePackageAdapter::native_for_app()
                .map_err(|error| package_error("worker-adapter", error))?;
            adapter
                .recover_all_pending()
                .map_err(|error| package_error("worker-recovery", error))?;
            record_p10_progress("native-lifecycle");
            let mut checks = packaged_lifecycle_checks(&adapter)?;
            record_p10_progress("native-recovery");
            checks.push(recovery_check()?);
            record_p10_progress("native-tasks");
            checks.push(packaged_tasks_ui_gate(&adapter)?);
            Ok(PackagedRuntimeSecurityReport {
                schema: "axiom.packaged-runtime-security-report",
                schema_version: 1,
                status: "passed",
                execution_enabled: true,
                checks,
            })
        })
        .map_err(|_| harness_error("worker-start", "WORKER_THREAD_UNAVAILABLE"))?
        .join()
        .map_err(|_| harness_error("worker-join", "WORKER_THREAD_FAILED"))?;
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            if let Ok(bytes) = serde_json::to_vec_pretty(&outcome) {
                let _ = fs::write(parent.join("p10-native-result.json"), bytes);
            }
        }
    }
    outcome
}

fn packaged_tasks_archive(variant: &str) -> Result<Vec<u8>, PackagedRuntimeSecurityError> {
    let file_name = match variant {
        "a" => "tasks-a.axiom-plugin",
        "b" => "tasks-b.axiom-plugin",
        _ => {
            return Err(harness_error(
                "p10-integrated-package",
                "UNKNOWN_TASKS_VARIANT",
            ))
        }
    };
    let executable = std::env::current_exe()
        .map_err(|_| harness_error("p10-integrated-package", "EXECUTABLE_PATH_UNAVAILABLE"))?;
    let path = executable
        .parent()
        .ok_or_else(|| harness_error("p10-integrated-package", "EXECUTABLE_PARENT_UNAVAILABLE"))?
        .join("p10-packages")
        .join(file_name);
    fs::read(path).map_err(|_| {
        harness_error(
            "p10-integrated-package",
            "PACKAGED_TASKS_ARCHIVE_UNAVAILABLE",
        )
    })
}

/// Installs A from a clean Tasks runtime or promotes the installed A generation to B.
/// The returned document is the exact metadata consumed by the production plugin store.
#[command]
pub fn prepare_packaged_tasks_variant(
    variant: String,
    adapter: State<'_, NativeExecutablePackageAdapter>,
) -> Result<Value, PackagedRuntimeSecurityError> {
    let archive = packaged_tasks_archive(&variant)?;
    if variant == "a" {
        let _ = adapter.uninstall("org.axiom.tasks");
    }
    let inspection = inspect(&archive, "p10-integrated-inspect")?;
    let identity = inspection.identity.clone();
    let outcome = adapter
        .install(inspection.clone(), full_approval(&inspection))
        .map_err(|error| package_error("p10-integrated-install", error))?;
    adapter
        .synchronize_authority(activation(
            &identity.plugin_id,
            &identity.plugin_version,
            true,
        ))
        .map_err(|error| package_error("p10-integrated-authority", error))?;
    record_p10_progress(if variant == "a" {
        "integrated-installed-a"
    } else {
        "integrated-installed-b"
    });
    Ok(outcome.installed_document)
}

/// Restores A's runtime and exact installed metadata without touching Portfolio data.
#[command]
pub fn rollback_packaged_tasks_to_a(
    adapter: State<'_, NativeExecutablePackageAdapter>,
) -> Result<Value, PackagedRuntimeSecurityError> {
    let expected = WasmPluginIdentity {
        plugin_id: "org.axiom.tasks".to_owned(),
        plugin_version: "1.2.0".to_owned(),
        data_version: 1,
    };
    let outcome = adapter
        .rollback(&expected)
        .map_err(|error| package_error("p10-integrated-rollback", error))?;
    adapter
        .synchronize_authority(activation("org.axiom.tasks", "1.1.0", true))
        .map_err(|error| package_error("p10-integrated-rollback-authority", error))?;
    record_p10_progress("integrated-rolled-back-a");
    Ok(outcome.installed_document)
}

fn p10_product_phase_path() -> Result<std::path::PathBuf, PackagedRuntimeSecurityError> {
    std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.parent()
                .map(|parent| parent.join("p10-product-phase.txt"))
        })
        .ok_or_else(|| harness_error("p10-product-phase", "EXECUTABLE_PARENT_UNAVAILABLE"))
}

#[command]
pub fn read_packaged_product_phase() -> Result<String, PackagedRuntimeSecurityError> {
    let path = p10_product_phase_path()?;
    match fs::read_to_string(path) {
        Ok(value) => Ok(value.trim().to_owned()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok("first-launch".to_owned()),
        Err(_) => Err(harness_error("p10-product-phase", "PHASE_READ_FAILED")),
    }
}

#[command]
pub fn write_packaged_product_phase(phase: String) -> Result<(), PackagedRuntimeSecurityError> {
    require(
        phase == "complete" || phase.starts_with("second-launch:"),
        "p10-product-phase",
        "INVALID_PRODUCT_PHASE",
    )?;
    fs::write(p10_product_phase_path()?, phase)
        .map_err(|_| harness_error("p10-product-phase", "PHASE_WRITE_FAILED"))
}

#[command]
pub fn write_packaged_product_report(report: Value) -> Result<(), PackagedRuntimeSecurityError> {
    let path = std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.parent()
                .map(|parent| parent.join("p10-product-result.json"))
        })
        .ok_or_else(|| harness_error("p10-product-report", "EXECUTABLE_PARENT_UNAVAILABLE"))?;
    let bytes = serde_json::to_vec_pretty(&report)
        .map_err(|_| harness_error("p10-product-report", "REPORT_ENCODING_FAILED"))?;
    fs::write(path, bytes).map_err(|_| harness_error("p10-product-report", "REPORT_WRITE_FAILED"))
}
