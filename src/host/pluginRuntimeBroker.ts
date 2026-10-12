import { z } from 'zod';
import { NEMOTO_PLUGIN_API_VERSION } from '../plugins/activation';
import { PluginCollectionItemSchema } from '../plugins/collectionStorage';
import { PluginViewContributionSchema } from '../plugins/contributionSchemas';
import {
    PluginDeviceSecretDeleteSchema,
    PluginDeviceSecretSetSchema,
    PluginDeviceSecretsListRequestSchema,
    PluginDeviceSettingsListRequestSchema,
    PluginDeviceSettingsTransactionSchema,
} from '../plugins/deviceStorageContracts';
import { PluginEntityRelationQuerySchema } from '../plugins/entityReadContracts';
import { StableContractIdSchema } from '../plugins/identifiers';
import {
    DEFAULT_PLUGIN_RUNTIME_TIMEOUT_MS,
    MAX_PLUGIN_COLLECTION_ITEMS,
    MAX_PLUGIN_RUNTIME_IN_FLIGHT,
    MAX_PLUGIN_RUNTIME_PROTOCOL_VIOLATIONS,
    MAX_PLUGIN_RUNTIME_RECENT_REQUEST_IDS,
    MAX_PLUGIN_RUNTIME_REQUEST_BYTES,
    MAX_PLUGIN_RUNTIME_REQUESTS_PER_MINUTE,
    MAX_PLUGIN_RUNTIME_RESPONSE_BYTES,
    MAX_PLUGIN_RUNTIME_TIMEOUT_MS,
} from '../plugins/pluginLimits';
import type { NemotoPluginApi } from '../plugins/publicApi';
import { parsePluginProposal } from '../plugins/proposals';
import {
    PLUGIN_RUNTIME_METHODS,
    PluginRuntimeMethodSchema,
    PluginRuntimeProtocolError,
    measurePluginRuntimeMessageBytes,
    parsePluginRuntimeInboundMessage,
    parsePluginRuntimeOutboundMessage,
    type PluginRuntimeError,
    type PluginRuntimeInboundMessage,
    type PluginRuntimeMethod,
    type PluginRuntimeOutboundMessage,
    type PluginRuntimeRequestMessage,
    type PluginRuntimeRevokedMessage,
} from '../plugins/runtimeTransport';
import { JsonValueSchema } from '../plugins/semanticData';
import {
    PluginStorageDocumentKeySchema,
    PluginStorageListRequestSchema,
    PluginStorageTransactionSchema,
} from '../plugins/storageContracts';
import { CoreEntityKindSchema, UniversalEntityReferenceSchema } from '../plugins/universalReference';
import { PluginNavigationIntentSchema } from '../plugins/workspaceContracts';

export interface PluginRuntimeTransportEndpoint {
    readonly send: (message: PluginRuntimeOutboundMessage) => void;
    readonly subscribe: (listener: (message: unknown) => void) => () => void;
    readonly close: () => void;
}

export interface PluginRuntimeBrokerOptions {
    readonly sessionId: string;
    readonly api: NemotoPluginApi;
    readonly transport: PluginRuntimeTransportEndpoint;
    /** Rechecks activation, identity, compatibility, and compute.isolated authority. */
    readonly isSessionAuthorized: () => boolean;
    readonly now?: () => number;
    readonly setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface PluginRuntimeBroker {
    readonly sessionId: string;
    readonly isClosed: () => boolean;
    readonly inFlightCount: () => number;
    readonly revoke: (reason?: PluginRuntimeRevokedMessage['reason']) => void;
    readonly dispose: () => void;
}

interface PendingRequest {
    settled: boolean;
    started: boolean;
    method: PluginRuntimeMethod;
    timer: ReturnType<typeof setTimeout>;
}

const MUTATING_RUNTIME_METHODS = new Set<PluginRuntimeMethod>([
    'storage.portfolio.transact',
    'storage.device.settings.transact',
    'storage.device.secrets.set',
    'storage.device.secrets.delete',
    'storage.replaceCollection',
    'proposals.submit',
    'workspace.open',
]);

const NoPayloadSchema = z.null();
const RuntimeSearchRequestSchema = z.object({
    query: z.string().max(240),
    kinds: z.array(CoreEntityKindSchema).max(CoreEntityKindSchema.options.length).optional(),
    limit: z.number().int().min(1).max(100).optional(),
}).strict();
const RuntimeCollectionIdSchema = z.string().trim().min(1).max(80)
    .regex(/^[a-z][a-zA-Z0-9-]*$/);
const RuntimeReplaceCollectionSchema = z.object({
    view: PluginViewContributionSchema,
    items: z.array(PluginCollectionItemSchema).max(MAX_PLUGIN_COLLECTION_ITEMS),
    expectedRevision: z.number().int().nonnegative(),
}).strict().superRefine((input, context) => {
    if (input.view.renderer !== 'collection-list') {
        context.addIssue({
            code: 'custom',
            path: ['view', 'renderer'],
            message: 'Runtime collection replacement requires a collection-list view.',
        });
    }
});

const cloneJson = <T>(value: T): T => (
    typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value)) as T
);

const runtimeError = (
    code: string,
    message: string,
    retryable = false,
): PluginRuntimeError => ({
    code,
    message: message.slice(0, 500),
    retryable,
});

const PUBLIC_RUNTIME_ERROR_CODES = new Set([
    'INVALID_PROPOSAL',
    'UNSUPPORTED_SCHEMA_VERSION',
    'PLUGIN_CAPABILITY_DENIED',
    'PLUGIN_REVISION_CONFLICT',
    'PLUGIN_SESSION_UNAVAILABLE',
    'PLUGIN_IDENTITY_MISMATCH',
    'PLUGIN_RELATION_CURSOR_INVALID',
    'PLUGIN_STORAGE_DOCUMENT_CONFLICT',
    'PLUGIN_STORAGE_DATA_INVALID',
    'PLUGIN_STORAGE_CURSOR_INVALID',
    'PLUGIN_STORAGE_QUOTA_EXCEEDED',
    'PLUGIN_DEVICE_STORAGE_REVISION_CONFLICT',
    'PLUGIN_DEVICE_DOCUMENT_CONFLICT',
    'PLUGIN_DEVICE_STORAGE_CURSOR_INVALID',
    'PLUGIN_DEVICE_STORAGE_QUOTA_EXCEEDED',
    'PLUGIN_SECRET_STORE_UNAVAILABLE',
    'PLUGIN_DEVICE_STORAGE_DATA_INVALID',
]);

const isPublicErrorCode = (value: unknown): value is string => (
    typeof value === 'string'
    && PUBLIC_RUNTIME_ERROR_CODES.has(value)
);

const safePublicError = (error: unknown): PluginRuntimeError => {
    if (error instanceof z.ZodError) {
        return runtimeError('INVALID_PARAMS', 'The request payload does not match the selected API method.');
    }
    if (typeof error === 'object' && error !== null) {
        const candidate = error as { code?: unknown; message?: unknown };
        if (isPublicErrorCode(candidate.code)) {
            const message = typeof candidate.message === 'string' && candidate.message.trim()
                ? candidate.message.trim()
                : 'The plugin request was rejected by the host.';
            const retryable = candidate.code.includes('CONFLICT')
                || candidate.code.endsWith('_UNAVAILABLE');
            return runtimeError(candidate.code, message, retryable);
        }
    }
    return runtimeError('INTERNAL_ERROR', 'The host could not complete the plugin request.');
};

const parsePayload = (method: PluginRuntimeMethod, payload: unknown): unknown => {
    switch (method) {
        case 'read.search':
            return RuntimeSearchRequestSchema.parse(payload);
        case 'read.getEntity':
            return UniversalEntityReferenceSchema.parse(payload);
        case 'read.queryRelations':
            return PluginEntityRelationQuerySchema.parse(payload);
        case 'storage.portfolio.get':
            return PluginStorageDocumentKeySchema.parse(payload);
        case 'storage.portfolio.list':
            return PluginStorageListRequestSchema.parse(payload);
        case 'storage.portfolio.usage':
        case 'storage.device.settings.usage':
        case 'storage.device.secrets.usage':
        case 'workspace.describe':
        case 'workspace.getContext':
            return NoPayloadSchema.parse(payload);
        case 'storage.portfolio.transact':
            return PluginStorageTransactionSchema.parse(payload);
        case 'storage.device.settings.get':
        case 'storage.device.secrets.get':
            return PluginStorageDocumentKeySchema.parse(payload);
        case 'storage.device.settings.list':
            return PluginDeviceSettingsListRequestSchema.parse(payload);
        case 'storage.device.settings.transact':
            return PluginDeviceSettingsTransactionSchema.parse(payload);
        case 'storage.device.secrets.list':
            return PluginDeviceSecretsListRequestSchema.parse(payload);
        case 'storage.device.secrets.set':
            return PluginDeviceSecretSetSchema.parse(payload);
        case 'storage.device.secrets.delete':
            return PluginDeviceSecretDeleteSchema.parse(payload);
        case 'storage.readCollection':
            return RuntimeCollectionIdSchema.parse(payload);
        case 'storage.replaceCollection':
            return RuntimeReplaceCollectionSchema.parse(payload);
        case 'proposals.submit':
            return parsePluginProposal(payload);
        case 'workspace.open':
            return PluginNavigationIntentSchema.parse(payload);
    }
};

const invokeMethod = async (
    api: NemotoPluginApi,
    method: PluginRuntimeMethod,
    payload: unknown,
): Promise<unknown> => {
    const input = parsePayload(method, payload);
    switch (method) {
        case 'read.search': return api.read.search(input as Parameters<typeof api.read.search>[0]);
        case 'read.getEntity': return api.read.getEntity(input as Parameters<typeof api.read.getEntity>[0]);
        case 'read.queryRelations': return api.read.queryRelations(input as Parameters<typeof api.read.queryRelations>[0]);
        case 'storage.portfolio.get': return api.storage.portfolio.get(input as string);
        case 'storage.portfolio.list': return api.storage.portfolio.list(input as Parameters<typeof api.storage.portfolio.list>[0]);
        case 'storage.portfolio.usage': return api.storage.portfolio.usage();
        case 'storage.portfolio.transact': return api.storage.portfolio.transact(input as Parameters<typeof api.storage.portfolio.transact>[0]);
        case 'storage.device.settings.get': return api.storage.device.settings.get(input as string);
        case 'storage.device.settings.list': return api.storage.device.settings.list(input as Parameters<typeof api.storage.device.settings.list>[0]);
        case 'storage.device.settings.usage': return api.storage.device.settings.usage();
        case 'storage.device.settings.transact': return api.storage.device.settings.transact(input as Parameters<typeof api.storage.device.settings.transact>[0]);
        case 'storage.device.secrets.get': return api.storage.device.secrets.get(input as string);
        case 'storage.device.secrets.list': return api.storage.device.secrets.list(input as Parameters<typeof api.storage.device.secrets.list>[0]);
        case 'storage.device.secrets.usage': return api.storage.device.secrets.usage();
        case 'storage.device.secrets.set': return api.storage.device.secrets.set(input as Parameters<typeof api.storage.device.secrets.set>[0]);
        case 'storage.device.secrets.delete': return api.storage.device.secrets.delete(input as Parameters<typeof api.storage.device.secrets.delete>[0]);
        case 'storage.readCollection': return api.storage.readCollection(input as string);
        case 'storage.replaceCollection': return api.storage.replaceCollection(input as Parameters<typeof api.storage.replaceCollection>[0]);
        case 'proposals.submit': return api.proposals.submit(input);
        case 'workspace.describe': return api.workspace.describe();
        case 'workspace.getContext': return api.workspace.getContext();
        case 'workspace.open': return api.workspace.open(input as Parameters<typeof api.workspace.open>[0]);
    }
};

export function createPluginRuntimeBroker(options: PluginRuntimeBrokerOptions): PluginRuntimeBroker {
    const sessionId = StableContractIdSchema.parse(options.sessionId);
    const now = options.now || (() => Date.now());
    const setTimer = options.setTimer || ((callback, delayMs) => setTimeout(callback, delayMs));
    const clearTimer = options.clearTimer || (timer => clearTimeout(timer));
    const pending = new Map<string, PendingRequest>();
    const recentRequestIds = new Set<string>();
    let recentRequests: number[] = [];
    let protocolViolations = 0;
    let closed = false;
    let unsubscribe: () => void = () => undefined;

    const isAuthorized = (): boolean => {
        try {
            return options.isSessionAuthorized();
        } catch {
            return false;
        }
    };

    const closeTransport = () => {
        if (closed) return;
        closed = true;
        try {
            unsubscribe();
        } catch {
            // Teardown must continue even if a custom transport cleanup fails.
        }
        pending.forEach(request => clearTimer(request.timer));
        pending.clear();
        try {
            options.transport.close();
        } catch {
            // A closed broker never reuses a failed transport.
        }
    };

    const send = (message: PluginRuntimeOutboundMessage): boolean => {
        if (closed) return false;
        try {
            options.transport.send(parsePluginRuntimeOutboundMessage(cloneJson(message)));
            return true;
        } catch {
            closeTransport();
            return false;
        }
    };

    const sendError = (requestId: string, error: PluginRuntimeError): void => {
        send({
            schema: 'axiom.plugin-runtime-message',
            schemaVersion: 1,
            kind: 'response',
            sessionId,
            requestId,
            ok: false,
            error,
        });
    };

    const revoke = (reason: PluginRuntimeRevokedMessage['reason'] = 'session-revoked') => {
        if (closed) return;
        send({
            schema: 'axiom.plugin-runtime-message',
            schemaVersion: 1,
            kind: 'revoked',
            sessionId,
            reason,
        });
        closeTransport();
    };

    const settle = (
        requestId: string,
        outcome: { ok: true; result: unknown } | { ok: false; error: PluginRuntimeError },
    ): void => {
        const request = pending.get(requestId);
        if (!request || request.settled || closed) return;
        if (!isAuthorized()) {
            revoke('session-revoked');
            return;
        }
        request.settled = true;
        clearTimer(request.timer);
        pending.delete(requestId);
        if (!outcome.ok) {
            sendError(requestId, outcome.error);
            return;
        }
        try {
            const result = JsonValueSchema.parse(cloneJson(outcome.result));
            const message = {
                schema: 'axiom.plugin-runtime-message' as const,
                schemaVersion: 1 as const,
                kind: 'response' as const,
                sessionId,
                requestId,
                ok: true as const,
                result,
            };
            if (measurePluginRuntimeMessageBytes(message) > MAX_PLUGIN_RUNTIME_RESPONSE_BYTES) {
                sendError(requestId, runtimeError(
                    'RESPONSE_TOO_LARGE',
                    'The host response exceeded the runtime transport limit.',
                ));
                return;
            }
            send(message);
        } catch {
            sendError(requestId, runtimeError('INTERNAL_ERROR', 'The host returned a non-serializable result.'));
        }
    };

    const runRequest = (message: PluginRuntimeRequestMessage): void => {
        if (recentRequestIds.has(message.requestId)) {
            sendError(message.requestId, runtimeError('DUPLICATE_REQUEST', 'The request ID was already used in this runtime session.'));
            return;
        }
        recentRequestIds.add(message.requestId);
        if (recentRequestIds.size > MAX_PLUGIN_RUNTIME_RECENT_REQUEST_IDS) {
            const oldestRequestId = recentRequestIds.keys().next().value;
            if (oldestRequestId) recentRequestIds.delete(oldestRequestId);
        }

        const parsedMethod = PluginRuntimeMethodSchema.safeParse(message.method);
        if (!parsedMethod.success) {
            sendError(message.requestId, runtimeError('UNKNOWN_METHOD', 'The requested plugin API method is not available.'));
            return;
        }
        if (pending.has(message.requestId)) {
            sendError(message.requestId, runtimeError('DUPLICATE_REQUEST', 'The request ID is already in flight.'));
            return;
        }

        if (pending.size >= MAX_PLUGIN_RUNTIME_IN_FLIGHT) {
            sendError(message.requestId, runtimeError('BACKPRESSURE', 'Too many plugin requests are already in flight.', true));
            return;
        }

        const timeoutMs = message.timeoutMs || DEFAULT_PLUGIN_RUNTIME_TIMEOUT_MS;
        const request: PendingRequest = {
            settled: false,
            started: false,
            method: parsedMethod.data,
            timer: setTimer(() => {
                const outcomeMayBeCommitted = request.started
                    && MUTATING_RUNTIME_METHODS.has(request.method);
                settle(message.requestId, {
                    ok: false,
                    error: runtimeError(
                        'DEADLINE_EXCEEDED',
                        outcomeMayBeCommitted
                            ? 'The response deadline expired after dispatch. The operation may have completed; refresh state before retrying.'
                            : 'The plugin request exceeded its response deadline.',
                        !outcomeMayBeCommitted,
                    ),
                });
            }, timeoutMs),
        };
        pending.set(message.requestId, request);

        void Promise.resolve().then(async () => {
            if (request.settled || closed) return;
            if (!isAuthorized()) {
                revoke('session-revoked');
                return;
            }
            try {
                request.started = true;
                const result = await invokeMethod(options.api, parsedMethod.data, cloneJson(message.payload));
                settle(message.requestId, { ok: true, result });
            } catch (error) {
                settle(message.requestId, { ok: false, error: safePublicError(error) });
            }
        });
    };

    const handleMessage = (input: unknown): void => {
        if (closed) return;
        if (!isAuthorized()) {
            revoke('session-revoked');
            return;
        }
        let message: PluginRuntimeInboundMessage;
        try {
            message = parsePluginRuntimeInboundMessage(input);
        } catch (error) {
            const candidate = typeof input === 'object' && input !== null
                ? input as Record<string, unknown>
                : {};
            const requestId = StableContractIdSchema.safeParse(candidate.requestId);
            const matchingSession = candidate.sessionId === sessionId;
            if (requestId.success && matchingSession) {
                protocolViolations += 1;
                if (protocolViolations >= MAX_PLUGIN_RUNTIME_PROTOCOL_VIOLATIONS) {
                    revoke('protocol-violation');
                    return;
                }
                const code = error instanceof PluginRuntimeProtocolError
                    && error.code === 'UNSUPPORTED_RUNTIME_PROTOCOL_VERSION'
                    ? 'UNSUPPORTED_RUNTIME_PROTOCOL_VERSION'
                    : 'INVALID_MESSAGE';
                sendError(requestId.data, runtimeError(code, 'The runtime request envelope is invalid.'));
                return;
            }
            const revoked: PluginRuntimeRevokedMessage = {
                schema: 'axiom.plugin-runtime-message',
                schemaVersion: 1,
                kind: 'revoked',
                sessionId,
                reason: 'protocol-violation',
            };
            send(revoked);
            closeTransport();
            return;
        }

        if (message.sessionId !== sessionId) {
            send({
                schema: 'axiom.plugin-runtime-message',
                schemaVersion: 1,
                kind: 'revoked',
                sessionId,
                reason: 'protocol-violation',
            });
            closeTransport();
            return;
        }

        const currentTime = now();
        recentRequests = recentRequests.filter(timestamp => timestamp > currentTime - 60_000);
        if (recentRequests.length >= MAX_PLUGIN_RUNTIME_REQUESTS_PER_MINUTE) {
            sendError(message.requestId, runtimeError('RATE_LIMITED', 'The runtime request rate limit was reached.', true));
            return;
        }
        recentRequests.push(currentTime);

        if (message.kind === 'cancel') {
            const request = pending.get(message.requestId);
            if (!request || request.settled) return;
            const outcomeMayBeCommitted = request.started
                && MUTATING_RUNTIME_METHODS.has(request.method);
            settle(message.requestId, {
                ok: false,
                error: runtimeError(
                    'CANCELLED',
                    outcomeMayBeCommitted
                        ? 'The request was cancelled after dispatch. The operation may have completed; refresh state before retrying.'
                        : 'The plugin cancelled this request.',
                ),
            });
            return;
        }
        runRequest(message);
    };

    unsubscribe = options.transport.subscribe(handleMessage);
    if (isAuthorized()) {
        send({
            schema: 'axiom.plugin-runtime-message',
            schemaVersion: 1,
            kind: 'ready',
            sessionId,
            apiVersion: NEMOTO_PLUGIN_API_VERSION,
            identity: cloneJson(options.api.identity),
            methods: [...PLUGIN_RUNTIME_METHODS],
            limits: {
                maxRequestBytes: MAX_PLUGIN_RUNTIME_REQUEST_BYTES,
                maxResponseBytes: MAX_PLUGIN_RUNTIME_RESPONSE_BYTES,
                maxInFlight: MAX_PLUGIN_RUNTIME_IN_FLIGHT,
                maxRequestsPerMinute: MAX_PLUGIN_RUNTIME_REQUESTS_PER_MINUTE,
                defaultTimeoutMs: DEFAULT_PLUGIN_RUNTIME_TIMEOUT_MS,
                maxTimeoutMs: MAX_PLUGIN_RUNTIME_TIMEOUT_MS,
            },
        });
    } else {
        revoke('session-revoked');
    }

    return Object.freeze({
        sessionId,
        isClosed: () => closed,
        inFlightCount: () => pending.size,
        revoke,
        dispose: () => revoke('host-disposed'),
    });
}
