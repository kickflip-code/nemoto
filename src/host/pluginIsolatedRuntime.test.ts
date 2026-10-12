import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEMOTO_PLUGIN_API_VERSION } from '../plugins/activation';
import type { NemotoPluginApi } from '../plugins/publicApi';
import type { PluginRuntimeLauncherStatusMessage } from './pluginRuntimeLauncherContracts';
import {
    launchIsolatedPluginRuntime,
    PluginIsolatedRuntimeError,
} from './pluginIsolatedRuntime';

class FakePort {
    peer: FakePort | undefined;
    closed = false;
    started = false;
    readonly sent: unknown[] = [];
    readonly transferred: Transferable[][] = [];
    readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
    readonly queue: Array<{ data: unknown; ports: readonly MessagePort[] }> = [];

    postMessage(message: unknown, transfer: Transferable[] = []): void {
        if (this.closed) throw new Error('port closed');
        this.sent.push(structuredClone(message));
        this.transferred.push([...transfer]);
        const ports = transfer.filter((item): item is MessagePort => (
            typeof item === 'object' && item !== null
        ));
        this.peer?.receive(message, ports);
    }

    receive(data: unknown, ports: readonly MessagePort[]): void {
        if (this.closed) return;
        if (!this.started || this.listeners.size === 0) {
            this.queue.push({ data, ports });
            return;
        }
        const event = { data: structuredClone(data), ports } as MessageEvent<unknown>;
        this.listeners.forEach(listener => listener(event));
    }

    addEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void): void {
        this.listeners.add(listener);
        this.flush();
    }

    removeEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void): void {
        this.listeners.delete(listener);
    }

    start(): void {
        this.started = true;
        this.flush();
    }

    close(): void {
        this.closed = true;
        this.listeners.clear();
        this.queue.length = 0;
    }

    flush(): void {
        if (!this.started || this.listeners.size === 0) return;
        while (this.queue.length > 0) {
            const next = this.queue.shift()!;
            this.receive(next.data, next.ports);
        }
    }
}

const fakeChannel = (): MessageChannel & { port1: FakePort; port2: FakePort } => {
    const port1 = new FakePort();
    const port2 = new FakePort();
    port1.peer = port2;
    port2.peer = port1;
    return { port1, port2 } as unknown as MessageChannel & { port1: FakePort; port2: FakePort };
};

const api = (): NemotoPluginApi => ({
    apiVersion: NEMOTO_PLUGIN_API_VERSION,
    identity: {
        pluginId: 'org.axiom.runtime-fixture',
        pluginVersion: '0.1.0',
        dataVersion: 1,
    },
} as NemotoPluginApi);

const status = (
    kind: PluginRuntimeLauncherStatusMessage['kind'],
    details: Record<string, unknown> = {},
): PluginRuntimeLauncherStatusMessage => ({
    schema: 'axiom.plugin-runtime-launcher-status',
    schemaVersion: 1,
    kind,
    sessionId: 'runtime-session-1',
    ...details,
} as PluginRuntimeLauncherStatusMessage);

const setup = (overrides: {
    authorized?: () => boolean;
    onFailure?: (error: PluginIsolatedRuntimeError) => void;
} = {}) => {
    const runtimeChannel = fakeChannel();
    const controlChannel = fakeChannel();
    const channels = [runtimeChannel, controlChannel];
    const promise = launchIsolatedPluginRuntime({
        sessionId: 'runtime-session-1',
        source: 'export async function activate() {}',
        api: api(),
        isSessionAuthorized: overrides.authorized || (() => true),
        onFailure: overrides.onFailure,
        startupTimeoutMs: 100,
        heartbeatIntervalMs: 50,
        heartbeatTimeoutMs: 75,
        environment: {
            document,
            createMessageChannel: () => channels.shift()!,
            randomToken: () => 'launch-token-1',
        },
    });
    const frame = document.querySelector<HTMLIFrameElement>(
        'iframe[title="Nemoto isolated plugin runtime"]',
    )!;
    const postMessage = vi.fn();
    Object.defineProperty(frame, 'contentWindow', {
        configurable: true,
        value: { postMessage },
    });
    frame.dispatchEvent(new Event('load'));
    return { promise, frame, postMessage, runtimeChannel, controlChannel };
};

const markReady = async (fixture: ReturnType<typeof setup>) => {
    fixture.controlChannel.port2.postMessage(status('worker-started'));
    fixture.controlChannel.port2.postMessage(status('ready'));
    return fixture.promise;
};

afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('iframe[title="Nemoto isolated plugin runtime"]')
        .forEach(frame => frame.remove());
});

describe('isolated plugin runtime lifecycle', () => {
    it('creates only an opaque allow-scripts frame and transfers one-time channels', async () => {
        vi.useFakeTimers();
        const fixture = setup();
        expect(fixture.frame.getAttribute('sandbox')).toBe('allow-scripts');
        expect(fixture.frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
        expect(fixture.frame.getAttribute('allow')).toContain("camera 'none'");
        expect(fixture.frame.srcdoc).toContain("default-src 'none'");
        expect(fixture.postMessage).toHaveBeenCalledTimes(1);
        expect(fixture.postMessage.mock.calls[0][1]).toBe('*');
        expect(fixture.postMessage.mock.calls[0][2]).toEqual([
            fixture.runtimeChannel.port2,
            fixture.controlChannel.port2,
        ]);

        const session = await markReady(fixture);
        expect(session.state()).toBe('running');
        session.dispose();
        expect(session.state()).toBe('closed');
        expect(document.body.contains(fixture.frame)).toBe(false);
        expect(fixture.controlChannel.port1.sent).toContainEqual(expect.objectContaining({
            kind: 'terminate',
        }));
    });

    it('rejects invalid source and initial authority before creating a frame', () => {
        expect(() => launchIsolatedPluginRuntime({
            sessionId: 'runtime-session-1',
            source: '',
            api: api(),
            isSessionAuthorized: () => true,
        })).toThrow();
        expect(() => launchIsolatedPluginRuntime({
            sessionId: 'runtime-session-1',
            source: 'export async function activate() {}',
            api: api(),
            isSessionAuthorized: () => false,
        })).toThrow(PluginIsolatedRuntimeError);
        expect(document.querySelector('iframe[title="Nemoto isolated plugin runtime"]')).toBeNull();
    });

    it('fails closed when startup expires or launcher status is malformed', async () => {
        vi.useFakeTimers();
        const timeout = setup();
        const timeoutAssertion = expect(timeout.promise).rejects.toMatchObject({
            code: 'LAUNCHER_STARTUP_TIMEOUT',
        });
        await vi.advanceTimersByTimeAsync(100);
        await timeoutAssertion;
        expect(document.body.contains(timeout.frame)).toBe(false);

        const malformed = setup();
        const malformedAssertion = expect(malformed.promise).rejects.toMatchObject({
            code: 'LAUNCHER_PROTOCOL_VIOLATION',
        });
        malformed.controlChannel.port2.postMessage({ unsafe: true });
        await malformedAssertion;
        expect(document.body.contains(malformed.frame)).toBe(false);
    });

    it('terminates an unresponsive Worker through the independent control channel', async () => {
        vi.useFakeTimers();
        const onFailure = vi.fn();
        const fixture = setup({ onFailure });
        const session = await markReady(fixture);

        await vi.advanceTimersByTimeAsync(50);
        expect(fixture.controlChannel.port1.sent).toContainEqual(expect.objectContaining({
            kind: 'ping',
            sequence: 1,
        }));
        await vi.advanceTimersByTimeAsync(75);

        expect(session.state()).toBe('failed');
        expect(session.failure()).toMatchObject({ code: 'RUNTIME_UNRESPONSIVE' });
        expect(onFailure).toHaveBeenCalledOnce();
        expect(document.body.contains(fixture.frame)).toBe(false);
    });

    it('keeps a responsive session alive and revokes it when live authority changes', async () => {
        vi.useFakeTimers();
        let authorized = true;
        const fixture = setup({ authorized: () => authorized });
        const session = await markReady(fixture);

        await vi.advanceTimersByTimeAsync(50);
        fixture.controlChannel.port2.postMessage(status('pong', { sequence: 1 }));
        expect(session.state()).toBe('running');

        authorized = false;
        await vi.advanceTimersByTimeAsync(50);
        expect(session.state()).toBe('closed');
        expect(session.failure()).toBeNull();
        expect(document.body.contains(fixture.frame)).toBe(false);
    });

    it('treats a repeated ready signal as a protocol violation', async () => {
        vi.useFakeTimers();
        const fixture = setup();
        const session = await markReady(fixture);
        fixture.controlChannel.port2.postMessage(status('ready'));

        expect(session.state()).toBe('failed');
        expect(session.failure()).toMatchObject({ code: 'LAUNCHER_PROTOCOL_VIOLATION' });
    });
});
