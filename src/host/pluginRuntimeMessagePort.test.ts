import { describe, expect, it, vi } from 'vitest';
import type { PluginRuntimeOutboundMessage } from '../plugins/runtimeTransport';
import { createPluginRuntimeMessagePortEndpoint } from './pluginRuntimeMessagePort';

function fakePort() {
    let listener: ((event: MessageEvent) => void) | undefined;
    const port = {
        addEventListener: vi.fn((_type: string, next: (event: MessageEvent) => void) => {
            listener = next;
        }),
        removeEventListener: vi.fn(() => {
            listener = undefined;
        }),
        start: vi.fn(),
        postMessage: vi.fn(),
        close: vi.fn(),
    };
    return {
        port: port as unknown as MessagePort,
        emit: (data: unknown) => listener?.({ data } as MessageEvent),
        spies: port,
    };
}

describe('plugin runtime MessagePort adapter', () => {
    it('relays data-only messages and tears down deterministically', () => {
        const fixture = fakePort();
        const endpoint = createPluginRuntimeMessagePortEndpoint(fixture.port);
        const receive = vi.fn();
        endpoint.subscribe(receive);

        fixture.emit({ kind: 'request' });
        expect(receive).toHaveBeenCalledWith({ kind: 'request' });

        const message = {
            schema: 'axiom.plugin-runtime-message',
            schemaVersion: 1,
            kind: 'revoked',
            sessionId: 'session-1',
            reason: 'host-disposed',
        } as PluginRuntimeOutboundMessage;
        endpoint.send(message);
        expect(fixture.spies.postMessage).toHaveBeenCalledWith(message);

        endpoint.close();
        fixture.emit({ kind: 'request' });
        expect(receive).toHaveBeenCalledTimes(1);
        expect(fixture.spies.close).toHaveBeenCalledOnce();
        expect(() => endpoint.send(message)).toThrow(/closed/i);
    });
});
