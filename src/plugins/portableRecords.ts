import { z } from 'zod';
import { StableContractIdSchema } from './identifiers';
import { JsonValueSchema } from './semanticData';
import { UniversalEntityReferenceSchema } from './universalReference';

export const PORTABLE_RECORD_SCHEMA = 'axiom.plugin-record';
const SlotKey = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

/** Stored inside an ordinary plugin document; metadata travels with the data. */
export const PortablePluginRecordSchema = z.object({
    schema: z.literal(PORTABLE_RECORD_SCHEMA),
    schemaVersion: z.literal(1),
    id: StableContractIdSchema,
    payload: JsonValueSchema,
    references: z.array(z.object({
        key: SlotKey,
        role: z.string().min(1).max(160),
        reference: UniversalEntityReferenceSchema.nullable(),
        fallbackLabel: z.string().max(500),
    }).strict()).max(100),
}).strict().superRefine((record, context) => {
    if (!JsonValueSchema.safeParse(record.payload).success) return;
    const keys = new Set(record.references.map(slot => slot.key));
    if (keys.size !== record.references.length) context.addIssue({ code: 'custom', message: 'Reference slot keys must be unique.' });
    // Payload links use a closed marker. Never discover or rewrite IDs in arbitrary JSON.
    const pending: unknown[] = [record.payload];
    while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== 'object') continue;
        if (Array.isArray(value)) { pending.push(...value); continue; }
        const object = value as Record<string, unknown>;
        if (object.schema === 'axiom.entity-reference') {
            context.addIssue({ code: 'custom', message: 'Entity references belong in reference slots, not payload.' });
        }
        if ('$reference' in object && (Object.keys(object).length !== 1
            || typeof object.$reference !== 'string' || !keys.has(object.$reference))) {
            context.addIssue({ code: 'custom', message: 'Payload reference markers must name an existing slot.' });
        }
        pending.push(...Object.values(object));
    }
});

export type PortablePluginRecord = z.infer<typeof PortablePluginRecordSchema>;
export function isPortableRecord(value: unknown): boolean {
    return !!value && typeof value === 'object' && 'schema' in value && value.schema === PORTABLE_RECORD_SCHEMA;
}
