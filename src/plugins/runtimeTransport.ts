import { z } from 'zod';
import {
    DEFAULT_PLUGIN_RUNTIME_TIMEOUT_MS,
    MAX_PLUGIN_RUNTIME_IN_FLIGHT,
    MAX_PLUGIN_RUNTIME_REQUEST_BYTES,
    MAX_PLUGIN_RUNTIME_REQUESTS_PER_MINUTE,
    MAX_PLUGIN_RUNTIME_RESPONSE_BYTES,
    MAX_PLUGIN_RUNTIME_TIMEOUT_MS,
} from './pluginLimits';
import {
    PluginIdSchema,
    SemanticVersionSchema,
    StableContractIdSchema,
} from './identifiers';
import { JsonValueSchema } from './semanticData';

export const CURRENT_PLUGIN_RUNTIME_PROTOCOL_VERSION = 1;

export const PluginRuntimeMethodSchema = z.enum([
    'read.search',
    'read.getEntity',
    'read.queryRelations',
    'storage.portfolio.get',
    'storage.portfolio.list',
    'storage.portfolio.usage',
    'storage.portfolio.transact',
    'storage.device.settings.get',
    'storage.device.settings.list',
    'storage.device.settings.usage',
    'storage.device.settings.transact',
    'storage.device.secrets.get',
    'storage.device.secrets.list',
    'storage.device.secrets.usage',
    'storage.device.secrets.set',
    'storage.device.secrets.delete',
    'storage.readCollection',
    'storage.replaceCollection',
    'proposals.submit',
    'workspace.describe',
    'workspace.getContext',
    'workspace.open',
]);

export const PLUGIN_RUNTIME_METHODS = Object.freeze([...PluginRuntimeMethodSchema.options]);

export const PluginRuntimeErrorCodeSchema = z.string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Runtime error codes must be stable uppercase identifiers.');

export const PluginRuntimeErrorSchema = z.object({
    code: PluginRuntimeErrorCodeSchema,
    message: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
}).strict();

const runtimeMessageBase = {
    schema: z.literal('axiom.plugin-runtime-message'),
    schemaVersion: z.literal(CURRENT_PLUGIN_RUNTIME_PROTOCOL_VERSION),
    sessionId: StableContractIdSchema,
};

export const PluginRuntimeRequestMessageSchema = z.object({
    ...runtimeMessageBase,
    kind: z.literal('request'),
    requestId: StableContractIdSchema,
    method: z.string().trim().min(1).max(120),
    timeoutMs: z.number().int().min(1).max(MAX_PLUGIN_RUNTIME_TIMEOUT_MS).optional(),
    payload: JsonValueSchema,
}).strict();

export const PluginRuntimeCancelMessageSchema = z.object({
    ...runtimeMessageBase,
    kind: z.literal('cancel'),
    requestId: StableContractIdSchema,
}).strict();

export const PluginRuntimeInboundMessageSchema = z.discriminatedUnion('kind', [
    PluginRuntimeRequestMessageSchema,
    PluginRuntimeCancelMessageSchema,
]);

export const PluginRuntimeReadyMessageSchema = z.object({
    ...runtimeMessageBase,
    kind: z.literal('ready'),
    apiVersion: SemanticVersionSchema,
    identity: z.object({
        pluginId: PluginIdSchema,
        pluginVersion: SemanticVersionSchema,
        dataVersion: z.number().int().positive(),
    }).strict(),
    methods: z.array(PluginRuntimeMethodSchema)
        .length(PLUGIN_RUNTIME_METHODS.length)
        .superRefine((methods, context) => {
            if (methods.some((method, index) => method !== PLUGIN_RUNTIME_METHODS[index])) {
                context.addIssue({
                    code: 'custom',
                    message: 'Runtime methods must contain the complete protocol method list in canonical order.',
                });
            }
        }),
    limits: z.object({
        maxRequestBytes: z.literal(MAX_PLUGIN_RUNTIME_REQUEST_BYTES),
        maxResponseBytes: z.literal(MAX_PLUGIN_RUNTIME_RESPONSE_BYTES),
        maxInFlight: z.literal(MAX_PLUGIN_RUNTIME_IN_FLIGHT),
        maxRequestsPerMinute: z.literal(MAX_PLUGIN_RUNTIME_REQUESTS_PER_MINUTE),
        defaultTimeoutMs: z.literal(DEFAULT_PLUGIN_RUNTIME_TIMEOUT_MS),
        maxTimeoutMs: z.literal(MAX_PLUGIN_RUNTIME_TIMEOUT_MS),
    }).strict(),
}).strict();

export const PluginRuntimeResponseMessageSchema = z.union([
    z.object({
        ...runtimeMessageBase,
        kind: z.literal('response'),
        requestId: StableContractIdSchema,
        ok: z.literal(true),
        result: JsonValueSchema,
    }).strict(),
    z.object({
        ...runtimeMessageBase,
        kind: z.literal('response'),
        requestId: StableContractIdSchema,
        ok: z.literal(false),
        error: PluginRuntimeErrorSchema,
    }).strict(),
]);

export const PluginRuntimeRevokedMessageSchema = z.object({
    ...runtimeMessageBase,
    kind: z.literal('revoked'),
    reason: z.enum([
        'host-disposed',
        'session-revoked',
        'protocol-violation',
        'runtime-failed',
    ]),
}).strict();

export const PluginRuntimeOutboundMessageSchema = z.union([
    PluginRuntimeReadyMessageSchema,
    PluginRuntimeResponseMessageSchema,
    PluginRuntimeRevokedMessageSchema,
]);

export type PluginRuntimeMethod = z.infer<typeof PluginRuntimeMethodSchema>;
export type PluginRuntimeError = z.infer<typeof PluginRuntimeErrorSchema>;
export type PluginRuntimeRequestMessage = z.infer<typeof PluginRuntimeRequestMessageSchema>;
export type PluginRuntimeCancelMessage = z.infer<typeof PluginRuntimeCancelMessageSchema>;
export type PluginRuntimeInboundMessage = z.infer<typeof PluginRuntimeInboundMessageSchema>;
export type PluginRuntimeReadyMessage = z.infer<typeof PluginRuntimeReadyMessageSchema>;
export type PluginRuntimeResponseMessage = z.infer<typeof PluginRuntimeResponseMessageSchema>;
export type PluginRuntimeRevokedMessage = z.infer<typeof PluginRuntimeRevokedMessageSchema>;
export type PluginRuntimeOutboundMessage = z.infer<typeof PluginRuntimeOutboundMessageSchema>;

export class PluginRuntimeProtocolError extends Error {
    constructor(
        message: string,
        readonly code: 'INVALID_RUNTIME_MESSAGE' | 'UNSUPPORTED_RUNTIME_PROTOCOL_VERSION',
        readonly issues: z.ZodIssue[] = [],
    ) {
        super(message);
        this.name = 'PluginRuntimeProtocolError';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const serializedBytes = (value: unknown): number => {
    try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) throw new Error('not JSON');
        return new TextEncoder().encode(serialized).byteLength;
    } catch {
        throw new PluginRuntimeProtocolError(
            'Runtime messages must be serializable JSON documents.',
            'INVALID_RUNTIME_MESSAGE',
        );
    }
};

export const measurePluginRuntimeMessageBytes = serializedBytes;

export const parsePluginRuntimeInboundMessage = (value: unknown): PluginRuntimeInboundMessage => {
    if (serializedBytes(value) > MAX_PLUGIN_RUNTIME_REQUEST_BYTES) {
        throw new PluginRuntimeProtocolError(
            `Runtime requests may contain at most ${MAX_PLUGIN_RUNTIME_REQUEST_BYTES} UTF-8 bytes.`,
            'INVALID_RUNTIME_MESSAGE',
        );
    }
    if (isRecord(value)
        && typeof value.schemaVersion === 'number'
        && value.schemaVersion > CURRENT_PLUGIN_RUNTIME_PROTOCOL_VERSION) {
        throw new PluginRuntimeProtocolError(
            `Runtime protocol version ${value.schemaVersion} is newer than the supported version ${CURRENT_PLUGIN_RUNTIME_PROTOCOL_VERSION}.`,
            'UNSUPPORTED_RUNTIME_PROTOCOL_VERSION',
        );
    }
    const result = PluginRuntimeInboundMessageSchema.safeParse(value);
    if (!result.success) {
        throw new PluginRuntimeProtocolError(
            'Runtime message validation failed.',
            'INVALID_RUNTIME_MESSAGE',
            result.error.issues,
        );
    }
    return result.data;
};

export const parsePluginRuntimeOutboundMessage = (value: unknown): PluginRuntimeOutboundMessage => {
    if (serializedBytes(value) > MAX_PLUGIN_RUNTIME_RESPONSE_BYTES) {
        throw new PluginRuntimeProtocolError(
            `Runtime responses may contain at most ${MAX_PLUGIN_RUNTIME_RESPONSE_BYTES} UTF-8 bytes.`,
            'INVALID_RUNTIME_MESSAGE',
        );
    }
    const result = PluginRuntimeOutboundMessageSchema.safeParse(value);
    if (!result.success) {
        throw new PluginRuntimeProtocolError(
            'Runtime response validation failed.',
            'INVALID_RUNTIME_MESSAGE',
            result.error.issues,
        );
    }
    return result.data;
};
