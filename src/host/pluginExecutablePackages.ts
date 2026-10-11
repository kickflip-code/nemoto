import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import {
    ExecutablePackageInstallResponseSchema,
    ExecutablePackageReviewSchema,
    WasmPluginIdentitySchema,
    type ExecutableInstallApproval,
    type ExecutablePackageInstallResponse,
    type ExecutablePackageReview,
} from '../plugins/executablePackageConsent';
import { PluginCapabilitySchema } from '../plugins/manifest';
import { PluginUiResultSchema, type PluginUiInput } from '../plugins/pluginUiContracts';

const ExecutablePluginUiReductionOutcomeSchema = z.object({
    schema: z.literal('axiom.executable-plugin-ui-reduction-result'),
    schemaVersion: z.literal(1),
    viewId: z.string().min(3).max(240),
    identity: WasmPluginIdentitySchema,
    authorityGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    effectiveCapabilities: z.array(PluginCapabilitySchema).max(32)
        .refine(values => new Set(values).size === values.length),
    result: PluginUiResultSchema,
}).strict().readonly();

export type ExecutablePluginUiReductionOutcome = z.infer<typeof ExecutablePluginUiReductionOutcomeSchema>;

export async function inspectExecutablePluginPackage(
    path: string,
): Promise<ExecutablePackageReview> {
    return ExecutablePackageReviewSchema.parse(
        await invoke<unknown>('inspect_executable_plugin_package', { path }),
    );
}

export async function installExecutablePluginPackage(
    path: string,
    approval: ExecutableInstallApproval,
): Promise<ExecutablePackageInstallResponse> {
    return ExecutablePackageInstallResponseSchema.parse(
        await invoke<unknown>('install_executable_plugin_package', { path, approval }),
    );
}

export async function runExecutablePluginUiReduction(
    viewId: string,
    input: PluginUiInput,
): Promise<ExecutablePluginUiReductionOutcome> {
    return ExecutablePluginUiReductionOutcomeSchema.parse(
        await invoke<unknown>('run_executable_plugin_ui_reduction', {
            request: {
                schema: 'axiom.executable-plugin-ui-reduction',
                schemaVersion: 1,
                viewId,
                inputJson: JSON.stringify(input),
            },
        }),
    );
}
