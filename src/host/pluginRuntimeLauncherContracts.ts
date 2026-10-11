import { z } from 'zod';
import { StableContractIdSchema } from '../plugins/identifiers';
import { MAX_PLUGIN_RUNTIME_SOURCE_BYTES } from '../plugins/pluginLimits';

export const CURRENT_PLUGIN_RUNTIME_LAUNCHER_PROTOCOL_VERSION = 1;

const LauncherSessionSchema = {
    schemaVersion: z.literal(CURRENT_PLUGIN_RUNTIME_LAUNCHER_PROTOCOL_VERSION),
    sessionId: StableContractIdSchema,
};

const boundedSource = z.string().min(1).superRefine((source, context) => {
    if (new TextEncoder().encode(source).byteLength > MAX_PLUGIN_RUNTIME_SOURCE_BYTES) {
        context.addIssue({
            code: 'custom',
            message: `Runtime source may contain at most ${MAX_PLUGIN_RUNTIME_SOURCE_BYTES} UTF-8 bytes.`,
        });
    }
});

export const PluginRuntimeLaunchMessageSchema = z.object({
    schema: z.literal('axiom.plugin-runtime-launch'),
    ...LauncherSessionSchema,
    kind: z.literal('launch'),
    launchToken: StableContractIdSchema,
    source: boundedSource,
}).strict();

export const PluginRuntimeLauncherControlMessageSchema = z.discriminatedUnion('kind', [
    z.object({
        schema: z.literal('axiom.plugin-runtime-launcher-control'),
        ...LauncherSessionSchema,
        kind: z.literal('ping'),
        sequence: z.number().int().nonnegative(),
    }).strict(),
    z.object({
        schema: z.literal('axiom.plugin-runtime-launcher-control'),
        ...LauncherSessionSchema,
        kind: z.literal('terminate'),
    }).strict(),
]);

export const PluginRuntimeLauncherFailureCodeSchema = z.enum([
    'INVALID_LAUNCH',
    'AMBIENT_AUTHORITY_PRESENT',
    'WORKER_START_FAILED',
    'WORKER_BOOTSTRAP_FAILED',
    'WORKER_RUNTIME_FAILED',
    'WORKER_MESSAGE_ERROR',
    'RUNTIME_UNRESPONSIVE',
]);

const LauncherStatusBaseSchema = {
    schema: z.literal('axiom.plugin-runtime-launcher-status'),
    ...LauncherSessionSchema,
};

export const PluginRuntimeLauncherStatusMessageSchema = z.discriminatedUnion('kind', [
    z.object({
        ...LauncherStatusBaseSchema,
        kind: z.literal('worker-started'),
    }).strict(),
    z.object({
        ...LauncherStatusBaseSchema,
        kind: z.literal('ready'),
    }).strict(),
    z.object({
        ...LauncherStatusBaseSchema,
        kind: z.literal('pong'),
        sequence: z.number().int().nonnegative(),
    }).strict(),
    z.object({
        ...LauncherStatusBaseSchema,
        kind: z.literal('terminated'),
    }).strict(),
    z.object({
        ...LauncherStatusBaseSchema,
        kind: z.literal('failed'),
        error: z.object({
            code: PluginRuntimeLauncherFailureCodeSchema,
            message: z.string().trim().min(1).max(300),
        }).strict(),
    }).strict(),
]);

export type PluginRuntimeLaunchMessage = z.infer<typeof PluginRuntimeLaunchMessageSchema>;
export type PluginRuntimeLauncherControlMessage = z.infer<
    typeof PluginRuntimeLauncherControlMessageSchema
>;
export type PluginRuntimeLauncherFailureCode = z.infer<
    typeof PluginRuntimeLauncherFailureCodeSchema
>;
export type PluginRuntimeLauncherStatusMessage = z.infer<
    typeof PluginRuntimeLauncherStatusMessageSchema
>;

export const parsePluginRuntimeLaunchMessage = (value: unknown): PluginRuntimeLaunchMessage => (
    PluginRuntimeLaunchMessageSchema.parse(value)
);

export const parsePluginRuntimeLauncherControlMessage = (
    value: unknown,
): PluginRuntimeLauncherControlMessage => PluginRuntimeLauncherControlMessageSchema.parse(value);

export const parsePluginRuntimeLauncherStatusMessage = (
    value: unknown,
): PluginRuntimeLauncherStatusMessage => PluginRuntimeLauncherStatusMessageSchema.parse(value);
