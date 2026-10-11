import { z } from 'zod';
import { PluginCollectionItemSchema } from './collectionStorage';
import { PluginCollectionQuerySchema } from './collectionQuery';
import {
    PluginRelationKindSchema,
    PluginEntitySnapshotSchema,
} from './entityReadContracts';
import { CoreEntityKindSchema, UniversalEntityReferenceSchema } from './universalReference';
import { RecordRichTextSchema, isCalendarDate } from './contextualRecords';
import { JsonValueSchema } from './semanticData';
import {
    PluginStorageDocumentKeySchema,
    PluginStorageTransactionSchema,
} from './storageContracts';
import {
    PluginNavigationIntentSchema,
} from './workspaceContracts';
import {
    PLUGIN_UI_LIMITS,
    PLUGIN_UI_PROTOCOL_VERSION,
    PluginUiEffectSchema,
    PluginUiPrimitiveSchema,
} from './pluginUiProtocol';

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
const serializedBytes = (value: unknown): number => utf8Bytes(JSON.stringify(value));
const bounded = <T>(schema: z.ZodType<T>, bytes: number, label: string) => schema.superRefine((value, context) => {
    if (serializedBytes(value) > bytes) context.addIssue({ code: 'custom', message: `${label} exceeds ${bytes} UTF-8 bytes.` });
});

export const PluginUiIdSchema = z.string().min(1).max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'UI identifiers use bounded ASCII letters, numbers, dots, underscores, colons, and hyphens.');
const SafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ActionIdSchema = PluginUiIdSchema;
const LabelSchema = z.string().min(1).max(500);
const GapSchema = z.enum(['none', 'small', 'medium', 'large']);
const calendarDate = z.string().refine(value => value === '' || isCalendarDate(value), 'Dates must be empty or YYYY-MM-DD calendar dates.');
const utcTimestamp = z.string().refine(value => value.endsWith('Z') && !Number.isNaN(Date.parse(value)), 'Observation time must be UTC ISO 8601.');
const uuid = z.string().uuid();

export const PluginUiPresentationSchema = z.object({
    layout: z.enum(['row', 'column']).optional(),
    gap: GapSchema.optional(),
    wrap: z.boolean().optional(),
    width: z.enum(["auto", "grow", "double", "compact"]).optional(),
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
    justify: z.enum(["start", "center", "end", "between"]).optional(),
    surface: z.enum(["plain", "card", "badge", "segmented"]).optional(),
    tone: z.enum(["default", "muted", "accent", "success", "warning", "danger"]).optional(),
    textSize: z.enum(["caption", "body", "section", "title"]).optional(),
    padding: z.enum(["none", "small", "medium", "large"]).optional(),
    label: z.enum(["visible", "hidden"]).optional(),
    icon: z.enum(["search", "copy", "download", "external-link", "trash", "plus", "link", "unlink"]).optional(),
    control: z.enum(["standard", "segment", "icon", "matrix", "link"]).optional(),
    editorHeight: z.enum(["small", "medium", "large"]).optional(),
    placeholder: z.string().max(500).optional(),
    accessibleLabel: LabelSchema.optional(),
    selected: z.boolean().optional(),
}).strict().refine(value => value.control !== 'icon' || value.icon !== undefined, 'Icon controls require an icon.');
export type PluginUiPresentation = z.infer<typeof PluginUiPresentationSchema>;

const nodeBase = { key: PluginUiIdSchema };
const PluginUiTextNodeSchema = z.object({
    ...nodeBase, type: z.literal('text'), text: z.string().max(4_000),
    role: z.enum(['body', 'heading', 'caption', 'status']),
    tone: z.enum(['default', 'muted', 'danger']),
}).strict();
const PluginUiButtonNodeSchema = z.object({
    ...nodeBase, type: z.literal('button'), label: LabelSchema, actionId: ActionIdSchema,
    disabled: z.boolean(), variant: z.enum(['primary', 'secondary', 'ghost']),
}).strict();
const PluginUiTextInputNodeSchema = z.object({
    ...nodeBase, type: z.literal('text-input'), label: LabelSchema, actionId: ActionIdSchema,
    value: z.string().max(4_000), required: z.boolean(), disabled: z.boolean(),
    maxLength: z.number().int().min(1).max(4_000),
}).strict().superRefine((node, context) => {
    if (node.value.length > node.maxLength) context.addIssue({ code: 'custom', path: ['value'], message: 'Input value exceeds maxLength.' });
});
const PluginUiDateInputNodeSchema = z.object({
    ...nodeBase, type: z.literal('date-input'), label: LabelSchema, actionId: ActionIdSchema,
    value: calendarDate, required: z.boolean(), disabled: z.boolean(),
}).strict();
const PluginUiCheckboxNodeSchema = z.object({
    ...nodeBase, type: z.literal('checkbox'), label: LabelSchema, actionId: ActionIdSchema,
    checked: z.boolean(), disabled: z.boolean(),
}).strict();
const SelectOptionSchema = z.object({ value: z.string().max(500), label: LabelSchema }).strict();
const PluginUiSelectNodeSchema = z.object({
    ...nodeBase, type: z.literal('select'), label: LabelSchema, actionId: ActionIdSchema,
    value: z.string().max(500), disabled: z.boolean(),
    options: z.array(SelectOptionSchema).max(100),
}).strict().superRefine((node, context) => {
    const values = node.options.map(option => option.value);
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: ['options'], message: 'Select values must be unique.' });
    if (node.value && !values.includes(node.value)) context.addIssue({ code: 'custom', path: ['value'], message: 'Selected value must be one of the options.' });
});
const PluginUiRichTextNodeSchema = z.object({
    ...nodeBase, type: z.literal('rich-text'), label: LabelSchema, actionId: ActionIdSchema,
    value: RecordRichTextSchema, editable: z.boolean(), draftRevision: SafeIntegerSchema,
}).strict();

export type PluginUiNode = {
    key: string;
    type: z.infer<typeof PluginUiPrimitiveSchema>;
    children?: PluginUiNode[];
    [key: string]: unknown;
};

const PluginUiNodeSchema: z.ZodType<PluginUiNode> = z.lazy(() => z.discriminatedUnion('type', [
    z.object({ ...nodeBase, type: z.literal('presentation'), presentation: PluginUiPresentationSchema,
        children: z.array(PluginUiNodeSchema).max(PLUGIN_UI_LIMITS.childrenPerNode) }).strict().refine(node => node.presentation.layout !== undefined || node.children.length === 1),
    z.object({ ...nodeBase, type: z.literal('form'), label: LabelSchema, actionId: ActionIdSchema,
        dirty: z.boolean(), disabled: z.boolean(), children: z.array(PluginUiNodeSchema).max(PLUGIN_UI_LIMITS.childrenPerNode) }).strict(),
    z.object({ ...nodeBase, type: z.literal('stack'), direction: z.enum(['vertical', 'horizontal']), gap: GapSchema, wrap: z.boolean(), children: z.array(PluginUiNodeSchema).max(PLUGIN_UI_LIMITS.childrenPerNode) }).strict(),
    z.object({ ...nodeBase, type: z.literal('grid'), columns: z.object({ compact: z.number().int().min(1).max(4), wide: z.number().int().min(1).max(4) }).strict(), gap: GapSchema, children: z.array(PluginUiNodeSchema).max(PLUGIN_UI_LIMITS.childrenPerNode) }).strict(),
    PluginUiTextNodeSchema,
    PluginUiButtonNodeSchema,
    PluginUiTextInputNodeSchema,
    PluginUiDateInputNodeSchema,
    PluginUiCheckboxNodeSchema,
    PluginUiSelectNodeSchema,
    z.object({ ...nodeBase, type: z.literal('list'), label: LabelSchema, children: z.array(PluginUiNodeSchema).max(PLUGIN_UI_LIMITS.childrenPerNode) }).strict(),
    z.object({ ...nodeBase, type: z.literal('dialog'), label: LabelSchema, closeActionId: ActionIdSchema, dirty: z.boolean(), children: z.array(PluginUiNodeSchema).max(PLUGIN_UI_LIMITS.childrenPerNode) }).strict(),
    PluginUiRichTextNodeSchema,
]));

export const PluginUiTreeSchema = bounded(PluginUiNodeSchema.superRefine((root, context) => {
    if (root.type !== 'stack' && root.type !== 'grid') context.addIssue({ code: 'custom', path: ['type'], message: 'The UI root must be a stack or grid.' });
    const keys = new Set<string>();
    const actions = new Set<string>();
    const pending: Array<{ node: PluginUiNode; depth: number }> = [{ node: root, depth: 1 }];
    let count = 0;
    let dialogs = 0;
    while (pending.length) {
        const { node, depth } = pending.pop()!;
        count += 1;
        if (count > PLUGIN_UI_LIMITS.treeNodes) { context.addIssue({ code: 'custom', message: 'UI tree has too many nodes.' }); break; }
        if (depth > PLUGIN_UI_LIMITS.treeDepth) { context.addIssue({ code: 'custom', message: 'UI tree is too deep.' }); break; }
        if (keys.has(node.key)) context.addIssue({ code: 'custom', message: `Duplicate UI key '${node.key}'.` });
        keys.add(node.key);
        const actionIds = [node.actionId, node.closeActionId].filter((value): value is string => typeof value === 'string');
        for (const actionId of actionIds) {
            if (actions.has(actionId)) context.addIssue({ code: 'custom', message: `Duplicate action ID '${actionId}'.` });
            actions.add(actionId);
        }
        if (node.type === 'dialog' && ++dialogs > 1) context.addIssue({ code: 'custom', message: 'A UI tree may contain at most one dialog.' });
        for (const child of node.children ?? []) pending.push({ node: child, depth: depth + 1 });
    }
}), PLUGIN_UI_LIMITS.treeBytes, 'UI tree');

const MountEventSchema = z.object({
    kind: z.literal('mount'), surface: z.enum(['app-rail', 'canvas-dialog']),
    capturedContext: UniversalEntityReferenceSchema.nullable(),
}).strict();
const ActionEventSchema = z.object({
    kind: z.literal('action'), controlKey: PluginUiIdSchema, actionId: ActionIdSchema,
    value: JsonValueSchema.nullable(), draftRevision: SafeIntegerSchema.nullable(),
}).strict();
const InvalidateEventSchema = z.object({
    kind: z.literal('invalidate'),
    flags: z.object({ data: z.boolean(), workspace: z.boolean(), viewport: z.boolean(), theme: z.boolean() }).strict(),
}).strict().superRefine((event, context) => {
    if (!Object.values(event.flags).some(Boolean)) context.addIssue({ code: 'custom', path: ['flags'], message: 'At least one invalidation flag is required.' });
});
const RuntimeErrorCodeSchema = z.string().min(3).max(80).regex(/^[A-Z][A-Z0-9_]*$/);
const EffectResultEventSchema = z.union([
    z.object({ kind: z.literal('effect-result'), effectId: PluginUiIdSchema, ok: z.literal(true), result: JsonValueSchema }).strict(),
    z.object({ kind: z.literal('effect-result'), effectId: PluginUiIdSchema, ok: z.literal(false), error: z.object({ code: RuntimeErrorCodeSchema, message: z.string().min(1).max(500), retryable: z.boolean(), outcomeUnknown: z.boolean() }).strict() }).strict(),
]);
export const PluginUiEventSchema = bounded(z.union([MountEventSchema, ActionEventSchema, InvalidateEventSchema, EffectResultEventSchema]), PLUGIN_UI_LIMITS.eventBytes, 'UI event');

const EntitySnapshotEnvelopeSchema = z.object({ kind: z.literal('entity'), value: PluginEntitySnapshotSchema }).strict();
const StoragePageSnapshotSchema = bounded(z.object({
    kind: z.literal('storage-page'), source: z.enum(['collection', 'document']),
    portfolioRevision: SafeIntegerSchema, subject: z.string().min(1).max(160),
    cursor: z.string().max(120).nullable(), nextCursor: z.string().max(120).nullable(),
    items: z.array(JsonValueSchema).max(PLUGIN_UI_LIMITS.snapshotPageItems),
}).strict(), PLUGIN_UI_LIMITS.snapshotPageBytes, 'Storage snapshot page');
export const PluginUiSnapshotSchema = z.union([EntitySnapshotEnvelopeSchema, StoragePageSnapshotSchema]);

export const PluginUiEnvironmentSchema = z.object({
    observedAt: utcTimestamp, localDate: calendarDate.refine(value => value !== ''),
    timezoneOffsetMinutes: z.number().int().min(-840).max(840),
    viewport: z.enum(['compact', 'wide']),
    theme: z.object({ colorScheme: z.enum(['light', 'dark']), density: z.enum(['compact', 'comfortable', 'spacious']) }).strict(),
    allocatedIds: z.array(uuid).max(16).refine(values => new Set(values).size === values.length),
}).strict();

const EmptyPayloadSchema = z.object({}).strict();
const effect = <K extends z.infer<typeof PluginUiEffectSchema>, T extends z.ZodTypeAny>(kind: K, payload: T) => z.object({
    id: PluginUiIdSchema, kind: z.literal(kind), payload,
}).strict();
const CollectionReadPagePayload = z.object({ collectionId: PluginUiIdSchema, cursor: z.string().max(120).nullable(), limit: z.number().int().min(1).max(PLUGIN_UI_LIMITS.snapshotPageItems) }).strict();
const CollectionOperationSchema = z.union([
    z.object({ operationId: PluginUiIdSchema, kind: z.literal('put'), item: PluginCollectionItemSchema }).strict(),
    z.object({ operationId: PluginUiIdSchema, kind: z.literal('delete'), itemId: PluginUiIdSchema, expectedUpdatedAt: utcTimestamp.nullable() }).strict(),
]);
const CollectionTransactPayload = z.object({
    collectionId: PluginUiIdSchema, expectedPortfolioRevision: SafeIntegerSchema,
    operations: z.array(CollectionOperationSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
    const operationIds = value.operations.map(operation => operation.operationId);
    const itemIds = value.operations.map(operation => operation.kind === 'put' ? operation.item.id : operation.itemId);
    if (new Set(operationIds).size !== operationIds.length) context.addIssue({ code: 'custom', path: ['operations'], message: 'Operation IDs must be unique.' });
    if (new Set(itemIds).size !== itemIds.length) context.addIssue({ code: 'custom', path: ['operations'], message: 'Each item may be changed once.' });
});
const DocumentGetPayload = z.object({ key: PluginStorageDocumentKeySchema }).strict();
const RelationQueryPayload = z.object({
    schema: z.literal('axiom.plugin.relation-query'), schemaVersion: z.literal(1),
    reference: UniversalEntityReferenceSchema, direction: z.enum(['outgoing', 'incoming', 'both']),
    relationKinds: z.array(PluginRelationKindSchema).max(50),
    limit: z.number().int().min(1).max(100), cursor: z.string().min(1).max(120).nullable(),
}).strict();
const DocumentListPayload = z.object({
    schema: z.literal('axiom.plugin-storage-list'), schemaVersion: z.literal(1), scope: z.literal('portfolio'),
    prefix: z.string().max(160), limit: z.number().int().min(1).max(100), cursor: z.string().min(1).max(120).nullable(),
}).strict();
const TextFilePayload = z.object({ suggestedBaseName: z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/), text: z.string().refine(value => utf8Bytes(value) <= PLUGIN_UI_LIMITS.textOutputBytes) }).strict();
const ClipboardPayload = z.object({ text: z.string().refine(value => utf8Bytes(value) <= PLUGIN_UI_LIMITS.textOutputBytes) }).strict();
const NoticePayload = z.object({ message: z.string().min(1).max(500), severity: z.enum(['info', 'success', 'warning', 'error']) }).strict();

export const PluginUiEffectRequestSchema = z.union([
    effect('read.search', z.object({ query: z.string().trim().min(1).max(240), kinds: z.array(CoreEntityKindSchema).max(CoreEntityKindSchema.options.length), limit: z.number().int().min(1).max(100) }).strict()),
    effect('read.entity', z.object({ reference: UniversalEntityReferenceSchema }).strict()),
    effect('read.relations', RelationQueryPayload),
    effect('storage.collection.read-page', CollectionReadPagePayload),
    effect('storage.collection.query-page', CollectionReadPagePayload.extend({ query: PluginCollectionQuerySchema }).strict()),
    effect('storage.collection.transact', CollectionTransactPayload),
    effect('storage.document.get', DocumentGetPayload),
    effect('storage.document.list', DocumentListPayload),
    effect('storage.document.transact', PluginStorageTransactionSchema),
    effect('workspace.context', EmptyPayloadSchema),
    effect('workspace.open', PluginNavigationIntentSchema),
    effect('output.text-file', z.union([TextFilePayload, TextFilePayload.omit({ text: true }).extend({ buffered: z.literal(true) }).strict()])),
    effect('output.clipboard-text', z.union([ClipboardPayload, z.object({ buffered: z.literal(true) }).strict()])),
    effect('output.text-buffer', z.object({ operation: z.enum(['reset', 'append']), text: z.string().refine(value => utf8Bytes(value) <= PLUGIN_UI_LIMITS.textOutputBytes) }).strict()),
    effect('notice.show', NoticePayload),
]);

const inputBase = {
    schema: z.literal('axiom.plugin-ui-input'), schemaVersion: z.literal(1),
    protocolVersion: z.literal(PLUGIN_UI_PROTOCOL_VERSION), instanceId: PluginUiIdSchema,
    sequence: SafeIntegerSchema.min(1), uiRevision: SafeIntegerSchema,
    portfolioRevision: SafeIntegerSchema,
};
export const PluginUiInputSchema = bounded(z.object({
    ...inputBase, event: PluginUiEventSchema, state: bounded(JsonValueSchema, PLUGIN_UI_LIMITS.stateBytes, 'UI state'),
    snapshots: z.array(PluginUiSnapshotSchema).max(100), environment: PluginUiEnvironmentSchema,
}).strict().superRefine((input, context) => {
    for (const [index, snapshot] of input.snapshots.entries()) {
        const revision = snapshot.kind === 'entity' ? snapshot.value.portfolioRevision : snapshot.portfolioRevision;
        if (revision !== input.portfolioRevision) context.addIssue({ code: 'custom', path: ['snapshots', index], message: 'Snapshot revision must match the input Portfolio revision.' });
    }
}), PLUGIN_UI_LIMITS.requestBytes, 'UI request');

export const PluginUiResultSchema = bounded(z.object({
    schema: z.literal('axiom.plugin-ui-result'), schemaVersion: z.literal(1),
    protocolVersion: z.literal(PLUGIN_UI_PROTOCOL_VERSION), instanceId: PluginUiIdSchema,
    sequence: SafeIntegerSchema.min(1), uiRevision: SafeIntegerSchema,
    portfolioRevision: SafeIntegerSchema,
    state: bounded(JsonValueSchema, PLUGIN_UI_LIMITS.stateBytes, 'UI state'),
    tree: PluginUiTreeSchema,
    effects: z.array(PluginUiEffectRequestSchema).max(PLUGIN_UI_LIMITS.effectsPerResult),
}).strict().superRefine((result, context) => {
    const ids = result.effects.map(effect => effect.id);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['effects'], message: 'Effect IDs must be unique.' });
    const storageBatches = result.effects.filter(effect => effect.kind === 'storage.collection.transact' || effect.kind === 'storage.document.transact');
    if (storageBatches.length > PLUGIN_UI_LIMITS.storageBatchesPerResult) context.addIssue({ code: 'custom', path: ['effects'], message: 'Only one storage batch is allowed per result.' });
    if (result.effects.filter(effect => effect.kind === 'notice.show').length > 1) context.addIssue({ code: 'custom', path: ['effects'], message: 'Only one notice is allowed per result.' });
}), PLUGIN_UI_LIMITS.resultBytes, 'UI result');

export type PluginUiInput = z.infer<typeof PluginUiInputSchema>;
export type PluginUiResult = z.infer<typeof PluginUiResultSchema>;
export type PluginUiEffectRequest = z.infer<typeof PluginUiEffectRequestSchema>;
export type PluginUiEvent = z.infer<typeof PluginUiEventSchema>;

export class PluginUiContractError extends Error {
    constructor(message: string, readonly code: 'INVALID_JSON' | 'DUPLICATE_JSON_KEY' | 'REQUEST_TOO_LARGE' | 'RESULT_TOO_LARGE' | 'INVALID_UI_INPUT' | 'INVALID_UI_RESULT') {
        super(message); this.name = 'PluginUiContractError';
    }
}

function assertNoDuplicateJsonKeys(source: string): void {
    let offset = 0;
    const skip = () => { while (/\s/.test(source[offset] ?? '')) offset += 1; };
    const string = (): string => {
        const start = offset++;
        while (offset < source.length) {
            if (source[offset] === '\\') { offset += 2; continue; }
            if (source[offset++] === '"') return JSON.parse(source.slice(start, offset));
        }
        throw new Error('unterminated string');
    };
    const value = (): void => {
        skip();
        if (source[offset] === '{') {
            offset += 1; skip(); const keys = new Set<string>();
            if (source[offset] === '}') { offset += 1; return; }
            while (true) {
                skip(); if (source[offset] !== '"') throw new Error('object key');
                const key = string(); if (keys.has(key)) throw new PluginUiContractError(`Duplicate JSON key '${key}'.`, 'DUPLICATE_JSON_KEY'); keys.add(key);
                skip(); if (source[offset++] !== ':') throw new Error('colon'); value(); skip();
                const next = source[offset++]; if (next === '}') return; if (next !== ',') throw new Error('object separator');
            }
        }
        if (source[offset] === '[') {
            offset += 1; skip(); if (source[offset] === ']') { offset += 1; return; }
            while (true) { value(); skip(); const next = source[offset++]; if (next === ']') return; if (next !== ',') throw new Error('array separator'); }
        }
        if (source[offset] === '"') { string(); return; }
        const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(offset));
        if (!match) throw new Error('value'); offset += match[0].length;
    };
    try { value(); skip(); if (offset !== source.length) throw new Error('trailing'); }
    catch (error) { if (error instanceof PluginUiContractError) throw error; throw new PluginUiContractError('Plugin UI payload is not valid JSON.', 'INVALID_JSON'); }
}

function parseWire<T>(source: string, limit: number, schema: z.ZodType<T>, tooLargeCode: 'REQUEST_TOO_LARGE' | 'RESULT_TOO_LARGE', invalidCode: 'INVALID_UI_INPUT' | 'INVALID_UI_RESULT'): T {
    if (utf8Bytes(source) > limit) throw new PluginUiContractError('Plugin UI payload exceeds its wire byte limit.', tooLargeCode);
    assertNoDuplicateJsonKeys(source);
    let value: unknown;
    try { value = JSON.parse(source); } catch { throw new PluginUiContractError('Plugin UI payload is not valid JSON.', 'INVALID_JSON'); }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new PluginUiContractError('Plugin UI payload failed contract validation.', invalidCode);
    return parsed.data;
}

export const parsePluginUiInputJson = (source: string): PluginUiInput => parseWire(source, PLUGIN_UI_LIMITS.requestBytes, PluginUiInputSchema, 'REQUEST_TOO_LARGE', 'INVALID_UI_INPUT');
export const parsePluginUiResultJson = (source: string): PluginUiResult => parseWire(source, PLUGIN_UI_LIMITS.resultBytes, PluginUiResultSchema, 'RESULT_TOO_LARGE', 'INVALID_UI_RESULT');
