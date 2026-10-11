import { describe, expect, it, vi } from 'vitest';
import type { PluginHostEvent } from '../plugins/hostServices';
import type { PluginUiInput, PluginUiResult } from '../plugins/pluginUiContracts';
import type { PluginUiEffectReceipt } from './pluginUiEffects';
import { createPluginUiSession } from './pluginUiSession';

const authority = {
    pluginId: 'org.example.queue',
    pluginVersion: '1.0.0',
    dataVersion: 1,
    viewId: 'org.example.queue/view',
    operation: 'ui.reduce',
} as const;

const environment = {
    observedAt: '2026-09-12T10:00:00.000Z',
    localDate: '2026-09-12',
    timezoneOffsetMinutes: -120,
    viewport: 'wide' as const,
    theme: { colorScheme: 'dark' as const, density: 'comfortable' as const },
    allocatedIds: [],
};

const tree = (label: string) => ({
    key: 'root', type: 'stack' as const, direction: 'vertical' as const,
    gap: 'small' as const, wrap: false,
    children: [
        { key: 'status', type: 'text' as const, text: label, role: 'status' as const, tone: 'default' as const },
        { key: 'title', type: 'text-input' as const, label: 'Title', actionId: 'title.change', value: '', required: false, disabled: false, maxLength: 100 },
        { key: 'name', type: 'text-input' as const, label: 'Name', actionId: 'name.change', value: '', required: false, disabled: false, maxLength: 100 },
        { key: 'notes', type: 'rich-text' as const, label: 'Notes', actionId: 'notes.change', value: { type: 'doc', content: [{ type: 'paragraph' }] }, editable: true, draftRevision: 4 },
        { key: 'save', type: 'button' as const, label: 'Save', actionId: 'record.save', disabled: false, variant: 'primary' as const },
    ],
});

const resultFor = (
    input: PluginUiInput,
    label = input.event.kind,
    effects: PluginUiResult['effects'] = [],
): PluginUiResult => ({
    schema: 'axiom.plugin-ui-result', schemaVersion: 1, protocolVersion: 1,
    instanceId: input.instanceId, sequence: input.sequence,
    uiRevision: input.uiRevision, portfolioRevision: input.portfolioRevision,
    state: { accepted: input.sequence }, tree: tree(label), effects,
});

const outcomeFor = (input: PluginUiInput, result = resultFor(input)) => ({
    viewId: authority.viewId,
    identity: {
        pluginId: authority.pluginId,
        pluginVersion: authority.pluginVersion,
        dataVersion: authority.dataVersion,
    },
    authorityGeneration: 7,
    result,
});

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
};

const waitFor = async (predicate: () => boolean) => {
    for (let index = 0; index < 30 && !predicate(); index += 1) await Promise.resolve();
    expect(predicate()).toBe(true);
};

function harness(
    reduce: (input: PluginUiInput) => Promise<ReturnType<typeof outcomeFor>>,
    capturedContext: Parameters<typeof createPluginUiSession>[0]['capturedContext'] = null,
    surface: Parameters<typeof createPluginUiSession>[0]['surface'] = 'app-rail',
) {
    let current = true;
    let activeView: string = authority.viewId;
    let portfolioRevision = 12;
    const listeners = new Set<(event: PluginHostEvent) => void>();
    const applyEffects = vi.fn(async (
        _authority: unknown,
        _effects: unknown,
        _options?: unknown,
    ): Promise<readonly PluginUiEffectReceipt[]> => []);
    const session = createPluginUiSession({ authority, surface, instanceId: 'ui:test', capturedContext }, {
        reduce: (_viewId, input) => reduce(input),
        applyEffects,
        getPortfolioRevision: () => portfolioRevision,
        getEnvironment: () => environment,
        isAuthorityCurrent: () => current,
        subscribeHostEvents: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getActiveView: () => activeView,
    });
    return {
        session,
        applyEffects,
        emit: (event: PluginHostEvent) => listeners.forEach(listener => listener(event)),
        listenerCount: () => listeners.size,
        revoke: () => { current = false; },
        switchView: (view: string) => { activeView = view; },
        changeRevision: (revision: number) => { portfolioRevision = revision; },
    };
}

describe('plugin composed UI session', () => {
    it.each([true, false])('closes a capture only after a successful storage receipt (ok=%s)', async ok => {
        const committed = deferred<readonly PluginUiEffectReceipt[]>();
        const host = harness(async input => {
            const effects: PluginUiResult['effects'] = input.event.kind === 'action'
                ? [{ id: 'save', kind: 'storage.collection.transact', payload: {
                    collectionId: 'records', expectedPortfolioRevision: input.portfolioRevision,
                    operations: [{ operationId: 'put', kind: 'put', item: {
                        id: 'one', createdAt: environment.observedAt, updatedAt: environment.observedAt,
                        values: { title: 'Captured' },
                    } }],
                } }] : [];
            const result = resultFor(input, input.event.kind, effects);
            result.tree = input.event.kind === 'effect-result' && input.event.ok
                ? { ...tree('closed'), children: [] }
                : { ...tree('editing'), children: [{ key: 'capture', type: 'dialog', label: 'Capture',
                    closeActionId: 'capture.close', dirty: true, children: tree('editing').children }] };
            return outcomeFor(input, result);
        }, null, 'canvas-dialog');
        host.applyEffects.mockImplementation(() => committed.promise);
        host.session.start();
        await waitFor(() => host.session.getSnapshot().pendingEvents === 0);
        expect(host.session.getSnapshot()).toMatchObject({ status: 'ready', error: null });
        expect(host.session.dispatchAction({ controlKey: 'save', actionId: 'record.save',
            value: null, draftRevision: null })).toBe(true);
        await waitFor(() => host.applyEffects.mock.calls.length === 1);
        expect(host.session.getSnapshot().status).not.toBe('disposed');
        committed.resolve(ok
            ? [{ kind: 'effect-result', effectId: 'save', ok: true, result: {} }]
            : [{ kind: 'effect-result', effectId: 'save', ok: false,
                error: { code: 'STORAGE_CONFLICT', message: 'Storage changed.',
                    retryable: true, outcomeUnknown: false } }]);
        await waitFor(() => host.session.getSnapshot().pendingEvents === 0);
        expect(host.session.getSnapshot()).toMatchObject(ok
            ? { status: 'disposed', disposeReason: 'view-closed', error: null }
            : { status: 'ready', disposeReason: null, hasUnsavedChanges: true });
        host.session.dispose();
    });

    it('keeps typed values ahead of a following Save action', async () => {
        const first = deferred<ReturnType<typeof outcomeFor>>();
        const inputs: PluginUiInput[] = [];
        const host = harness(async input => {
            inputs.push(input);
            if (input.event.kind === 'action' && input.event.value === 'a') return first.promise;
            return outcomeFor(input);
        });
        host.session.start();
        await waitFor(() => host.session.getSnapshot().pendingEvents === 0);
        host.session.dispatchAction({ controlKey: 'title', actionId: 'title.change', value: 'a', draftRevision: null });
        for (let length = 2; length < 4; length++) {
            expect(host.session.dispatchAction({ controlKey: 'title', actionId: 'title.change', value: 'a'.repeat(length), draftRevision: null })).toBe(true);
        }
        host.session.dispatchAction({ controlKey: 'save', actionId: 'record.save', value: null, draftRevision: null });
        first.resolve(outcomeFor(inputs[1]));
        await waitFor(() => host.session.getSnapshot().pendingEvents === 0);
        expect(inputs.slice(1).map(input => input.event.kind === 'action' ? input.event.value : null)).toEqual(['a', 'aa', 'aaa', null]);
        host.session.dispose();
    });
    it('acknowledges committed drafts without deleting newer staged edits', async () => {
        const committed = deferred<readonly PluginUiEffectReceipt[]>();
        const host = harness(async input => outcomeFor(input, resultFor(input, input.event.kind,
            input.event.kind === 'action' && input.event.actionId === 'record.save' ? [{
                id: 'save', kind: 'storage.collection.transact', payload: { collectionId: 'records',
                    expectedPortfolioRevision: input.portfolioRevision, operations: [{ operationId: 'put', kind: 'put',
                        item: { id: 'item', createdAt: '2026-09-12T10:00:00.000Z', updatedAt: '2026-09-12T10:00:00.000Z', values: { title: 'Saved' } } }] },
            }] : [])));
        host.applyEffects.mockImplementation(() => committed.promise);
        host.session.start();
        await waitFor(() => host.session.getSnapshot().pendingEvents === 0);
        host.session.stageDraft({ controlKey: 'title', actionId: 'title.change', value: 'Saved', draftRevision: null });
        host.session.stageDraft({ controlKey: 'name', actionId: 'name.change', value: 'Old', draftRevision: null });
        host.session.dispatchAction({ controlKey: 'save', actionId: 'record.save', value: null, draftRevision: null });
        await waitFor(() => host.applyEffects.mock.calls.length === 1);
        host.session.stageDraft({ controlKey: 'name', actionId: 'name.change', value: 'Newer', draftRevision: null });
        committed.resolve([{ kind: 'effect-result', effectId: 'save', ok: true, result: {} }]);
        await waitFor(() => host.session.getSnapshot().pendingEvents === 0);
        expect(host.session.getSnapshot().recoverableDrafts).toEqual({ name: { value: 'Newer', draftRevision: null } });
        host.session.dispose();
    });
    it('does not bless a stale rendered action with a newer Portfolio revision', async () => {
        const reduce = vi.fn(async (input: PluginUiInput) => outcomeFor(input));
        const host = harness(reduce);
        host.session.start();
        await waitFor(() => host.session.getSnapshot().pendingEvents === 0);
        host.changeRevision(13);
        host.session.dispatchAction({ controlKey: 'save', actionId: 'record.save', value: null, draftRevision: null });
        await waitFor(() => host.session.getSnapshot().status === 'error');
        expect(reduce).toHaveBeenCalledTimes(1);
        expect(host.applyEffects).not.toHaveBeenCalled();
        expect(host.session.getSnapshot().error).toMatch(/changed since this view was rendered/);
    });
    it.each(['mount', 'invalidate', 'read-receipt'] as const)('rejects unsolicited mutations from %s before applying any effect', async origin => {
        const mutation = { id: 'write', kind: 'storage.collection.transact' as const, payload: {
            collectionId: 'records', expectedPortfolioRevision: 12, operations: [{
                operationId: 'put', kind: 'put' as const,
                item: { id: 'one', createdAt: environment.observedAt, updatedAt: environment.observedAt, values: { title: 'Unsolicited' } },
            }],
        } };
        const host = harness(async input => outcomeFor(input, resultFor(input, input.event.kind,
            (origin === 'mount' && input.event.kind === 'mount')
                || (origin === 'invalidate' && input.event.kind === 'invalidate')
                || (origin === 'read-receipt' && input.event.kind === 'effect-result') ? [mutation]
                : origin === 'read-receipt' ? [{ id: 'read', kind: 'storage.collection.read-page', payload: { collectionId: 'records', cursor: null, limit: 1 } }] : [],
        )));
        host.applyEffects.mockResolvedValueOnce([{ kind: 'effect-result', effectId: 'read', ok: true, result: null }]);
        host.session.start();
        if (origin === 'invalidate') {
            await waitFor(() => host.session.getSnapshot().pendingEvents === 0);
            host.session.invalidate({ data: true });
        }
        await waitFor(() => host.session.getSnapshot().status === 'error');
        expect(host.session.getSnapshot().error).toMatch(/initiating user action/);
        expect(host.applyEffects.mock.calls.flatMap(call => call[1] as unknown[])).not.toContainEqual(mutation);
    });

    it('serializes rapid input in exact FIFO order', async () => {
        const firstAction = deferred<ReturnType<typeof outcomeFor>>();
        const inputs: PluginUiInput[] = [];
        const host = harness(async input => {
            inputs.push(input);
            return inputs.length === 2 ? firstAction.promise : outcomeFor(input);
        });

        host.session.start();
        await waitFor(() => host.session.getSnapshot().status === 'ready');
        host.session.dispatchAction({ controlKey: 'title', actionId: 'title.change', value: 'A', draftRevision: null });
        host.session.dispatchAction({ controlKey: 'title', actionId: 'title.change', value: 'AB', draftRevision: null });
        host.session.dispatchAction({ controlKey: 'title', actionId: 'title.change', value: 'ABC', draftRevision: null });
        expect(inputs).toHaveLength(2);

        firstAction.resolve(outcomeFor(inputs[1]));
        await waitFor(() => inputs.length === 4 && host.session.getSnapshot().pendingEvents === 0);
        expect(inputs.map(input => input.sequence)).toEqual([1, 2, 3, 4]);
        expect(inputs.map(input => input.event.kind)).toEqual(['mount', 'action', 'action', 'action']);
        expect(inputs.slice(1).map(input => input.event.kind === 'action' ? input.event.value : null)).toEqual(['A', 'AB', 'ABC']);
    });

    it('binds host gesture provenance to the exact button reduction without serializing it', async () => {
        const inputs: PluginUiInput[] = [];
        const host = harness(async input => {
            inputs.push(input);
            const effects = input.event.kind === 'action' ? [{
                id: 'copy', kind: 'output.clipboard-text' as const, payload: { text: 'exact' },
            }] : [];
            return outcomeFor(input, resultFor(input, input.event.kind, effects));
        });

        host.session.start();
        await waitFor(() => host.session.getSnapshot().status === 'ready');
        host.session.dispatchAction({
            controlKey: 'save', actionId: 'record.save', value: null, draftRevision: null, userGesture: true,
        });
        await waitFor(() => host.applyEffects.mock.calls.length === 1);

        expect(inputs[1].event).toEqual({
            kind: 'action', controlKey: 'save', actionId: 'record.save', value: null, draftRevision: null,
        });
        expect(host.applyEffects.mock.calls[0][2]).toMatchObject({ outputGesture: { issuedAt: expect.any(Number) } });
    });

    it('coalesces queued data, workspace, viewport and theme invalidations', async () => {
        const first = deferred<ReturnType<typeof outcomeFor>>();
        const inputs: PluginUiInput[] = [];
        const host = harness(async input => {
            inputs.push(input);
            return inputs.length === 1 ? first.promise : outcomeFor(input);
        });
        host.session.start();
        host.session.invalidate({ data: true });
        host.session.invalidate({ viewport: true });
        host.session.invalidate({ workspace: true, theme: true });

        first.resolve(outcomeFor(inputs[0]));
        await waitFor(() => inputs.length === 2 && host.session.getSnapshot().pendingEvents === 0);
        expect(inputs[1].event).toEqual({
            kind: 'invalidate',
            flags: { data: true, workspace: true, viewport: true, theme: true },
        });
    });

    it('cancels queued work, ignores a late result and unsubscribes after a view switch', async () => {
        const first = deferred<ReturnType<typeof outcomeFor>>();
        const host = harness(async () => first.promise);
        host.session.start();
        host.session.dispatchAction({ controlKey: 'name', actionId: 'name.change', value: 'draft', draftRevision: null });
        host.switchView('designer');
        host.emit({ type: 'navigation.changed', activeView: 'designer', timestamp: environment.observedAt });

        expect(host.session.getSnapshot().disposeReason).toBe('view-switched');
        expect(host.listenerCount()).toBe(0);
        first.resolve(outcomeFor({
            schema: 'axiom.plugin-ui-input', schemaVersion: 1, protocolVersion: 1,
            instanceId: 'ui:test', sequence: 1, uiRevision: 0, portfolioRevision: 12,
            event: { kind: 'mount', surface: 'app-rail', capturedContext: null },
            state: null, snapshots: [], environment,
        }));
        await Promise.resolve();
        expect(host.session.getSnapshot().tree).toBeNull();
        expect(host.applyEffects).not.toHaveBeenCalled();
    });

    it.each([
        ['disable', {
            type: 'portfolio.changed' as const, revision: 13, timestamp: environment.observedAt,
            origin: { kind: 'host' as const, operation: 'plugin.deactivate', pluginId: authority.pluginId },
        }],
        ['update', { type: 'plugins.changed' as const, timestamp: environment.observedAt }],
        ['uninstall', { type: 'plugins.changed' as const, timestamp: environment.observedAt }],
    ])('revokes the session on plugin %s', async (_scenario, event) => {
        const first = deferred<ReturnType<typeof outcomeFor>>();
        const host = harness(async () => first.promise);
        host.session.start();
        host.revoke();
        host.emit(event);
        expect(host.session.getSnapshot().disposeReason).toBe('authority-revoked');
        expect(host.listenerCount()).toBe(0);
    });

    it('keeps a host-held draft recoverable after a storage revision conflict', async () => {
        const inputs: PluginUiInput[] = [];
        const host = harness(async input => {
            inputs.push(input);
            const effects = input.event.kind === 'action' ? [{
                id: 'save', kind: 'storage.document.transact' as const,
                payload: {
                    schema: 'axiom.plugin-storage-transaction' as const,
                    schemaVersion: 1 as const,
                    scope: 'portfolio' as const,
                    expectedPortfolioRevision: 12,
                    operations: [{ operationId: 'save-one', kind: 'delete' as const, key: 'draft', expectedDocumentVersion: null }],
                },
            }] : [];
            return outcomeFor(input, resultFor(input, input.event.kind, effects));
        });
        host.applyEffects.mockResolvedValueOnce([{
            kind: 'effect-result', effectId: 'save', ok: false,
            error: { code: 'REVISION_CONFLICT', message: 'Changed elsewhere.', retryable: true, outcomeUnknown: false },
        }]);
        host.session.start();
        await waitFor(() => host.session.getSnapshot().status === 'ready');
        host.session.dispatchAction({ controlKey: 'notes', actionId: 'notes.change', value: { type: 'doc', content: [{ type: 'paragraph' }] }, draftRevision: 4 });
        await waitFor(() => host.session.getSnapshot().lastConflict !== null && inputs.length === 3);

        expect(host.session.getSnapshot().recoverableDrafts.notes).toEqual({
            value: { type: 'doc', content: [{ type: 'paragraph' }] }, draftRevision: 4,
        });
        expect(host.session.getSnapshot().hasUnsavedChanges).toBe(true);
        expect(host.session.requestClose()).toBe(false);
        expect(host.session.getSnapshot().status).not.toBe('disposed');
        expect(host.session.getSnapshot().lastConflict).toMatchObject({
            kind: 'effect-result', ok: false, error: { code: 'REVISION_CONFLICT' },
        });
    });

    it('stages editor recovery without invoking Wasm and blocks Save until the latest revision is acknowledged', async () => {
        const inputs: PluginUiInput[] = [];
        const host = harness(async input => {
            inputs.push(input);
            return outcomeFor(input);
        });
        host.session.start();
        await waitFor(() => host.session.getSnapshot().status === 'ready');
        const draft = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latest' }] }] };

        expect(host.session.stageDraft({
            controlKey: 'notes', actionId: 'notes.change', value: draft, draftRevision: 5,
        })).toBe(true);
        expect(inputs).toHaveLength(1);
        host.session.dispatchAction({
            controlKey: 'notes', actionId: 'notes.change', value: draft, draftRevision: 5,
        });
        host.session.dispatchAction({
            controlKey: 'save', actionId: 'record.save', value: null, draftRevision: null,
        });
        await waitFor(() => host.session.getSnapshot().status === 'error');

        expect(inputs).toHaveLength(2);
        expect(host.session.getSnapshot().error).toMatch(/acknowledge the latest editor draft revision/i);
        expect(host.session.getSnapshot().recoverableDrafts.notes).toEqual({ value: draft, draftRevision: 5 });
    });

    it('binds a nested canvas mount and its save effects to the same captured reference', async () => {
        const reference = {
            schema: 'axiom.entity-reference' as const, schemaVersion: 1 as const,
            kind: 'core.node' as const, id: 'nested-node',
            location: { processId: 'process-one', graphPath: ['parent'] },
        };
        const inputs: PluginUiInput[] = [];
        const host = harness(async input => {
            inputs.push(input);
            const effects = input.event.kind === 'action' && input.event.actionId === 'record.save'
                ? [{
                    id: 'save', kind: 'storage.collection.transact' as const,
                    payload: { collectionId: 'records', expectedPortfolioRevision: 12, operations: [{
                        operationId: 'put:one', kind: 'put' as const,
                        item: {
                            id: 'one', createdAt: environment.observedAt, updatedAt: environment.observedAt,
                            values: { title: 'Captured' },
                        },
                    }] },
                }]
                : [];
            return outcomeFor(input, resultFor(input, input.event.kind, effects));
        }, reference, 'canvas-dialog');

        host.session.start();
        await waitFor(() => host.session.getSnapshot().status === 'ready');
        expect(inputs[0].event).toEqual({ kind: 'mount', surface: 'canvas-dialog', capturedContext: reference });
        host.session.dispatchAction({ controlKey: 'save', actionId: 'record.save', value: null, draftRevision: null });
        await waitFor(() => host.applyEffects.mock.calls.length === 1);
        expect(host.applyEffects.mock.calls[0][0]).toMatchObject({ capturedContext: reference });
    });
});
