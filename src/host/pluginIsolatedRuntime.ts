import { z } from 'zod';
import {
    DEFAULT_PLUGIN_RUNTIME_HEARTBEAT_INTERVAL_MS,
    DEFAULT_PLUGIN_RUNTIME_HEARTBEAT_TIMEOUT_MS,
    DEFAULT_PLUGIN_RUNTIME_STARTUP_TIMEOUT_MS,
} from '../plugins/pluginLimits';
import type { NemotoPluginApi } from '../plugins/publicApi';
import {
    parsePluginRuntimeLaunchMessage,
    parsePluginRuntimeLauncherControlMessage,
    parsePluginRuntimeLauncherStatusMessage,
    type PluginRuntimeLauncherFailureCode,
    type PluginRuntimeLauncherStatusMessage,
} from './pluginRuntimeLauncherContracts';
import { PLUGIN_RUNTIME_LAUNCHER_DOCUMENT } from './pluginRuntimeLauncherSource';
import { createPluginRuntimeBroker, type PluginRuntimeBroker } from './pluginRuntimeBroker';
import { createPluginRuntimeMessagePortEndpoint } from './pluginRuntimeMessagePort';

export type PluginIsolatedRuntimeFailureCode = PluginRuntimeLauncherFailureCode
    | 'SESSION_UNAUTHORIZED'
    | 'LAUNCHER_STARTUP_TIMEOUT'
    | 'LAUNCHER_PROTOCOL_VIOLATION';

export class PluginIsolatedRuntimeError extends Error {
    constructor(
        readonly code: PluginIsolatedRuntimeFailureCode,
        message: string,
    ) {
        super(message);
        this.name = 'PluginIsolatedRuntimeError';
    }
}

export interface PluginIsolatedRuntimeSession {
    readonly sessionId: string;
    readonly state: () => 'running' | 'failed' | 'closed';
    readonly failure: () => PluginIsolatedRuntimeError | null;
    readonly revoke: () => void;
    readonly dispose: () => void;
}

export interface PluginIsolatedRuntimeEnvironment {
    readonly document: Document;
    readonly createMessageChannel: () => MessageChannel;
    readonly randomToken: () => string;
    readonly setTimer: (
        callback: () => void,
        delayMs: number,
    ) => ReturnType<typeof setTimeout>;
    readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface PluginIsolatedRuntimeOptions {
    readonly sessionId: string;
    /** Complete ESM source with one exported async `activate(runtime)` function. */
    readonly source: string;
    readonly api: NemotoPluginApi;
    readonly isSessionAuthorized: () => boolean;
    readonly onFailure?: (error: PluginIsolatedRuntimeError) => void;
    readonly startupTimeoutMs?: number;
    readonly heartbeatIntervalMs?: number;
    readonly heartbeatTimeoutMs?: number;
    readonly environment?: Partial<PluginIsolatedRuntimeEnvironment>;
}

const RuntimeTimingSchema = z.number().int().min(10).max(60_000);

const authorized = (predicate: () => boolean): boolean => {
    try {
        return predicate();
    } catch {
        return false;
    }
};

const browserRandomToken = (): string => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};

const defaultEnvironment = (): PluginIsolatedRuntimeEnvironment => ({
    document,
    createMessageChannel: () => new MessageChannel(),
    randomToken: browserRandomToken,
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: timer => clearTimeout(timer),
});

const createRuntimeFrame = (documentValue: Document): HTMLIFrameElement => {
    const frame = documentValue.createElement('iframe');
    frame.title = 'Nemoto isolated plugin runtime';
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute(
        'allow',
        "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'",
    );
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.visibility = 'hidden';
    frame.style.pointerEvents = 'none';
    frame.srcdoc = PLUGIN_RUNTIME_LAUNCHER_DOCUMENT;
    return frame;
};

export function launchIsolatedPluginRuntime(
    options: PluginIsolatedRuntimeOptions,
): Promise<PluginIsolatedRuntimeSession> {
    const defaults = defaultEnvironment();
    const environment: PluginIsolatedRuntimeEnvironment = {
        ...defaults,
        ...options.environment,
    };
    const startupTimeoutMs = RuntimeTimingSchema.parse(
        options.startupTimeoutMs ?? DEFAULT_PLUGIN_RUNTIME_STARTUP_TIMEOUT_MS,
    );
    const heartbeatIntervalMs = RuntimeTimingSchema.parse(
        options.heartbeatIntervalMs ?? DEFAULT_PLUGIN_RUNTIME_HEARTBEAT_INTERVAL_MS,
    );
    const heartbeatTimeoutMs = RuntimeTimingSchema.parse(
        options.heartbeatTimeoutMs ?? DEFAULT_PLUGIN_RUNTIME_HEARTBEAT_TIMEOUT_MS,
    );
    if (!environment.document.body) {
        throw new PluginIsolatedRuntimeError(
            'WORKER_START_FAILED',
            'The isolated runtime requires a mounted document body.',
        );
    }
    if (!authorized(options.isSessionAuthorized)) {
        throw new PluginIsolatedRuntimeError(
            'SESSION_UNAUTHORIZED',
            'The plugin runtime session is not authorized.',
        );
    }

    const launchToken = environment.randomToken();
    const launchMessage = parsePluginRuntimeLaunchMessage({
        schema: 'axiom.plugin-runtime-launch',
        schemaVersion: 1,
        kind: 'launch',
        sessionId: options.sessionId,
        launchToken,
        source: options.source,
    });
    const runtimeChannel = environment.createMessageChannel();
    const controlChannel = environment.createMessageChannel();
    const runtimeEndpoint = createPluginRuntimeMessagePortEndpoint(runtimeChannel.port1);
    const broker: PluginRuntimeBroker = createPluginRuntimeBroker({
        sessionId: launchMessage.sessionId,
        api: options.api,
        transport: runtimeEndpoint,
        isSessionAuthorized: options.isSessionAuthorized,
    });
    const frame = createRuntimeFrame(environment.document);
    let runtimeState: 'starting' | 'running' | 'failed' | 'closed' = 'starting';
    let runtimeFailure: PluginIsolatedRuntimeError | null = null;
    let postedLaunch = false;
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatSequence = 0;
    let awaitingPong: number | null = null;
    let resolveStartup!: (session: PluginIsolatedRuntimeSession) => void;
    let rejectStartup!: (error: PluginIsolatedRuntimeError) => void;

    const clearTimers = () => {
        if (heartbeatTimer !== undefined) environment.clearTimer(heartbeatTimer);
        if (startupTimer !== undefined) environment.clearTimer(startupTimer);
        heartbeatTimer = undefined;
        startupTimer = undefined;
    };

    const postControl = (message: unknown): boolean => {
        if (runtimeState === 'closed' || runtimeState === 'failed') return false;
        try {
            controlChannel.port1.postMessage(parsePluginRuntimeLauncherControlMessage(message));
            return true;
        } catch {
            return false;
        }
    };

    const notifyFailure = (error: PluginIsolatedRuntimeError) => {
        try {
            options.onFailure?.(error);
        } catch {
            // Plugin lifecycle observers never own runtime teardown.
        }
    };

    const removeFrame = () => {
        frame.removeEventListener('load', postLaunch);
        frame.removeEventListener('error', handleFrameError);
        frame.remove();
    };

    const closeInfrastructure = (
        brokerReason: 'runtime-failed' | 'session-revoked' | 'host-disposed',
    ) => {
        clearTimers();
        try {
            controlChannel.port1.postMessage(parsePluginRuntimeLauncherControlMessage({
                schema: 'axiom.plugin-runtime-launcher-control',
                schemaVersion: 1,
                kind: 'terminate',
                sessionId: launchMessage.sessionId,
            }));
        } catch {
            // Destroying the iframe remains the definitive kill path.
        }
        if (brokerReason === 'host-disposed') broker.dispose();
        else broker.revoke(brokerReason);
        try {
            controlChannel.port1.close();
        } catch {
            // Teardown continues by destroying the opaque browsing context.
        }
        removeFrame();
    };

    const failRuntime = (error: PluginIsolatedRuntimeError) => {
        if (runtimeState === 'failed' || runtimeState === 'closed') return;
        const wasStarting = runtimeState === 'starting';
        runtimeState = 'failed';
        runtimeFailure = error;
        closeInfrastructure('runtime-failed');
        notifyFailure(error);
        if (wasStarting) rejectStartup(error);
    };

    const scheduleHeartbeat = () => {
        if (runtimeState !== 'running') return;
        heartbeatTimer = environment.setTimer(() => {
            heartbeatTimer = undefined;
            if (!authorized(options.isSessionAuthorized)) {
                runtimeState = 'closed';
                closeInfrastructure('session-revoked');
                return;
            }
            if (broker.isClosed()) {
                runtimeState = 'closed';
                closeInfrastructure('session-revoked');
                return;
            }
            heartbeatSequence += 1;
            awaitingPong = heartbeatSequence;
            if (!postControl({
                schema: 'axiom.plugin-runtime-launcher-control',
                schemaVersion: 1,
                kind: 'ping',
                sessionId: launchMessage.sessionId,
                sequence: heartbeatSequence,
            })) {
                failRuntime(new PluginIsolatedRuntimeError(
                    'RUNTIME_UNRESPONSIVE',
                    'The isolated plugin runtime control channel failed.',
                ));
                return;
            }
            heartbeatTimer = environment.setTimer(() => {
                heartbeatTimer = undefined;
                failRuntime(new PluginIsolatedRuntimeError(
                    'RUNTIME_UNRESPONSIVE',
                    'The isolated plugin runtime stopped responding.',
                ));
            }, heartbeatTimeoutMs);
        }, heartbeatIntervalMs);
    };

    const session: PluginIsolatedRuntimeSession = Object.freeze({
        sessionId: launchMessage.sessionId,
        state: () => runtimeState === 'starting' ? 'closed' : runtimeState,
        failure: () => runtimeFailure,
        revoke: () => {
            if (runtimeState === 'closed' || runtimeState === 'failed') return;
            runtimeState = 'closed';
            closeInfrastructure('session-revoked');
        },
        dispose: () => {
            if (runtimeState === 'closed' || runtimeState === 'failed') return;
            runtimeState = 'closed';
            closeInfrastructure('host-disposed');
        },
    });

    const handleStatus = (event: MessageEvent<unknown>) => {
        if (runtimeState === 'closed' || runtimeState === 'failed') return;
        let status: PluginRuntimeLauncherStatusMessage;
        try {
            status = parsePluginRuntimeLauncherStatusMessage(event.data);
        } catch {
            failRuntime(new PluginIsolatedRuntimeError(
                'LAUNCHER_PROTOCOL_VIOLATION',
                'The isolated runtime launcher sent an invalid status message.',
            ));
            return;
        }
        if (status.sessionId !== launchMessage.sessionId) {
            failRuntime(new PluginIsolatedRuntimeError(
                'LAUNCHER_PROTOCOL_VIOLATION',
                'The isolated runtime launcher changed session identity.',
            ));
            return;
        }
        if (status.kind === 'failed') {
            failRuntime(new PluginIsolatedRuntimeError(status.error.code, status.error.message));
            return;
        }
        if (status.kind === 'terminated') {
            failRuntime(new PluginIsolatedRuntimeError(
                'WORKER_RUNTIME_FAILED',
                'The isolated plugin Worker terminated unexpectedly.',
            ));
            return;
        }
        if (status.kind === 'ready') {
            if (runtimeState !== 'starting') {
                failRuntime(new PluginIsolatedRuntimeError(
                    'LAUNCHER_PROTOCOL_VIOLATION',
                    'The isolated runtime launcher repeated its ready signal.',
                ));
                return;
            }
            if (startupTimer !== undefined) environment.clearTimer(startupTimer);
            startupTimer = undefined;
            runtimeState = 'running';
            scheduleHeartbeat();
            resolveStartup(session);
            return;
        }
        if (status.kind === 'pong') {
            if (runtimeState !== 'running' || status.sequence !== awaitingPong) return;
            if (heartbeatTimer !== undefined) environment.clearTimer(heartbeatTimer);
            heartbeatTimer = undefined;
            awaitingPong = null;
            scheduleHeartbeat();
        }
    };

    controlChannel.port1.addEventListener('message', handleStatus);
    controlChannel.port1.start();

    function postLaunch(): void {
        if (postedLaunch || runtimeState !== 'starting') return;
        postedLaunch = true;
        try {
            if (!frame.contentWindow) throw new Error('missing frame window');
            frame.contentWindow.postMessage(
                launchMessage,
                '*',
                [runtimeChannel.port2, controlChannel.port2],
            );
        } catch {
            failRuntime(new PluginIsolatedRuntimeError(
                'WORKER_START_FAILED',
                'The isolated runtime launcher could not receive its one-time channel.',
            ));
        }
    }

    function handleFrameError(): void {
        failRuntime(new PluginIsolatedRuntimeError(
            'WORKER_START_FAILED',
            'The isolated runtime launcher document failed to load.',
        ));
    }

    const startup = new Promise<PluginIsolatedRuntimeSession>((resolve, reject) => {
        resolveStartup = resolve;
        rejectStartup = reject;
        frame.addEventListener('load', postLaunch, { once: true });
        frame.addEventListener('error', handleFrameError, { once: true });
        startupTimer = environment.setTimer(() => {
            startupTimer = undefined;
            failRuntime(new PluginIsolatedRuntimeError(
                'LAUNCHER_STARTUP_TIMEOUT',
                'The isolated plugin runtime did not become ready in time.',
            ));
        }, startupTimeoutMs);
        environment.document.body.append(frame);
    });

    return startup;
}
