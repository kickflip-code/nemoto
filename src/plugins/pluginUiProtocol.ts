import { z } from 'zod';
import type { PluginCapability } from './manifest';

/** ADR-034: reserved protocol, not a runtime availability or permission grant. */
export const PLUGIN_UI_MINIMUM_HOST_API = '1.8.0';
export const PLUGIN_UI_PROTOCOL_VERSION = 1;
export const PLUGIN_UI_LIMITS = Object.freeze({
    requestBytes: 240 * 1024,
    resultBytes: 512 * 1024,
    stateBytes: 64 * 1024,
    eventBytes: 64 * 1024,
    treeBytes: 256 * 1024,
    treeNodes: 1_000,
    treeDepth: 16,
    childrenPerNode: 100,
    effectsPerResult: 16,
    storageBatchesPerResult: 1,
    snapshotPageBytes: 64 * 1024,
    snapshotPageItems: 100,
    queuedEvents: 32,
    inFlightPerInstance: 1,
    instancesPerPlugin: 2,
    reductionsPerSecond: 20,
    reductionsPerMinute: 600,
    deadlineMs: 1_000,
    textOutputBytes: 128 * 1024,
});

export const PluginUiPrimitiveSchema = z.enum([
    'stack', 'grid', 'text', 'button', 'text-input', 'date-input',
    'checkbox', 'select', 'list', 'dialog', 'rich-text', 'form', 'presentation',
]);

export const PluginUiEffectSchema = z.enum([
    'read.search', 'read.entity', 'read.relations',
    'storage.collection.read-page', 'storage.collection.query-page', 'storage.collection.transact',
    'storage.document.get', 'storage.document.list', 'storage.document.transact',
    'workspace.context', 'workspace.open',
    'output.text-file', 'output.clipboard-text', 'output.text-buffer', 'notice.show',
]);

const UI_EFFECT_CAPABILITIES: Readonly<Record<string, readonly PluginCapability[]>> = Object.freeze({
    'read.search': ['portfolio.read-scoped'],
    'read.entity': ['portfolio.read-scoped'],
    'read.relations': ['portfolio.read-scoped'],
    'storage.collection.read-page': [],
    'storage.collection.query-page': ['portfolio.read-scoped'],
    'storage.collection.transact': ['plugin-data.write'],
    'storage.document.get': [],
    'storage.document.list': [],
    'storage.document.transact': ['plugin-data.write'],
    'workspace.context': ['portfolio.read-scoped'],
    'workspace.open': ['workspace.navigate'],
    'output.text-file': ['file.write-selected'],
    'output.clipboard-text': ['clipboard.write'],
    'output.text-buffer': [],
    'notice.show': [],
});

export function requiredCapabilitiesForPluginUiEffect(effect: string): readonly PluginCapability[] {
    const capabilities = UI_EFFECT_CAPABILITIES[effect];
    if (!capabilities) throw new Error(`Unsupported composed UI effect ${effect}.`);
    return capabilities;
}

/** Public requirement shape only. Parsing it never enables execution. */
export const PluginUiProtocolRequirementSchema = z.object({
    schema: z.literal('axiom.plugin-ui'),
    schemaVersion: z.literal(1),
    protocolVersion: z.literal(PLUGIN_UI_PROTOCOL_VERSION),
    treeVersion: z.literal(1),
    effectsVersion: z.literal(1),
    abi: z.literal('axiom-wasm-v1'),
    requiredPrimitives: z.array(PluginUiPrimitiveSchema).min(1)
        .max(PluginUiPrimitiveSchema.options.length)
        .refine(values => new Set(values).size === values.length),
    requiredEffects: z.array(PluginUiEffectSchema)
        .max(PluginUiEffectSchema.options.length)
        .refine(values => new Set(values).size === values.length),
}).strict();

export type PluginUiProtocolRequirement = z.infer<typeof PluginUiProtocolRequirementSchema>;

export function requiredCapabilitiesForPluginUi(
    requirement: PluginUiProtocolRequirement,
): PluginCapability[] {
    const capabilities = new Set<PluginCapability>(['compute.isolated']);
    requirement.requiredEffects.forEach(effect => {
        requiredCapabilitiesForPluginUiEffect(effect).forEach(capability => capabilities.add(capability));
    });
    return [...capabilities].sort();
}
