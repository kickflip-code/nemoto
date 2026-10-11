import { z } from 'zod';
import type { PluginContributionFamily } from './contributions';
import { JsonValueSchema } from './semanticData';
import { CoreEntityKindSchema } from './universalReference';
import { StableContractIdSchema } from './identifiers';
import { PluginUiProtocolRequirementSchema } from './pluginUiProtocol';

export const CURRENT_PLUGIN_CONTRIBUTION_SCHEMA_VERSION = 1;

const contributionBase = <TSchema extends string>(schema: TSchema) => z.object({
    schema: z.literal(schema),
    schemaVersion: z.literal(CURRENT_PLUGIN_CONTRIBUTION_SCHEMA_VERSION),
    id: z.string().trim().min(3).max(240),
}).strict();

export const PluginVocabularyContributionSchema = contributionBase('axiom.plugin.vocabulary').extend({
    terms: z.array(z.object({
        term: z.string().trim().min(1).max(120),
        definition: z.string().trim().min(1).max(1000),
        synonyms: z.array(z.string().trim().min(1).max(120)).max(20).optional().default([]),
    }).strict()).min(1).max(500),
}).strict();

export const PluginQuestionSetContributionSchema = contributionBase('axiom.plugin.question-set').extend({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1000),
    questions: z.array(z.object({
        id: z.string().trim().min(1).max(120),
        prompt: z.string().trim().min(1).max(1000),
        purpose: z.string().trim().min(1).max(1000),
    }).strict()).min(1).max(100),
}).strict();

export const PluginTemplateContributionSchema = contributionBase('axiom.plugin.template').extend({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1000),
    sections: z.array(z.object({
        id: z.string().trim().min(1).max(120),
        heading: z.string().trim().min(1).max(160),
        guidance: z.string().trim().min(1).max(1000),
    }).strict()).min(1).max(50),
}).strict();

export const PluginAiProfileContributionSchema = contributionBase('axiom.plugin.ai-profile').extend({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1000),
    mode: z.literal('read-only-adviser'),
    status: z.enum(['contract-only', 'ready']),
    instructions: z.string().trim().min(1).max(4000),
    context: z.object({
        scope: z.enum([
            'selected-resource-journey',
            'selected-resource-evidence',
        ]),
        include: z.array(z.enum([
            'resource',
            'processes',
            'steps',
            'related-resources',
            'linked-notes',
        ])).min(1).max(5),
    }).strict(),
    output: z.object({
        kind: z.literal('source-linked-proposals'),
        directMutation: z.literal(false),
    }).strict(),
}).strict().superRefine((profile, context) => {
    const includes = new Set(profile.context.include);
    if (includes.size !== profile.context.include.length) {
        context.addIssue({
            code: 'custom',
            path: ['context', 'include'],
            message: 'AI context include values must be unique.',
        });
    }
    if (!includes.has('resource')) {
        context.addIssue({
            code: 'custom',
            path: ['context', 'include'],
            message: 'Selected-resource AI scopes must include the selected resource.',
        });
    }
});

const PluginViewNavigationSchema = z.object({
    surface: z.literal('app-rail'),
    label: z.string().trim().min(1).max(80),
    icon: z.enum(['GraduationCap', 'ShieldCheck', 'ClipboardCheck', 'Puzzle']),
    order: z.number().int().min(0).max(1000),
}).strict();

const GuidedResourceJourneyViewSchema = contributionBase('axiom.plugin.view').extend({
    renderer: z.literal('guided-resource-journey'),
    navigation: PluginViewNavigationSchema,
    scope: z.object({
        assetBaseType: z.literal('role'),
        selectorLabel: z.string().trim().min(1).max(120),
    }).strict(),
    content: z.object({
        eyebrow: z.string().trim().min(1).max(80),
        title: z.string().trim().min(1).max(160),
        description: z.string().trim().min(1).max(1000),
        emptyTitle: z.string().trim().min(1).max(160),
        emptyDescription: z.string().trim().min(1).max(1000),
        touchpointsTitle: z.string().trim().min(1).max(160),
        knowledgeTitle: z.string().trim().min(1).max(160),
    }).strict(),
    questionSetId: z.string().trim().min(3).max(240),
    templateId: z.string().trim().min(3).max(240),
    aiProfileId: z.string().trim().min(3).max(240),
}).strict();

export const PluginCollectionFieldSchema = z.object({
    key: z.string().trim().min(1).max(80).regex(/^[a-z][a-zA-Z0-9]*$/),
    label: z.string().trim().min(1).max(80),
    type: z.enum(['text', 'boolean', 'date']),
    required: z.boolean().optional().default(false),
    placeholder: z.string().trim().max(160).optional(),
    maxLength: z.number().int().min(1).max(2000).optional(),
}).strict();

const CollectionListViewSchema = contributionBase('axiom.plugin.view').extend({
    renderer: z.literal('collection-list'),
    contextual: z.object({
        completionField: z.string().min(1).max(80),
        dueDateField: z.string().min(1).max(80),
        quickAddLabel: z.string().trim().min(1).max(80),
        indicator: z.object({
            referenceKind: z.literal('core.node'),
            aggregation: z.literal('count'),
            where: z.object({
                field: z.string().min(1).max(80),
                equals: z.union([z.string().max(2000), z.boolean()]),
            }).strict(),
            icon: z.enum(['GraduationCap', 'ShieldCheck', 'ClipboardCheck', 'Puzzle']),
            label: z.object({
                singular: z.string().trim().min(1).max(80),
                plural: z.string().trim().min(1).max(80),
            }).strict(),
        }).strict().optional(),
    }).strict().optional(),
    navigation: PluginViewNavigationSchema,
    content: z.object({
        eyebrow: z.string().trim().min(1).max(80),
        title: z.string().trim().min(1).max(160),
        description: z.string().trim().max(1000).optional().default(''),
        emptyTitle: z.string().trim().min(1).max(160),
        emptyDescription: z.string().trim().min(1).max(1000),
        addLabel: z.string().trim().min(1).max(80),
    }).strict(),
    collection: z.object({
        id: z.string().trim().min(1).max(80).regex(/^[a-z][a-zA-Z0-9-]*$/),
        itemLabel: z.string().trim().min(1).max(80),
        primaryField: z.string().trim().min(1).max(80),
        fields: z.array(PluginCollectionFieldSchema).min(1).max(12),
    }).strict(),
}).strict().superRefine((view, context) => {
    const fieldKeys = new Set<string>();
    view.collection.fields.forEach((field, index) => {
        if (fieldKeys.has(field.key)) {
            context.addIssue({
                code: 'custom',
                path: ['collection', 'fields', index, 'key'],
                message: `Duplicate collection field: ${field.key}.`,
            });
        }
        fieldKeys.add(field.key);
    });

    const primaryField = view.collection.fields.find(field => field.key === view.collection.primaryField);
    if (view.contextual) {
        for (const [key, type] of [[view.contextual.completionField, 'boolean'], [view.contextual.dueDateField, 'date']]) {
            if (!view.collection.fields.some(field => field.key === key && field.type === type)) {
                context.addIssue({ code: 'custom', path: ['contextual'], message: 'Contextual fields must reference declared boolean and date fields.' });
            }
        }
        const indicator = view.contextual.indicator;
        if (indicator) {
            const field = view.collection.fields.find(candidate => candidate.key === indicator.where.field);
            const expectedType = typeof indicator.where.equals === 'boolean' ? 'boolean' : 'text-or-date';
            if (!field || (expectedType === 'boolean' ? field.type !== 'boolean' : field.type === 'boolean')) {
                context.addIssue({
                    code: 'custom',
                    path: ['contextual', 'indicator', 'where'],
                    message: 'The indicator predicate must match a declared scalar field type.',
                });
            }
        }
    }
    if (!primaryField || primaryField.type !== 'text') {
        context.addIssue({
            code: 'custom',
            path: ['collection', 'primaryField'],
            message: 'The primary field must reference a declared text field.',
        });
    }
});

export type PluginCollectionListView = z.infer<typeof CollectionListViewSchema>;
export type PluginCollectionField = z.infer<typeof PluginCollectionFieldSchema>;

const SearchResultsViewSchema = contributionBase('axiom.plugin.view').extend({
    renderer: z.literal('search-results'),
    navigation: PluginViewNavigationSchema,
    content: z.object({
        eyebrow: z.string().trim().min(1).max(80),
        title: z.string().trim().min(1).max(160),
        description: z.string().trim().min(1).max(1000),
        emptyTitle: z.string().trim().min(1).max(160),
        emptyDescription: z.string().trim().min(1).max(1000),
    }).strict(),
    query: z.object({
        text: z.string().trim().min(1).max(240),
        kinds: z.array(CoreEntityKindSchema).min(1).max(20).optional(),
        limit: z.number().int().min(1).max(100).optional().default(50),
    }).strict(),
    openAction: z.enum(['reveal', 'inspect']).optional(),
}).strict().superRefine((view, context) => {
    if (view.query.kinds && new Set(view.query.kinds).size !== view.query.kinds.length) {
        context.addIssue({
            code: 'custom',
            path: ['query', 'kinds'],
            message: 'Search result entity kinds must be unique.',
        });
    }
});

export type PluginSearchResultsView = z.infer<typeof SearchResultsViewSchema>;

const ComposedViewSchema = contributionBase('axiom.plugin.view').extend({
    renderer: z.literal('composed-view'),
    navigation: PluginViewNavigationSchema,
    operation: StableContractIdSchema,
    storageViewId: StableContractIdSchema,
    ui: PluginUiProtocolRequirementSchema,
}).strict();

export type PluginComposedView = z.infer<typeof ComposedViewSchema>;

export const PluginViewContributionSchema = z.discriminatedUnion('renderer', [
    GuidedResourceJourneyViewSchema,
    CollectionListViewSchema,
    SearchResultsViewSchema,
    ComposedViewSchema,
]);

const PluginCommandActionSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('navigation.open-view'),
        viewId: z.string().trim().min(3).max(240),
    }).strict(),
    z.object({
        kind: z.literal('compute.propose'),
        operation: z.string().trim().min(1).max(240).regex(
            /^[A-Za-z0-9](?:[A-Za-z0-9._:@/-]*[A-Za-z0-9])?$/,
            'Compute operation IDs must be portable stable IDs.',
        ),
        context: z.object({
            kind: z.enum(['active-process', 'selected-entity']),
        }).strict(),
        parameters: JsonValueSchema.optional().default({}),
    }).strict(),
]);

export const PluginCommandContributionSchema = contributionBase('axiom.plugin.command').extend({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500).optional(),
    keywords: z.array(z.string().trim().min(1).max(80)).max(20).optional().default([]),
    placement: z.literal('omnibox'),
    order: z.number().int().min(0).max(1000).optional().default(500),
    action: PluginCommandActionSchema,
}).strict().superRefine((command, context) => {
    const normalizedKeywords = new Set<string>();
    command.keywords.forEach((keyword, index) => {
        const normalized = keyword.toLocaleLowerCase();
        if (normalizedKeywords.has(normalized)) {
            context.addIssue({
                code: 'custom',
                path: ['keywords', index],
                message: `Duplicate command keyword: ${keyword}.`,
            });
        }
        normalizedKeywords.add(normalized);
    });
});

export type PluginCommandContribution = z.infer<typeof PluginCommandContributionSchema>;

export interface PluginContributionPayloadByFamily {
    vocabularies: z.infer<typeof PluginVocabularyContributionSchema>;
    questionSets: z.infer<typeof PluginQuestionSetContributionSchema>;
    templates: z.infer<typeof PluginTemplateContributionSchema>;
    aiProfiles: z.infer<typeof PluginAiProfileContributionSchema>;
    views: z.infer<typeof PluginViewContributionSchema>;
    commands: PluginCommandContribution;
}

export type SupportedPluginContributionFamily = keyof PluginContributionPayloadByFamily;
export type PluginContributionPayload = PluginContributionPayloadByFamily[SupportedPluginContributionFamily];

export const PLUGIN_CONTRIBUTION_SCHEMAS: {
    [TFamily in SupportedPluginContributionFamily]: z.ZodType<PluginContributionPayloadByFamily[TFamily]>;
} = {
    vocabularies: PluginVocabularyContributionSchema,
    questionSets: PluginQuestionSetContributionSchema,
    templates: PluginTemplateContributionSchema,
    aiProfiles: PluginAiProfileContributionSchema,
    views: PluginViewContributionSchema,
    commands: PluginCommandContributionSchema,
};

export const isSupportedContributionFamily = (
    family: PluginContributionFamily,
): family is SupportedPluginContributionFamily => family in PLUGIN_CONTRIBUTION_SCHEMAS;
