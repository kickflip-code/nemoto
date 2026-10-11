import { z } from 'zod';
import { PluginCapabilitySchema, PluginManifestSchema } from './manifest';
import type { PluginCapability } from './manifest';

export const InstalledPluginDocumentSchema = z.object({
    schema: z.literal('axiom.installed-plugin'),
    schemaVersion: z.literal(1),
    installedAt: z.string().datetime(),
    manifest: PluginManifestSchema,
    grantedCapabilities: z.array(PluginCapabilitySchema).max(32),
    approvedInteractiveOperations: z.array(z.string().trim().min(1).max(240)
        .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:@/-]*[A-Za-z0-9])?$/)).max(100)
        .refine(values => new Set(values).size === values.length).optional().default([]),
    contributions: z.record(z.string(), z.unknown()),
}).strict().superRefine((document, context) => {
    const declared = new Set(document.manifest.capabilities);
    const granted = new Set<string>();
    document.grantedCapabilities.forEach((capability, index) => {
        if (!declared.has(capability)) {
            context.addIssue({
                code: 'custom',
                path: ['grantedCapabilities', index],
                message: `Capability ${capability} was not declared by the plugin.`,
            });
        }
        if (granted.has(capability)) {
            context.addIssue({
                code: 'custom',
                path: ['grantedCapabilities', index],
                message: `Capability ${capability} was granted more than once.`,
            });
        }
        granted.add(capability);
    });
}).readonly();

export type InstalledPluginDocument = z.infer<typeof InstalledPluginDocumentSchema>;

export function hasInstalledPluginGrant(
    installed: readonly InstalledPluginDocument[],
    pluginId: string,
    capability: PluginCapability,
): boolean {
    return installed.some(document => (
        document.manifest.id === pluginId
        && document.grantedCapabilities.includes(capability)
    ));
}
