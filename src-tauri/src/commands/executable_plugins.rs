use std::{path::Path, thread};

use serde::Serialize;
use serde_json::Value;
use tauri::{command, State};

use crate::{
    plugin_executable_package::{
        ExecutableActivationSnapshot, ExecutableAuthoritySyncOutcome, ExecutableInstallApproval,
        ExecutablePackageAdapter, ExecutablePackageError, ExecutablePackageErrorCode,
        ExecutablePackageReview, ExecutableProposalCommandOutcome, ExecutableUiReductionOutcome,
        ExecutableUiReductionRequest,
    },
    plugin_wasm_admission::NativeWasmAdmission,
    plugin_wasm_data_plane::WasmComputeRequest,
};

pub type NativeExecutablePackageAdapter = ExecutablePackageAdapter<NativeWasmAdmission>;
const EXECUTABLE_COMPUTE_WORKER_STACK_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutablePackageInstallResponse {
    schema: &'static str,
    schema_version: u32,
    transaction_id: String,
    reused_existing_runtime: bool,
    installed_document: Value,
}

#[command]
pub fn inspect_executable_plugin_package(
    path: String,
) -> Result<ExecutablePackageReview, ExecutablePackageError> {
    NativeExecutablePackageAdapter::inspect_file(Path::new(&path))
        .map(|inspection| inspection.review())
}

#[command]
pub fn install_executable_plugin_package(
    path: String,
    approval: ExecutableInstallApproval,
    adapter: State<'_, NativeExecutablePackageAdapter>,
) -> Result<ExecutablePackageInstallResponse, ExecutablePackageError> {
    adapter
        .install_file(Path::new(&path), approval)
        .map(|outcome| ExecutablePackageInstallResponse {
            schema: "axiom.executable-package-install-result",
            schema_version: 1,
            transaction_id: outcome.transaction_id,
            reused_existing_runtime: outcome.lifecycle.reused_existing,
            installed_document: outcome.installed_document,
        })
}

#[command]
pub fn synchronize_executable_plugin_authority(
    snapshot: ExecutableActivationSnapshot,
    adapter: State<'_, NativeExecutablePackageAdapter>,
) -> Result<ExecutableAuthoritySyncOutcome, ExecutablePackageError> {
    adapter.synchronize_authority(snapshot)
}

#[command]
pub fn run_executable_plugin_proposal_command(
    command_id: String,
    request: WasmComputeRequest,
    adapter: State<'_, NativeExecutablePackageAdapter>,
) -> Result<ExecutableProposalCommandOutcome, ExecutablePackageError> {
    let adapter = adapter.inner();
    thread::scope(|scope| {
        let worker = thread::Builder::new()
            .name("nemoto-executable-proposal".to_owned())
            .stack_size(EXECUTABLE_COMPUTE_WORKER_STACK_BYTES)
            .spawn_scoped(scope, move || {
                adapter.execute_proposal_command(&command_id, request)
            })
            .map_err(|_| worker_unavailable())?;
        worker.join().map_err(|_| worker_unavailable())?
    })
}

#[command]
pub fn run_executable_plugin_ui_reduction(
    request: ExecutableUiReductionRequest,
    adapter: State<'_, NativeExecutablePackageAdapter>,
) -> Result<ExecutableUiReductionOutcome, ExecutablePackageError> {
    let adapter = adapter.inner();
    run_on_executable_worker("nemoto-executable-ui", move || {
        adapter.execute_ui_reduction(request)
    })
}

fn run_on_executable_worker<T, F>(name: &str, operation: F) -> Result<T, ExecutablePackageError>
where
    T: Send,
    F: FnOnce() -> Result<T, ExecutablePackageError> + Send,
{
    thread::scope(|scope| {
        let worker = thread::Builder::new()
            .name(name.to_owned())
            .stack_size(EXECUTABLE_COMPUTE_WORKER_STACK_BYTES)
            .spawn_scoped(scope, operation)
            .map_err(|_| worker_unavailable())?;
        worker.join().map_err(|_| worker_unavailable())?
    })
}

fn worker_unavailable() -> ExecutablePackageError {
    ExecutablePackageError::new(
        ExecutablePackageErrorCode::WorkerUnavailable,
        "The isolated executable worker could not be started.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_reductions_run_on_the_named_isolated_worker() {
        let name = run_on_executable_worker("axiom-ui-worker-test", || {
            Ok(thread::current().name().map(str::to_owned))
        })
        .unwrap();
        assert_eq!(name.as_deref(), Some("axiom-ui-worker-test"));
    }
}
