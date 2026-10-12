//! Native, fail-closed host for the first executable-plugin ABI.
//!
//! `axiom-wasm-v1` is deliberately a pure JSON transform. A guest receives no
//! imports, so it has no ambient filesystem, network, clock, randomness, WASI,
//! Tauri, or Axiom Core authority. Each invocation gets a fresh store and is
//! discarded after one call.

use std::{
    collections::{BTreeMap, VecDeque},
    fmt,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, RecvTimeoutError},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use wasmtime::{
    Config, Engine, ExternType, Linker, Module, Store, StoreLimits, StoreLimitsBuilder, ValType,
};

use crate::plugin_compute_policy::{IsolatedComputePolicy, ISOLATED_COMPUTE_POLICY_V1};

pub const NEMOTO_WASM_ABI_NAME: &str = "axiom-wasm-v1";
pub const NEMOTO_WASM_ABI_VERSION: i32 = 1;
pub const WASMTIME_ENGINE_VERSION: &str = "36.0.14";

const MEMORY_EXPORT: &str = "memory";
const VERSION_EXPORT: &str = "axiom_abi_version";
const ALLOC_EXPORT: &str = "axiom_alloc";
const RUN_EXPORT: &str = "axiom_run";
const RUST_DATA_END_EXPORT: &str = "__data_end";
const RUST_HEAP_BASE_EXPORT: &str = "__heap_base";
const WASM_PAGE_BYTES: u64 = 65_536;

/// Stable, non-sensitive failure classes suitable for crossing the Tauri IPC boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WasmHostErrorCode {
    ModuleTooLarge,
    InputTooLarge,
    InvalidInput,
    InvalidModule,
    ImportDenied,
    ExportMismatch,
    AbiMismatch,
    ResourceLimit,
    FuelExhausted,
    DeadlineExceeded,
    GuestTrap,
    InvalidGuestPointer,
    OutputTooLarge,
    InvalidOutput,
    HostUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WasmHostError {
    pub code: WasmHostErrorCode,
    pub message: &'static str,
}

impl WasmHostError {
    fn new(code: WasmHostErrorCode, message: &'static str) -> Self {
        Self { code, message }
    }
}

impl fmt::Display for WasmHostError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for WasmHostError {}

struct StoreState {
    limits: StoreLimits,
}

/// Compiles and invokes untrusted core WebAssembly under the v1 policy.
///
/// Calls are serialized because Wasmtime epoch interruption is engine-wide. This
/// avoids one timed-out guest interrupting another guest that shares the engine.
pub struct NemotoWasmHost {
    engine: Engine,
    policy: IsolatedComputePolicy,
    execution_lock: Mutex<()>,
    module_cache: Mutex<VecDeque<([u8; 32], Module)>>,
}

impl NemotoWasmHost {
    pub fn new() -> Result<Self, WasmHostError> {
        Self::with_policy(ISOLATED_COMPUTE_POLICY_V1)
    }

    fn with_policy(policy: IsolatedComputePolicy) -> Result<Self, WasmHostError> {
        if policy.max_module_bytes == 0
            || policy.max_input_bytes == 0
            || policy.max_output_bytes == 0
            || policy.max_linear_memory_bytes == 0
            || policy.fuel_per_entrypoint == 0
            || policy.wall_time_per_entrypoint_ms == 0
        {
            return Err(WasmHostError::new(
                WasmHostErrorCode::HostUnavailable,
                "The isolated compute policy is invalid.",
            ));
        }

        let mut config = Config::new();
        config
            .consume_fuel(true)
            .epoch_interruption(true)
            .max_wasm_stack(policy.max_wasm_stack_bytes)
            .wasm_tail_call(false)
            .wasm_custom_page_sizes(false)
            .wasm_shared_everything_threads(false)
            .wasm_wide_arithmetic(false)
            .wasm_simd(false)
            .wasm_relaxed_simd(false)
            .wasm_multi_memory(false)
            .wasm_memory64(false)
            .wasm_stack_switching(false)
            .wasm_exceptions(false)
            .relaxed_simd_deterministic(true)
            .cranelift_nan_canonicalization(true);

        let engine = Engine::new(&config).map_err(|_| {
            WasmHostError::new(
                WasmHostErrorCode::HostUnavailable,
                "The isolated compute engine could not be initialized.",
            )
        })?;

        Ok(Self {
            engine,
            policy,
            execution_lock: Mutex::new(()),
            module_cache: Mutex::new(VecDeque::new()),
        })
    }

    /// Executes a single JSON request and returns a single JSON response.
    ///
    /// The guest module must export:
    /// - `memory`
    /// - `axiom_abi_version() -> i32`
    /// - `axiom_alloc(i32) -> i32`
    /// - `axiom_run(i32, i32) -> i64`
    ///
    /// `axiom_run` packs the output pointer into the high 32 bits and the output
    /// byte length into the low 32 bits of its return value.
    pub fn execute_json(
        &self,
        module_bytes: &[u8],
        input_json: &[u8],
    ) -> Result<Vec<u8>, WasmHostError> {
        self.execute_with_deadline(
            module_bytes,
            input_json,
            self.policy.wall_time_per_entrypoint_ms,
        )
    }

    pub fn execute_ui_json(
        &self,
        module_bytes: &[u8],
        input_json: &[u8],
    ) -> Result<Vec<u8>, WasmHostError> {
        self.execute_with_deadline(
            module_bytes,
            input_json,
            crate::plugin_ui_protocol::PLUGIN_UI_LIMITS.deadline_ms,
        )
    }

    fn execute_with_deadline(
        &self,
        module_bytes: &[u8],
        input_json: &[u8],
        deadline_ms: u64,
    ) -> Result<Vec<u8>, WasmHostError> {
        if module_bytes.len() > self.policy.max_module_bytes {
            return Err(WasmHostError::new(
                WasmHostErrorCode::ModuleTooLarge,
                "The WebAssembly module exceeds the allowed size.",
            ));
        }
        if input_json.len() > self.policy.max_input_bytes {
            return Err(WasmHostError::new(
                WasmHostErrorCode::InputTooLarge,
                "The plugin input exceeds the allowed size.",
            ));
        }
        serde_json::from_slice::<serde_json::Value>(input_json).map_err(|_| {
            WasmHostError::new(
                WasmHostErrorCode::InvalidInput,
                "The plugin input is not valid JSON.",
            )
        })?;

        let _execution_guard = self.execution_lock.lock().map_err(|_| {
            WasmHostError::new(
                WasmHostErrorCode::HostUnavailable,
                "The isolated compute engine is unavailable.",
            )
        })?;

        let module = self.cached_module(module_bytes)?;

        let limits = StoreLimitsBuilder::new()
            .memory_size(self.policy.max_linear_memory_bytes)
            .memories(self.policy.max_memories)
            .instances(self.policy.max_instances)
            .tables(self.policy.max_tables)
            .table_elements(self.policy.max_table_elements)
            .trap_on_grow_failure(true)
            .build();
        let mut store = Store::new(&self.engine, StoreState { limits });
        store.limiter(|state| &mut state.limits);
        store
            .set_fuel(self.policy.fuel_per_entrypoint)
            .map_err(|_| {
                WasmHostError::new(
                    WasmHostErrorCode::HostUnavailable,
                    "The isolated compute budget could not be initialized.",
                )
            })?;
        store.set_epoch_deadline(1);
        store.epoch_deadline_trap();

        let deadline_fired = Arc::new(AtomicBool::new(false));
        let (cancel_sender, cancel_receiver) = mpsc::channel::<()>();
        let watchdog_engine = self.engine.clone();
        let watchdog_fired = Arc::clone(&deadline_fired);
        let timeout =
            Duration::from_millis(deadline_ms.min(self.policy.wall_time_per_entrypoint_ms));
        let watchdog = thread::spawn(move || {
            if matches!(
                cancel_receiver.recv_timeout(timeout),
                Err(RecvTimeoutError::Timeout)
            ) {
                watchdog_fired.store(true, Ordering::Release);
                watchdog_engine.increment_epoch();
            }
        });

        let result = self.invoke(&module, &mut store, input_json);
        let _ = cancel_sender.send(());
        let _ = watchdog.join();

        if deadline_fired.load(Ordering::Acquire) && result.is_err() {
            return Err(WasmHostError::new(
                WasmHostErrorCode::DeadlineExceeded,
                "The plugin exceeded its wall-clock deadline.",
            ));
        }
        if result.is_err() && store.get_fuel().unwrap_or(1) == 0 {
            return Err(WasmHostError::new(
                WasmHostErrorCode::FuelExhausted,
                "The plugin exhausted its instruction budget.",
            ));
        }
        result
    }

    /// Retains at most eight modules compiled by this engine from raw Wasm.
    /// Cached code carries no session authority; every call gets a fresh Store.
    fn cached_module(&self, module_bytes: &[u8]) -> Result<Module, WasmHostError> {
        #[cfg(feature = "runtime-security-harness")]
        let _timing = crate::commands::runtime_security_harness::TimingSpan::new("wasm.module-cache-and-compile");
        let digest: [u8; 32] = Sha256::digest(module_bytes).into();
        let mut cache = self.module_cache.lock().map_err(|_| {
            WasmHostError::new(
                WasmHostErrorCode::HostUnavailable,
                "The isolated compute module cache is unavailable.",
            )
        })?;
        if let Some(index) = cache.iter().position(|(key, _)| key == &digest) {
            let entry = cache.remove(index).expect("located cache entry");
            let module = entry.1.clone();
            cache.push_front(entry);
            return Ok(module);
        }
        #[cfg(feature = "runtime-security-harness")]
        let compilation = crate::commands::runtime_security_harness::TimingSpan::new("wasm.compile-cache-miss");
        let module = Module::new(&self.engine, module_bytes).map_err(|_| {
            WasmHostError::new(
                WasmHostErrorCode::InvalidModule,
                "The WebAssembly module is invalid or unsupported.",
            )
        })?;
        #[cfg(feature = "runtime-security-harness")]
        drop(compilation);
        self.validate_abi(&module)?;
        cache.push_front((digest, module.clone()));
        cache.truncate(8);
        Ok(module)
    }

    /// Compiles and serializes a validated module inside the admission helper.
    ///
    /// The serialized artifact is deliberately discarded by the caller. Its
    /// size proves that the configured engine completed code generation without
    /// making machine code a package-controlled persistent input.
    pub(crate) fn compile_for_admission(
        &self,
        module_bytes: &[u8],
    ) -> Result<usize, WasmHostError> {
        if module_bytes.len() > self.policy.max_module_bytes {
            return Err(WasmHostError::new(
                WasmHostErrorCode::ModuleTooLarge,
                "The WebAssembly module exceeds the allowed size.",
            ));
        }
        let _execution_guard = self.execution_lock.lock().map_err(|_| {
            WasmHostError::new(
                WasmHostErrorCode::HostUnavailable,
                "The isolated compute engine is unavailable.",
            )
        })?;
        let module = Module::new(&self.engine, module_bytes).map_err(|_| {
            WasmHostError::new(
                WasmHostErrorCode::InvalidModule,
                "The WebAssembly module is invalid or unsupported.",
            )
        })?;
        self.validate_abi(&module)?;
        module
            .serialize()
            .map(|artifact| artifact.len())
            .map_err(|_| {
                WasmHostError::new(
                    WasmHostErrorCode::HostUnavailable,
                    "The isolated compute artifact could not be generated.",
                )
            })
    }

    fn validate_abi(&self, module: &Module) -> Result<(), WasmHostError> {
        if module.imports().next().is_some() {
            return Err(WasmHostError::new(
                WasmHostErrorCode::ImportDenied,
                "axiom-wasm-v1 modules may not import host capabilities.",
            ));
        }

        let exports = module
            .exports()
            .map(|export| (export.name().to_owned(), export.ty()))
            .collect::<BTreeMap<_, _>>();
        if !exports.contains_key(MEMORY_EXPORT)
            || !exports.contains_key(VERSION_EXPORT)
            || !exports.contains_key(ALLOC_EXPORT)
            || !exports.contains_key(RUN_EXPORT)
            || exports
                .iter()
                .any(|(name, export_type)| match name.as_str() {
                    MEMORY_EXPORT | VERSION_EXPORT | ALLOC_EXPORT | RUN_EXPORT => false,
                    RUST_DATA_END_EXPORT | RUST_HEAP_BASE_EXPORT => {
                        !is_immutable_i32_global(export_type)
                    }
                    _ => true,
                })
        {
            return Err(export_mismatch());
        }

        match exports.get(MEMORY_EXPORT) {
            Some(ExternType::Memory(memory))
                if !memory.is_64()
                    && !memory.is_shared()
                    && memory.minimum().saturating_mul(WASM_PAGE_BYTES)
                        <= self.policy.max_linear_memory_bytes as u64
                    && memory.maximum().is_none_or(|pages| {
                        pages.saturating_mul(WASM_PAGE_BYTES)
                            <= self.policy.max_linear_memory_bytes as u64
                    }) => {}
            Some(ExternType::Memory(_)) => {
                return Err(WasmHostError::new(
                    WasmHostErrorCode::ResourceLimit,
                    "The module declares memory outside the allowed limit.",
                ));
            }
            _ => return Err(export_mismatch()),
        }

        require_function(exports.get(VERSION_EXPORT), &[], &[ValType::I32])?;
        require_function(exports.get(ALLOC_EXPORT), &[ValType::I32], &[ValType::I32])?;
        require_function(
            exports.get(RUN_EXPORT),
            &[ValType::I32, ValType::I32],
            &[ValType::I64],
        )?;
        Ok(())
    }

    fn invoke(
        &self,
        module: &Module,
        store: &mut Store<StoreState>,
        input_json: &[u8],
    ) -> Result<Vec<u8>, WasmHostError> {
        let linker = Linker::<StoreState>::new(&self.engine);
        let instance = linker
            .instantiate(&mut *store, module)
            .map_err(runtime_error)?;
        let memory = instance
            .get_memory(&mut *store, MEMORY_EXPORT)
            .ok_or_else(export_mismatch)?;
        let version = instance
            .get_typed_func::<(), i32>(&mut *store, VERSION_EXPORT)
            .map_err(|_| export_mismatch())?;
        let alloc = instance
            .get_typed_func::<i32, i32>(&mut *store, ALLOC_EXPORT)
            .map_err(|_| export_mismatch())?;
        let run = instance
            .get_typed_func::<(i32, i32), i64>(&mut *store, RUN_EXPORT)
            .map_err(|_| export_mismatch())?;

        if version.call(&mut *store, ()).map_err(runtime_error)? != NEMOTO_WASM_ABI_VERSION {
            return Err(WasmHostError::new(
                WasmHostErrorCode::AbiMismatch,
                "The module reports an unsupported Axiom WebAssembly ABI.",
            ));
        }

        let input_len = i32::try_from(input_json.len()).map_err(|_| {
            WasmHostError::new(
                WasmHostErrorCode::InputTooLarge,
                "The plugin input exceeds the allowed size.",
            )
        })?;
        let input_pointer = alloc.call(&mut *store, input_len).map_err(runtime_error)?;
        if input_pointer < 0 {
            return Err(invalid_guest_pointer());
        }
        memory
            .write(&mut *store, input_pointer as usize, input_json)
            .map_err(|_| invalid_guest_pointer())?;

        let packed_output = run
            .call(&mut *store, (input_pointer, input_len))
            .map_err(runtime_error)? as u64;
        let output_pointer = (packed_output >> 32) as u32 as usize;
        let output_len = (packed_output & u32::MAX as u64) as usize;
        if output_len > self.policy.max_output_bytes {
            return Err(WasmHostError::new(
                WasmHostErrorCode::OutputTooLarge,
                "The plugin output exceeds the allowed size.",
            ));
        }
        let output_end = output_pointer
            .checked_add(output_len)
            .ok_or_else(invalid_guest_pointer)?;
        let guest_memory = memory.data(&*store);
        if output_end > guest_memory.len() {
            return Err(invalid_guest_pointer());
        }
        let output = guest_memory[output_pointer..output_end].to_vec();
        serde_json::from_slice::<serde_json::Value>(&output).map_err(|_| {
            WasmHostError::new(
                WasmHostErrorCode::InvalidOutput,
                "The plugin output is not valid JSON.",
            )
        })?;
        Ok(output)
    }
}

fn require_function(
    export: Option<&ExternType>,
    expected_params: &[ValType],
    expected_results: &[ValType],
) -> Result<(), WasmHostError> {
    match export {
        Some(ExternType::Func(function))
            if val_types_match(function.params(), expected_params)
                && val_types_match(function.results(), expected_results) =>
        {
            Ok(())
        }
        _ => Err(export_mismatch()),
    }
}

fn val_types_match(actual: impl Iterator<Item = ValType>, expected: &[ValType]) -> bool {
    let actual = actual.collect::<Vec<_>>();
    actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|(actual, expected)| same_val_type(actual, expected))
}

fn same_val_type(left: &ValType, right: &ValType) -> bool {
    matches!(
        (left, right),
        (ValType::I32, ValType::I32)
            | (ValType::I64, ValType::I64)
            | (ValType::F32, ValType::F32)
            | (ValType::F64, ValType::F64)
            | (ValType::V128, ValType::V128)
    )
}

fn is_immutable_i32_global(export_type: &ExternType) -> bool {
    matches!(
        export_type,
        ExternType::Global(global)
            if matches!(global.content(), ValType::I32) && global.mutability().is_const()
    )
}

fn runtime_error(error: wasmtime::Error) -> WasmHostError {
    let diagnostic = format!("{error:#}");
    if diagnostic.contains("resource limit")
        || diagnostic.contains("growth operation limited")
        || diagnostic.contains("forcing trap when growing")
        || diagnostic.contains("forcing a memory growth failure")
        || diagnostic.contains("forcing a table growth failure")
        || diagnostic.contains("maximum concurrent")
    {
        WasmHostError::new(
            WasmHostErrorCode::ResourceLimit,
            "The plugin exceeded an isolated runtime resource limit.",
        )
    } else {
        WasmHostError::new(
            WasmHostErrorCode::GuestTrap,
            "The plugin trapped during isolated execution.",
        )
    }
}

fn export_mismatch() -> WasmHostError {
    WasmHostError::new(
        WasmHostErrorCode::ExportMismatch,
        "The module does not match the axiom-wasm-v1 export contract.",
    )
}

fn invalid_guest_pointer() -> WasmHostError {
    WasmHostError::new(
        WasmHostErrorCode::InvalidGuestPointer,
        "The plugin returned an invalid memory range.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const ABI_EXPORTS: &str = r#"
        (memory (export "memory") 1 1024)
        (global $heap (mut i32) (i32.const 1024))
        (func (export "axiom_abi_version") (result i32) i32.const 1)
        (func (export "axiom_alloc") (param $len i32) (result i32)
            global.get $heap
            global.get $heap
            local.get $len
            i32.add
            global.set $heap)
    "#;

    fn wasm(body: &str) -> Vec<u8> {
        wat::parse_str(format!("(module {ABI_EXPORTS} {body})")).unwrap()
    }

    fn echo_module() -> Vec<u8> {
        wasm(
            r#"(func (export "axiom_run") (param $ptr i32) (param $len i32) (result i64)
                local.get $ptr
                i64.extend_i32_u
                i64.const 32
                i64.shl
                local.get $len
                i64.extend_i32_u
                i64.or)"#,
        )
    }

    #[test]
    fn executes_a_valid_json_transform_in_a_fresh_store() {
        let host = NemotoWasmHost::new().unwrap();
        let input = br#"{"operation":"echo","value":42}"#;

        assert_eq!(host.execute_json(&echo_module(), input).unwrap(), input);
        assert_eq!(host.execute_json(&echo_module(), input).unwrap(), input);

        let rust_linker_metadata = wasm(
            r#"(global (export "__data_end") i32 (i32.const 1024))
                (global (export "__heap_base") i32 (i32.const 2048))
                (func (export "axiom_run") (param $ptr i32) (param $len i32) (result i64)
                    local.get $ptr
                    i64.extend_i32_u
                    i64.const 32
                    i64.shl
                    local.get $len
                    i64.extend_i32_u
                    i64.or)"#,
        );
        assert_eq!(
            host.execute_json(&rust_linker_metadata, input).unwrap(),
            input
        );
    }

    #[test]
    fn rejects_every_import_before_instantiation() {
        let source = format!(
            r#"(module
                (import "wasi_snapshot_preview1" "fd_write" (func))
                {ABI_EXPORTS}
                (func (export "axiom_run") (param i32 i32) (result i64) i64.const 0))"#
        );
        let module = wat::parse_str(source).unwrap();

        assert_eq!(
            NemotoWasmHost::new()
                .unwrap()
                .execute_json(&module, b"{}")
                .unwrap_err()
                .code,
            WasmHostErrorCode::ImportDenied
        );
    }

    #[test]
    fn rejects_wrong_exports_and_abi_versions() {
        let wrong_signature = wat::parse_str(
            r#"(module
                (memory (export "memory") 1 1024)
                (func (export "axiom_abi_version") (result i64) i64.const 1)
                (func (export "axiom_alloc") (param i32) (result i32) i32.const 0)
                (func (export "axiom_run") (param i32 i32) (result i64) i64.const 0))"#,
        )
        .unwrap();
        let wrong_version = wasm(
            r#"(func (export "axiom_run") (param i32 i32) (result i64) i64.const 0)
                (func (export "extra") (result i32) i32.const 0)"#,
        );
        let forged_rust_metadata = wasm(
            r#"(global (export "__heap_base") (mut i32) (i32.const 2048))
                (func (export "axiom_run") (param i32 i32) (result i64) i64.const 0)"#,
        );
        let host = NemotoWasmHost::new().unwrap();

        assert_eq!(
            host.execute_json(&wrong_signature, b"{}").unwrap_err().code,
            WasmHostErrorCode::ExportMismatch
        );
        assert_eq!(
            host.execute_json(&wrong_version, b"{}").unwrap_err().code,
            WasmHostErrorCode::ExportMismatch
        );
        assert_eq!(
            host.execute_json(&forged_rust_metadata, b"{}")
                .unwrap_err()
                .code,
            WasmHostErrorCode::ExportMismatch
        );

        let version_two = wat::parse_str(
            r#"(module
                (memory (export "memory") 1 1024)
                (func (export "axiom_abi_version") (result i32) i32.const 2)
                (func (export "axiom_alloc") (param i32) (result i32) i32.const 0)
                (func (export "axiom_run") (param i32 i32) (result i64) i64.const 0))"#,
        )
        .unwrap();
        assert_eq!(
            host.execute_json(&version_two, b"{}").unwrap_err().code,
            WasmHostErrorCode::AbiMismatch
        );
    }

    #[test]
    fn rejects_invalid_and_oversized_inputs_before_execution() {
        let host = NemotoWasmHost::new().unwrap();
        let oversized_module = vec![0; ISOLATED_COMPUTE_POLICY_V1.max_module_bytes + 1];
        let oversized_input = vec![b' '; ISOLATED_COMPUTE_POLICY_V1.max_input_bytes + 1];

        assert_eq!(
            host.execute_json(&oversized_module, b"{}")
                .unwrap_err()
                .code,
            WasmHostErrorCode::ModuleTooLarge
        );
        assert_eq!(
            host.execute_json(&echo_module(), &oversized_input)
                .unwrap_err()
                .code,
            WasmHostErrorCode::InputTooLarge
        );
        assert_eq!(
            host.execute_json(&echo_module(), b"not-json")
                .unwrap_err()
                .code,
            WasmHostErrorCode::InvalidInput
        );
        assert_eq!(
            host.execute_json(b"not-wasm", b"{}").unwrap_err().code,
            WasmHostErrorCode::InvalidModule
        );
    }

    #[test]
    fn reuses_and_bounds_the_host_owned_module_cache() {
        let host = NemotoWasmHost::new().unwrap();
        let base = echo_module();

        host.execute_json(&base, b"{}").unwrap();
        host.execute_json(&base, b"{}").unwrap();
        assert_eq!(host.module_cache.lock().unwrap().len(), 1);
        assert_eq!(
            host.execute_json(&base, br#"{"warm":true}"#).unwrap(),
            br#"{"warm":true}"#
        );
        assert_eq!(host.module_cache.lock().unwrap().len(), 1);

        for marker in 0_u8..9 {
            let mut distinct = base.clone();
            distinct.extend_from_slice(&[0, 2, 1, marker]);
            host.execute_json(&distinct, b"{}").unwrap();
        }
        assert_eq!(host.module_cache.lock().unwrap().len(), 8);
    }

    #[test]
    fn rejects_memory_and_table_resources_beyond_the_ceiling() {
        let too_large = wat::parse_str(
            r#"(module
                (memory (export "memory") 1025)
                (func (export "axiom_abi_version") (result i32) i32.const 1)
                (func (export "axiom_alloc") (param i32) (result i32) i32.const 0)
                (func (export "axiom_run") (param i32 i32) (result i64) i64.const 0))"#,
        )
        .unwrap();
        let grows_too_far = wasm(
            r#"(func (export "axiom_run") (param i32 i32) (result i64)
                i32.const 1024
                memory.grow
                drop
                i64.const 2)"#,
        );
        let table_too_large = wasm(
            r#"(table 10001 funcref)
                (func (export "axiom_run") (param i32 i32) (result i64)
                    i64.const 2)"#,
        );
        let host = NemotoWasmHost::new().unwrap();

        assert_eq!(
            host.execute_json(&too_large, b"{}").unwrap_err().code,
            WasmHostErrorCode::ResourceLimit
        );
        assert_eq!(
            host.execute_json(&grows_too_far, b"{}").unwrap_err().code,
            WasmHostErrorCode::ResourceLimit
        );
        assert_eq!(
            host.execute_json(&table_too_large, b"{}").unwrap_err().code,
            WasmHostErrorCode::ResourceLimit
        );
    }

    #[test]
    fn stops_infinite_guests_with_fuel() {
        let infinite = wasm(
            r#"(func (export "axiom_run") (param i32 i32) (result i64)
                (loop $forever br $forever)
                i64.const 0)"#,
        );

        assert_eq!(
            NemotoWasmHost::new()
                .unwrap()
                .execute_json(&infinite, b"{}")
                .unwrap_err()
                .code,
            WasmHostErrorCode::FuelExhausted
        );
    }

    #[test]
    fn bounds_guest_start_code_before_the_instance_is_available() {
        let source = format!(
            r#"(module
                {ABI_EXPORTS}
                (func $start (loop $forever br $forever))
                (start $start)
                (func (export "axiom_run") (param i32 i32) (result i64) i64.const 0))"#
        );
        let infinite_start = wat::parse_str(source).unwrap();

        assert_eq!(
            NemotoWasmHost::new()
                .unwrap()
                .execute_json(&infinite_start, b"{}")
                .unwrap_err()
                .code,
            WasmHostErrorCode::FuelExhausted
        );
    }

    #[test]
    fn stops_infinite_guests_with_a_wall_clock_deadline() {
        let infinite = wasm(
            r#"(func (export "axiom_run") (param i32 i32) (result i64)
                (loop $forever br $forever)
                i64.const 0)"#,
        );
        let mut deadline_policy = ISOLATED_COMPUTE_POLICY_V1;
        deadline_policy.fuel_per_entrypoint = u64::MAX;
        deadline_policy.wall_time_per_entrypoint_ms = 20;

        assert_eq!(
            NemotoWasmHost::with_policy(deadline_policy)
                .unwrap()
                .execute_json(&infinite, b"{}")
                .unwrap_err()
                .code,
            WasmHostErrorCode::DeadlineExceeded
        );
    }

    #[test]
    fn contains_traps_and_invalid_guest_ranges() {
        let trap = wasm(
            r#"(func (export "axiom_run") (param i32 i32) (result i64)
                unreachable)"#,
        );
        let oversized_output = wasm(&format!(
            r#"(func (export "axiom_run") (param i32 i32) (result i64)
                i64.const {})"#,
            ISOLATED_COMPUTE_POLICY_V1.max_output_bytes + 1
        ));
        let invalid_range = wasm(
            r#"(func (export "axiom_run") (param i32 i32) (result i64)
                i64.const -4294967295)"#,
        );
        let host = NemotoWasmHost::new().unwrap();

        assert_eq!(
            host.execute_json(&trap, b"{}").unwrap_err().code,
            WasmHostErrorCode::GuestTrap
        );
        assert_eq!(
            host.execute_json(&oversized_output, b"{}")
                .unwrap_err()
                .code,
            WasmHostErrorCode::OutputTooLarge
        );
        assert_eq!(
            host.execute_json(&invalid_range, b"{}").unwrap_err().code,
            WasmHostErrorCode::InvalidGuestPointer
        );
    }

    #[test]
    fn contains_guest_stack_exhaustion() {
        let recursive = wasm(
            r#"(func $recurse (result i64) call $recurse)
                (func (export "axiom_run") (param i32 i32) (result i64)
                    call $recurse)"#,
        );

        assert_eq!(
            NemotoWasmHost::new()
                .unwrap()
                .execute_json(&recursive, b"{}")
                .unwrap_err()
                .code,
            WasmHostErrorCode::GuestTrap
        );
    }

    #[test]
    fn rejects_non_json_guest_output() {
        let invalid_output = wasm(
            r#"(func (export "axiom_run") (param i32 i32) (result i64)
                i64.const 1)"#,
        );

        assert_eq!(
            NemotoWasmHost::new()
                .unwrap()
                .execute_json(&invalid_output, b"{}")
                .unwrap_err()
                .code,
            WasmHostErrorCode::InvalidOutput
        );
    }

    #[test]
    #[ignore = "built and run by npm run verify:wasm-sdk"]
    fn rust_sdk_reference_plugin_conforms() {
        let fixture_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../sdk/rust/target/wasm32-unknown-unknown/release/axiom_wasm_echo.wasm");
        let module = std::fs::read(&fixture_path).unwrap_or_else(|error| {
            panic!(
                "Rust SDK fixture is missing at {}: {error}",
                fixture_path.display()
            )
        });
        let input = br#"{
            "schema":"axiom.wasm-invocation",
            "schemaVersion":1,
            "sessionId":"wasm-session:conformance",
            "authorityScopeId":"portfolio:conformance",
            "authorityGeneration":1,
            "capability":"compute.isolated",
            "identity":{
                "pluginId":"com.axiom.echo",
                "pluginVersion":"0.1.0",
                "dataVersion":1
            },
            "sequence":1,
            "operation":"echo",
            "payload":{
                "schema":"axiom.wasm-compute-request",
                "schemaVersion":1,
                "requestId":"compute:conformance:1",
                "baseRevision":"portfolio-revision-aabbccdd",
                "portfolioRevision":1,
                "snapshots":[],
                "parameters":{"message":"hello","count":3}
            }
        }"#;
        let output = NemotoWasmHost::new()
            .unwrap()
            .execute_json(&module, input)
            .unwrap();
        let response: serde_json::Value = serde_json::from_slice(&output).unwrap();

        assert_eq!(
            response,
            serde_json::json!({
                "schema": "axiom.wasm-compute-result",
                "schemaVersion": 1,
                "requestId": "compute:conformance:1",
                "baseRevision": "portfolio-revision-aabbccdd",
                "output": {
                    "message": "hello",
                    "count": 3,
                    "sdk": NEMOTO_WASM_ABI_NAME,
                }
            })
        );
    }
}
