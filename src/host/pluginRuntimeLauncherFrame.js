(() => {
    'use strict';

    const PROTOCOL_VERSION = 1;
    let accepted = false;
    let worker = null;
    let controlPort = null;
    let pluginUrl = null;
    let wrapperUrl = null;
    let sessionId = null;

    const isPortableId = value => (
        typeof value === 'string'
        && value.length >= 1
        && value.length <= 240
        && /^[A-Za-z0-9](?:[A-Za-z0-9._:@/-]*[A-Za-z0-9])?$/.test(value)
    );

    const randomSecret = () => {
        const bytes = new Uint8Array(24);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    };

    const postStatus = (kind, details = {}) => {
        if (!controlPort || !sessionId) return;
        controlPort.postMessage({
            schema: 'axiom.plugin-runtime-launcher-status',
            schemaVersion: PROTOCOL_VERSION,
            kind,
            sessionId,
            ...details,
        });
    };

    const revokeWorkerUrls = () => {
        if (pluginUrl) URL.revokeObjectURL(pluginUrl);
        if (wrapperUrl) URL.revokeObjectURL(wrapperUrl);
        pluginUrl = null;
        wrapperUrl = null;
    };

    const terminate = (notify = true) => {
        if (worker) worker.terminate();
        worker = null;
        revokeWorkerUrls();
        if (notify) postStatus('terminated');
    };

    const fail = (code, message) => {
        postStatus('failed', { error: { code, message } });
        terminate(false);
    };

    const createWrapperSource = (moduleUrl, secret) => `
'use strict';
const __nemotoStatusSecret = ${JSON.stringify(secret)};
const __nemotoModuleUrl = ${JSON.stringify(moduleUrl)};
const __nemotoPostMessage = self.postMessage.bind(self);
const __nemotoAddEventListener = self.addEventListener.bind(self);
let __nemotoBootstrapped = false;

const __nemotoStatus = (kind, details = {}) => __nemotoPostMessage({
    schema: 'axiom.plugin-runtime-worker-status',
    schemaVersion: 1,
    secret: __nemotoStatusSecret,
    kind,
    ...details,
});

const __nemotoDenyAmbientApis = () => {
    const denied = [
        'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport',
        'Worker', 'SharedWorker', 'BroadcastChannel', 'importScripts',
        'indexedDB', 'caches', 'postMessage', 'close',
    ];
    for (const name of denied) {
        try {
            Object.defineProperty(self, name, {
                value: undefined,
                writable: false,
                configurable: false,
            });
        } catch {
            if (typeof self[name] !== 'undefined') return false;
        }
    }
    return true;
};

__nemotoAddEventListener('message', async event => {
    const message = event.data;
    if (message && message.schema === 'axiom.plugin-runtime-worker-control'
        && message.schemaVersion === 1 && message.kind === 'ping'
        && Number.isSafeInteger(message.sequence) && message.sequence >= 0) {
        __nemotoStatus('pong', { sequence: message.sequence });
        return;
    }
    if (__nemotoBootstrapped || !message
        || message.schema !== 'axiom.plugin-runtime-worker-bootstrap'
        || message.schemaVersion !== 1 || message.kind !== 'bootstrap'
        || !isPortableRuntimeId(message.sessionId) || event.ports.length !== 1) return;

    __nemotoBootstrapped = true;
    const runtimePort = event.ports[0];
    if (!__nemotoDenyAmbientApis()) {
        runtimePort.close();
        __nemotoStatus('failed', { code: 'WORKER_BOOTSTRAP_FAILED' });
        return;
    }

    try {
        const pluginModule = await import(__nemotoModuleUrl);
        if (!pluginModule || typeof pluginModule.activate !== 'function') {
            throw new Error('missing activate export');
        }
        const runtime = Object.freeze({
            schema: 'axiom.plugin-runtime',
            schemaVersion: 1,
            sessionId: message.sessionId,
            port: runtimePort,
        });
        await pluginModule.activate(runtime);
        __nemotoStatus('ready');
    } catch {
        runtimePort.close();
        __nemotoStatus('failed', { code: 'WORKER_RUNTIME_FAILED' });
    }
});

const isPortableRuntimeId = value => (
    typeof value === 'string'
    && value.length >= 1
    && value.length <= 240
    && /^[A-Za-z0-9](?:[A-Za-z0-9._:@/-]*[A-Za-z0-9])?$/.test(value)
);
`;

    const handleControl = event => {
        const message = event.data;
        if (!message || message.schema !== 'axiom.plugin-runtime-launcher-control'
            || message.schemaVersion !== PROTOCOL_VERSION
            || message.sessionId !== sessionId) return;
        if (message.kind === 'terminate') {
            terminate();
            return;
        }
        if (message.kind === 'ping' && Number.isSafeInteger(message.sequence)
            && message.sequence >= 0 && worker) {
            worker.postMessage({
                schema: 'axiom.plugin-runtime-worker-control',
                schemaVersion: PROTOCOL_VERSION,
                kind: 'ping',
                sequence: message.sequence,
            });
        }
    };

    const handleLaunch = event => {
        if (accepted || event.source !== parent) return;
        const message = event.data;
        if (!message || message.schema !== 'axiom.plugin-runtime-launch'
            || message.schemaVersion !== PROTOCOL_VERSION || message.kind !== 'launch'
            || !isPortableId(message.sessionId) || !isPortableId(message.launchToken)
            || typeof message.source !== 'string' || message.source.length === 0
            || event.ports.length !== 2) return;

        accepted = true;
        window.removeEventListener('message', handleLaunch);
        sessionId = message.sessionId;
        const runtimePort = event.ports[0];
        controlPort = event.ports[1];
        controlPort.addEventListener('message', handleControl);
        controlPort.start();

        if (typeof globalThis.__TAURI_INTERNALS__ !== 'undefined'
            || typeof globalThis.__TAURI__ !== 'undefined') {
            runtimePort.close();
            fail(
                'AMBIENT_AUTHORITY_PRESENT',
                'The isolated runtime launcher received ambient native authority.',
            );
            return;
        }

        try {
            const secret = randomSecret();
            pluginUrl = URL.createObjectURL(new Blob([message.source], { type: 'text/javascript' }));
            wrapperUrl = URL.createObjectURL(new Blob([
                createWrapperSource(pluginUrl, secret),
            ], { type: 'text/javascript' }));
            worker = new Worker(wrapperUrl, {
                name: `axiom-plugin-${message.sessionId}`,
            });
            worker.addEventListener('message', workerEvent => {
                const status = workerEvent.data;
                if (!status || status.schema !== 'axiom.plugin-runtime-worker-status'
                    || status.schemaVersion !== PROTOCOL_VERSION || status.secret !== secret) return;
                if (status.kind === 'pong' && Number.isSafeInteger(status.sequence)
                    && status.sequence >= 0) {
                    postStatus('pong', { sequence: status.sequence });
                    return;
                }
                if (status.kind === 'ready') {
                    if (pluginUrl) URL.revokeObjectURL(pluginUrl);
                    pluginUrl = null;
                    postStatus('ready');
                    return;
                }
                if (status.kind === 'failed') {
                    fail(
                        status.code === 'WORKER_BOOTSTRAP_FAILED'
                            ? 'WORKER_BOOTSTRAP_FAILED'
                            : 'WORKER_RUNTIME_FAILED',
                        'The isolated plugin runtime could not start.',
                    );
                }
            });
            worker.addEventListener('error', eventError => {
                eventError.preventDefault();
                fail('WORKER_RUNTIME_FAILED', 'The isolated plugin runtime failed.');
            });
            worker.addEventListener('messageerror', () => {
                fail('WORKER_MESSAGE_ERROR', 'The isolated plugin runtime sent an unreadable message.');
            });
            worker.postMessage({
                schema: 'axiom.plugin-runtime-worker-bootstrap',
                schemaVersion: PROTOCOL_VERSION,
                kind: 'bootstrap',
                sessionId,
            }, [runtimePort]);
            postStatus('worker-started');
        } catch {
            runtimePort.close();
            fail('WORKER_START_FAILED', 'The isolated plugin Worker could not be created.');
        }
    };

    window.addEventListener('message', handleLaunch);
    window.addEventListener('pagehide', () => terminate(false), { once: true });
})();
