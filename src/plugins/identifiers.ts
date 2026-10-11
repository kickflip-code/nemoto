import { z } from 'zod';

export const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
export const CONTRIBUTION_SUFFIX_PATTERN = /^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/;
export const SEMANTIC_TYPE_SUFFIX_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const PluginIdSchema = z.string()
    .trim()
    .min(3)
    .max(160)
    .regex(PLUGIN_ID_PATTERN, 'Plugin ID must be a lowercase reverse-domain identifier.');

export const SemanticVersionSchema = z.string()
    .trim()
    .regex(SEMVER_PATTERN, 'Plugin version must be a semantic version such as 1.0.0.');

export const StableContractIdSchema = z.string()
    .trim()
    .min(1)
    .max(240)
    .regex(
        /^[A-Za-z0-9](?:[A-Za-z0-9._:@/-]*[A-Za-z0-9])?$/,
        'IDs may only contain portable letters, numbers, dots, underscores, colons, at signs, slashes, and hyphens.',
    );

export const PluginOwnedTypeSchema = z.string()
    .trim()
    .min(5)
    .max(240)
    .superRefine((value, context) => {
        const separator = value.indexOf('/');
        const pluginId = separator > 0 ? value.slice(0, separator) : '';
        const localType = separator > 0 ? value.slice(separator + 1) : '';

        if (!PLUGIN_ID_PATTERN.test(pluginId) || !SEMANTIC_TYPE_SUFFIX_PATTERN.test(localType)) {
            context.addIssue({
                code: 'custom',
                message: 'Semantic types must use <reverse-domain-plugin-id>/<local-type>.',
            });
        }
    });

export const getOwningPluginId = (qualifiedType: string): string | null => {
    const separator = qualifiedType.indexOf('/');
    if (separator <= 0) return null;
    const pluginId = qualifiedType.slice(0, separator);
    return PLUGIN_ID_PATTERN.test(pluginId) ? pluginId : null;
};

