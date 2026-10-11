//! Normative resource ceiling for the native-hosted executable plugin runtime.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IsolatedComputePolicy {
    pub policy_version: u32,
    pub max_module_bytes: usize,
    pub max_input_bytes: usize,
    pub max_output_bytes: usize,
    pub max_linear_memory_bytes: usize,
    pub max_memories: usize,
    pub max_instances: usize,
    pub max_tables: usize,
    pub max_table_elements: usize,
    pub max_wasm_stack_bytes: usize,
    pub fuel_per_entrypoint: u64,
    pub wall_time_per_entrypoint_ms: u64,
}

pub const ISOLATED_COMPUTE_POLICY_V1: IsolatedComputePolicy = IsolatedComputePolicy {
    policy_version: 1,
    max_module_bytes: 8 * 1024 * 1024,
    max_input_bytes: 256 * 1024,
    max_output_bytes: 2 * 1024 * 1024,
    max_linear_memory_bytes: 64 * 1024 * 1024,
    max_memories: 1,
    max_instances: 1,
    max_tables: 1,
    max_table_elements: 10_000,
    max_wasm_stack_bytes: 512 * 1024,
    fuel_per_entrypoint: 10_000_000,
    wall_time_per_entrypoint_ms: 5_000,
};

#[cfg(test)]
mod tests {
    use super::ISOLATED_COMPUTE_POLICY_V1 as policy;

    #[test]
    fn executable_plugin_policy_v1_is_conservative_and_hard_bounded() {
        assert_eq!(policy.policy_version, 1);
        assert_eq!(policy.max_module_bytes, 8_388_608);
        assert_eq!(policy.max_input_bytes, 262_144);
        assert_eq!(policy.max_output_bytes, 2_097_152);
        assert_eq!(policy.max_linear_memory_bytes, 67_108_864);
        assert_eq!(policy.max_memories, 1);
        assert_eq!(policy.max_instances, 1);
        assert_eq!(policy.max_tables, 1);
        assert_eq!(policy.max_table_elements, 10_000);
        assert_eq!(policy.max_wasm_stack_bytes, 524_288);
        assert_eq!(policy.fuel_per_entrypoint, 10_000_000);
        assert_eq!(policy.wall_time_per_entrypoint_ms, 5_000);
    }

    #[test]
    fn memory_and_module_ceilings_are_power_of_two_byte_limits() {
        assert!(policy.max_module_bytes.is_power_of_two());
        assert!(policy.max_input_bytes.is_power_of_two());
        assert!(policy.max_output_bytes.is_power_of_two());
        assert!(policy.max_linear_memory_bytes.is_power_of_two());
        assert!(policy.max_wasm_stack_bytes.is_power_of_two());
    }
}
