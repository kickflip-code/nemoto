import { describe, expect, it } from 'vitest';
import { MAX_PLUGIN_RUNTIME_SOURCE_BYTES } from '../plugins/pluginLimits';
import {
    parsePluginRuntimeLaunchMessage,
    parsePluginRuntimeLauncherControlMessage,
    parsePluginRuntimeLauncherStatusMessage,
} from './pluginRuntimeLauncherContracts';

const launch = (overrides: Record<string, unknown> = {}) => ({
    schema: 'axiom.plugin-runtime-launch',
    schemaVersion: 1,
    kind: 'launch',
    sessionId: 'runtime-session-1',
    launchToken: 'launch-token-1',
    source: 'export async function activate() {}',
    ...overrides,
});

describe('plugin runtime launcher contracts', () => {
    it('accepts one strict, bounded launch document', () => {
        expect(parsePluginRuntimeLaunchMessage(launch())).toMatchObject({
            kind: 'launch',
            sessionId: 'runtime-session-1',
        });
        expect(() => parsePluginRuntimeLaunchMessage(launch({ extra: true }))).toThrow();
        expect(() => parsePluginRuntimeLaunchMessage(launch({
            source: 'å'.repeat(MAX_PLUGIN_RUNTIME_SOURCE_BYTES),
        }))).toThrow(/at most/i);
    });

    it('restricts host control to ping and terminate', () => {
        expect(parsePluginRuntimeLauncherControlMessage({
            schema: 'axiom.plugin-runtime-launcher-control',
            schemaVersion: 1,
            kind: 'ping',
            sessionId: 'runtime-session-1',
            sequence: 4,
        })).toMatchObject({ kind: 'ping', sequence: 4 });
        expect(() => parsePluginRuntimeLauncherControlMessage({
            schema: 'axiom.plugin-runtime-launcher-control',
            schemaVersion: 1,
            kind: 'execute',
            sessionId: 'runtime-session-1',
        })).toThrow();
    });

    it('accepts only sanitized launcher status envelopes', () => {
        expect(parsePluginRuntimeLauncherStatusMessage({
            schema: 'axiom.plugin-runtime-launcher-status',
            schemaVersion: 1,
            kind: 'failed',
            sessionId: 'runtime-session-1',
            error: {
                code: 'WORKER_RUNTIME_FAILED',
                message: 'The isolated plugin runtime failed.',
            },
        })).toMatchObject({ kind: 'failed' });
        expect(() => parsePluginRuntimeLauncherStatusMessage({
            schema: 'axiom.plugin-runtime-launcher-status',
            schemaVersion: 1,
            kind: 'failed',
            sessionId: 'runtime-session-1',
            error: {
                code: 'RAW_PLUGIN_EXCEPTION',
                message: 'C:\\private\\portfolio.json',
                stack: 'secret',
            },
        })).toThrow();
    });

    it('has a stable fail-closed code for an injected native bridge', () => {
        expect(parsePluginRuntimeLauncherStatusMessage({
            schema: 'axiom.plugin-runtime-launcher-status',
            schemaVersion: 1,
            kind: 'failed',
            sessionId: 'runtime-session-1',
            error: {
                code: 'AMBIENT_AUTHORITY_PRESENT',
                message: 'The isolated runtime launcher received ambient native authority.',
            },
        })).toMatchObject({
            kind: 'failed',
            error: { code: 'AMBIENT_AUTHORITY_PRESENT' },
        });
    });
});
