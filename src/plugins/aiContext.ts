import { z } from 'zod';
import type { Portfolio } from '../types';
import type { PluginAiProfileContributionSchema } from './contributionSchemas';
import { JsonObjectSchema } from './semanticData';
import {
    UniversalEntityReferenceSchema,
    coreEntityReference,
} from './universalReference';
import { createRoleJourneyProjection } from './readModel';

export const CURRENT_AI_CONTEXT_SCHEMA_VERSION = 1;
export const DEFAULT_AI_CONTEXT_MAX_CHARACTERS = 40_000;
export const DEFAULT_AI_CONTEXT_MAX_SOURCES = 100;

type AiProfile = z.infer<typeof PluginAiProfileContributionSchema>;
type AiContextInclude = AiProfile['context']['include'][number];

export const AiContextSourceSchema = z.object({
    sourceId: z.string().trim().min(1).max(240),
    category: z.enum([
        'resource',
        'process',
        'step',
        'related-resource',
        'linked-note',
    ]),
    label: z.string().trim().min(1).max(500),
    reference: UniversalEntityReferenceSchema,
    data: JsonObjectSchema,
}).strict();

export const AiContextProjectionSchema = z.object({
    schema: z.literal('axiom.ai-context'),
    schemaVersion: z.literal(CURRENT_AI_CONTEXT_SCHEMA_VERSION),
    projection: z.literal('selected-role'),
    projectionVersion: z.literal(1),
    scope: z.enum([
        'selected-resource-journey',
        'selected-resource-evidence',
    ]),
    baseRevision: z.string().trim().min(1).max(240),
    selectionSourceId: z.string().trim().min(1).max(240),
    sources: z.array(AiContextSourceSchema).min(1).max(DEFAULT_AI_CONTEXT_MAX_SOURCES),
    limits: z.object({
        maximumCharacters: z.number().int().positive(),
        maximumSources: z.number().int().positive(),
        includedCharacters: z.number().int().nonnegative(),
        omittedSources: z.number().int().nonnegative(),
        truncated: z.boolean(),
    }).strict(),
}).strict();

export type AiContextProjection = z.infer<typeof AiContextProjectionSchema>;
export type AiContextSource = z.infer<typeof AiContextSourceSchema>;

export interface AiContextProjectionOptions {
    maximumCharacters?: number;
    maximumSources?: number;
}

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.freeze(value);
};

const decodeBasicHtmlEntities = (value: string): string => value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const notePlainText = (content: string): string => decodeBasicHtmlEntities(content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4_000);

const nodeSourceId = (processId: string, graphId: string, nodeId: string): string => (
    `node:${processId}:${graphId}:${nodeId}`
);

/**
 * Creates the only portfolio-shaped input an AI adapter may receive for the
 * Phase 4 role POC. It is a copied, bounded, deeply frozen projection.
 */
export function createRoleAiContextProjection(
    portfolio: Portfolio,
    roleId: string,
    profile: AiProfile,
    baseRevision: string,
    options: AiContextProjectionOptions = {},
): AiContextProjection | null {
    const roleJourney = createRoleJourneyProjection(portfolio, roleId);
    if (!roleJourney) return null;

    const include = new Set<AiContextInclude>(profile.context.include);
    const candidates: AiContextSource[] = [];

    if (include.has('resource')) {
        candidates.push({
            sourceId: `asset:${roleJourney.role.id}`,
            category: 'resource',
            label: roleJourney.role.name,
            reference: coreEntityReference('core.asset', roleJourney.role.id),
            data: {
                name: roleJourney.role.name,
                category: roleJourney.role.categoryLabel,
            },
        });
    }

    if (include.has('processes')) {
        roleJourney.processes.forEach(process => candidates.push({
            sourceId: `process:${process.id}`,
            category: 'process',
            label: process.title,
            reference: coreEntityReference('core.process', process.id),
            data: {
                title: process.title,
                relationship: process.relationship,
            },
        }));
    }

    if (include.has('steps')) {
        roleJourney.steps.forEach(step => candidates.push({
            sourceId: nodeSourceId(step.processId, step.graphId, step.id),
            category: 'step',
            label: step.label,
            reference: coreEntityReference('core.node', step.id, {
                processId: step.processId,
                graphPath: step.graphId === 'root' ? [] : [step.graphId],
            }),
            data: {
                label: step.label,
                ...(step.description ? { description: step.description } : {}),
                nodeType: step.type,
                processId: step.processId,
                processTitle: step.processTitle,
                graphId: step.graphId,
                relatedResourceIds: [...step.relatedResourceIds],
            },
        }));
    }

    if (include.has('related-resources')) {
        roleJourney.relatedResources.forEach(resource => candidates.push({
            sourceId: `asset:${resource.id}`,
            category: 'related-resource',
            label: resource.name,
            reference: coreEntityReference('core.asset', resource.id),
            data: {
                name: resource.name,
                category: resource.categoryLabel,
                sharedStepCount: resource.sharedStepCount,
            },
        }));
    }

    if (include.has('linked-notes')) {
        roleJourney.linkedKnowledge.forEach(knowledge => {
            const entry = portfolio.journal.entries.find(candidate => candidate.id === knowledge.id);
            if (!entry) return;
            candidates.push({
                sourceId: `journal-entry:${knowledge.id}`,
                category: 'linked-note',
                label: knowledge.title,
                reference: coreEntityReference('core.journal-entry', knowledge.id),
                data: {
                    title: knowledge.title,
                    linkedThrough: knowledge.linkedThrough,
                    linkedEntityIds: [...knowledge.linkedEntityIds],
                    text: notePlainText(entry.content),
                },
            });
        });
    }

    const maximumCharacters = Math.max(
        1_000,
        Math.min(options.maximumCharacters ?? DEFAULT_AI_CONTEXT_MAX_CHARACTERS, 200_000),
    );
    const maximumSources = Math.max(
        1,
        Math.min(options.maximumSources ?? DEFAULT_AI_CONTEXT_MAX_SOURCES, DEFAULT_AI_CONTEXT_MAX_SOURCES),
    );
    const sources: AiContextSource[] = [];
    let includedCharacters = 0;
    let omittedSources = 0;

    candidates.forEach(candidate => {
        const size = JSON.stringify(candidate).length;
        if (sources.length >= maximumSources || includedCharacters + size > maximumCharacters) {
            omittedSources += 1;
            return;
        }
        sources.push(candidate);
        includedCharacters += size;
    });

    const selectionSourceId = `asset:${roleJourney.role.id}`;
    if (!sources.some(source => source.sourceId === selectionSourceId)) return null;

    const parsed = AiContextProjectionSchema.parse({
        schema: 'axiom.ai-context',
        schemaVersion: CURRENT_AI_CONTEXT_SCHEMA_VERSION,
        projection: 'selected-role',
        projectionVersion: 1,
        scope: profile.context.scope,
        baseRevision,
        selectionSourceId,
        sources,
        limits: {
            maximumCharacters,
            maximumSources,
            includedCharacters,
            omittedSources,
            truncated: omittedSources > 0,
        },
    });
    return deepFreeze(parsed);
}

