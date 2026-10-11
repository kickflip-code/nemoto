import { z } from 'zod';
import { JsonValueSchema } from './semanticData';
import { UniversalEntityReferenceSchema } from './universalReference';

/** Host-owned portable rich text subset. No HTML, media or opaque entity IDs. */
export interface RecordRichText {
    type: string;
    text?: string;
    content?: RecordRichText[];
    marks?: { type: string }[];
}
const nodes = new Set(['doc', 'paragraph', 'text', 'bulletList', 'listItem', 'hardBreak']);
export const RecordRichTextSchema = JsonValueSchema.refine(value => {
    const visit = (node: unknown): boolean => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
        const n = node as Record<string, unknown>;
        if (!nodes.has(String(n.type)) || Object.keys(n).some(key => !['type', 'text', 'content', 'marks'].includes(key))) return false;
        if (n.type === 'text') return typeof n.text === 'string' && n.text.length > 0 && n.content === undefined && (n.marks === undefined || (Array.isArray(n.marks) && n.marks.every(mark => mark && Object.keys(mark).length === 1 && ['bold', 'italic', 'strike'].includes(mark.type))));
        if (n.text !== undefined) return false;
        if (n.marks !== undefined && (!Array.isArray(n.marks) || !n.marks.every(mark => mark && Object.keys(mark).length === 1 && ['bold', 'italic', 'strike'].includes(mark.type)))) return false;
        if (n.type === 'hardBreak') return n.content === undefined;
        const content = n.content === undefined ? [] : n.content;
        if (!Array.isArray(content) || !content.every(visit)) return false;
        const children = content as RecordRichText[];
        if (n.type === 'paragraph') return children.every(child => ['text', 'hardBreak'].includes(child.type));
        if (!children.length) return false;
        if (n.type === 'bulletList') return children.every(child => child.type === 'listItem');
        if (n.type === 'listItem' && children[0].type !== 'paragraph') return false;
        return children.every(child => ['paragraph', 'bulletList'].includes(child.type));
    };
    return visit(value) && (value as unknown as RecordRichText).type === 'doc';
}, 'Unsupported rich text document.').transform(value => value as unknown as RecordRichText);

export const RecordContextSchema = z.object({
    reference: UniversalEntityReferenceSchema.refine(ref => ['core.node', 'core.process'].includes(ref.kind)),
    labelSnapshot: z.string().trim().min(1).max(500),
    locationSnapshot: z.string().max(2000),
}).strict();

export const ContextualRecordDetailsSchema = z.object({
    schemaVersion: z.literal(1),
    context: RecordContextSchema.nullable(),
    description: RecordRichTextSchema,
    completedAt: z.string().datetime().nullable(),
}).strict();

export type RecordContext = z.infer<typeof RecordContextSchema>;
export const emptyRecordDescription = (): RecordRichText => ({ type: 'doc', content: [{ type: 'paragraph' }] });
export function isCalendarDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
