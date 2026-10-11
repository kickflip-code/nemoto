import type { PluginRuntimeOutboundMessage } from '../plugins/runtimeTransport';
import type { PluginRuntimeTransportEndpoint } from './pluginRuntimeBroker';

/**
 * Adapts one host-owned MessagePort to the runtime broker. The port carries
 * data only; parsing, authorization, quotas, and routing remain in the broker.
 */
export function createPluginRuntimeMessagePortEndpoint(
    port: MessagePort,
): PluginRuntimeTransportEndpoint {
    let closed = false;
    const listeners = new Set<(message: unknown) => void>();
    const handleMessage = (event: MessageEvent<unknown>) => {
        listeners.forEach(listener => listener(event.data));
    };

    port.addEventListener('message', handleMessage);
    port.start();

    return Object.freeze({
        send(message: PluginRuntimeOutboundMessage): void {
            if (closed) throw new Error('Plugin runtime transport is closed.');
            port.postMessage(message);
        },
        subscribe(listener: (message: unknown) => void): () => void {
            if (closed) throw new Error('Plugin runtime transport is closed.');
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        close(): void {
            if (closed) return;
            closed = true;
            listeners.clear();
            port.removeEventListener('message', handleMessage);
            port.close();
        },
    });
}
