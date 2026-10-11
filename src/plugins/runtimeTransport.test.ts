import { describe, expect, it } from 'vitest';
import {
    MAX_PLUGIN_RUNTIME_REQUEST_BYTES,
} from './pluginLimits';
import {
    PLUGIN_RUNTIME_METHODS,
    PluginRuntimeProtocolError,
    parsePluginRuntimeInboundMessage,
    parsePluginRuntimeOutboundMessage,
} from './runtimeTransport';

const request = (overrides: Record<string, unknown> = {}) => ({
    schema: 'axiom.plugin-runtime-message',
    schemaVersion: 1,
    kind: 'request',
    sessionId: 'session-1',
    requestId: 'request-1',
    method: 'workspace.describe',
    payload: null,
    ...overrides,
});

const ready = (methods: readonly string[] = PLUGIN_RUNTIME_METHODS) => ({
    schema: 'axiom.plugin-runtime-message',
    schemaVersion: 1,
    kind: 'ready',
    sessionId: 'session-1',
    apiVersion: '1.6.0',
    identity: {
        pluginId: 'org.axiom.fixture',
        pluginVersion: '0.1.0',
        dataVersion: 1,
    },
    methods,
    limits: {
        maxRequestBytes: 256 * 1024,
        maxResponseBytes: 2 * 1024 * 1024,
        maxInFlight: 8,
        maxRequestsPerMinute: 120,
        defaultTimeoutMs: 10_000,
        maxTimeoutMs: 30_000,
    },
});

describe('plugin runtime transport contract', () => {
    it('accepts bounded request and cancel envelopes', () => {
        expect(parsePluginRuntimeInboundMessage(request())).toMatchObject({
            kind: 'request',
            method: 'workspace.describe',
        });
        expect(parsePluginRuntimeInboundMessage({
            schema: 'axiom.plugin-runtime-message',
            schemaVersion: 1,
            kind: 'cancel',
            sessionId: 'session-1',
            requestId: 'request-1',
        })).toMatchObject({ kind: 'cancel', requestId: 'request-1' });
    });

    it('rejects unknown fields, non-JSON values, and oversized UTF-8 messages', () => {
        expect(() => parsePluginRuntimeInboundMessage(request({ ambientAuthority: true })))
            .toThrow(PluginRuntimeProtocolError);

        const cyclic: Record<string, unknown> = request();
        cyclic.cyclic = cyclic;
        expect(() => parsePluginRuntimeInboundMessage(cyclic)).toThrow(/serializable JSON/i);

        const oversized = request({ payload: 'å'.repeat(MAX_PLUGIN_RUNTIME_REQUEST_BYTES) });
        expect(() => parsePluginRuntimeInboundMessage(oversized)).toThrow(/at most/i);
    });

    it('distinguishes unsupported future versions from malformed messages', () => {
        try {
            parsePluginRuntimeInboundMessage(request({ schemaVersion: 2 }));
            throw new Error('Expected parser to reject a future protocol version.');
        } catch (error) {
            expect(error).toBeInstanceOf(PluginRuntimeProtocolError);
            expect((error as PluginRuntimeProtocolError).code)
                .toBe('UNSUPPORTED_RUNTIME_PROTOCOL_VERSION');
        }
    });

    it('requires the complete canonical method inventory in ready messages', () => {
        expect(parsePluginRuntimeOutboundMessage(ready()).kind).toBe('ready');

        const reordered = [...PLUGIN_RUNTIME_METHODS];
        [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
        expect(() => parsePluginRuntimeOutboundMessage(ready(reordered)))
            .toThrow(/validation failed/i);
    });

    it('accepts only JSON response results and stable sanitized errors', () => {
        expect(parsePluginRuntimeOutboundMessage({
            schema: 'axiom.plugin-runtime-message',
            schemaVersion: 1,
            kind: 'response',
            sessionId: 'session-1',
            requestId: 'request-1',
            ok: true,
            result: { status: 'ok' },
        })).toMatchObject({ ok: true, result: { status: 'ok' } });

        expect(() => parsePluginRuntimeOutboundMessage({
            schema: 'axiom.plugin-runtime-message',
            schemaVersion: 1,
            kind: 'response',
            sessionId: 'session-1',
            requestId: 'request-1',
            ok: true,
            result: undefined,
        })).toThrow(PluginRuntimeProtocolError);
    });
});
