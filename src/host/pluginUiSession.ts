import type { PluginHostEvent } from '../plugins/hostServices';
import { PLUGIN_UI_LIMITS, PLUGIN_UI_PROTOCOL_VERSION } from '../plugins/pluginUiProtocol';
import {
    PluginUiEventSchema,
    PluginUiInputSchema,
    PluginUiResultSchema,
    type PluginUiEffectRequest,
    type PluginUiEvent,
    type PluginUiInput,
    type PluginUiNode,
} from '../plugins/pluginUiContracts';
import type { JsonValue } from '../plugins/semanticData';
import type { PluginApiIdentity } from '../plugins/publicApi';
import type { PluginUiEffectAuthority, PluginUiEffectReceipt } from './pluginUiEffects';
import { createPluginTextBuffer, type PluginTextBuffer } from './pluginTextBuffer';

export type PluginUiSessionDisposeReason =
    | 'view-closed'
    | 'view-switched'
    | 'authority-revoked'
    | 'queue-overflow'
    | 'manual';

export interface PluginUiRecoverableDraft {
    readonly value: JsonValue | null;
    readonly draftRevision: number | null;
}

export interface PluginUiSessionSnapshot {
    readonly status: 'idle' | 'loading' | 'ready' | 'error' | 'disposed';
    readonly tree: PluginUiNode | null;
    readonly pendingEvents: number;
    readonly hasUnsavedChanges: boolean;
    readonly recoverableDrafts: Readonly<Record<string, PluginUiRecoverableDraft>>;
    readonly lastConflict: PluginUiEffectReceipt | null;
    readonly error: string | null;
    readonly disposeReason: PluginUiSessionDisposeReason | null;
}

export interface PluginUiReductionOutcome {
    readonly viewId: string;
    readonly identity: PluginApiIdentity;
    readonly authorityGeneration: number;
    readonly result: unknown;
}

export interface PluginUiSessionDependencies {
    readonly waitForReduction?: () => Promise<void>;
    readonly reduce: (viewId: string, input: PluginUiInput) => Promise<PluginUiReductionOutcome>;
    readonly applyEffects: (
        authority: PluginUiEffectAuthority,
        effects: readonly PluginUiEffectRequest[],
        options?: {
            readonly isCancelled?: () => boolean;
            readonly outputGesture?: { readonly issuedAt: number };
            readonly textBuffer?: PluginTextBuffer;
        },
    ) => Promise<readonly PluginUiEffectReceipt[]>;
    readonly getPortfolioRevision: () => number;
    readonly getEnvironment: () => PluginUiInput['environment'];
    readonly isAuthorityCurrent: (authority: Omit<PluginUiEffectAuthority, 'portfolioRevision'>) => boolean;
    readonly subscribeHostEvents?: (listener: (event: PluginHostEvent) => void) => () => void;
    readonly getActiveView?: () => string;
}

export interface PluginUiSessionOptions {
    readonly authority: Omit<PluginUiEffectAuthority, 'portfolioRevision'>;
    readonly surface: 'app-rail' | 'canvas-dialog';
    readonly capturedContext?: Extract<PluginUiEvent, { kind: 'mount' }>['capturedContext'];
    readonly instanceId?: string;
}

const emptyFlags = () => ({ data: false, workspace: false, viewport: false, theme: false });
type InvalidationFlags = ReturnType<typeof emptyFlags>;

const sameIdentity = (left: PluginApiIdentity, right: PluginApiIdentity) => (
    left.pluginId === right.pluginId
    && left.pluginVersion === right.pluginVersion
    && left.dataVersion === right.dataVersion
);

const hasDirtyDialog = (tree: PluginUiNode | null): boolean => {
    if (!tree) return false;
    const pending = [tree];
    while (pending.length) {
        const node = pending.pop()!;
        if ((node.type === 'dialog' || node.type === 'form') && node.dirty === true) return true;
        pending.push(...(node.children ?? []));
    }
    return false;
};

const hasDialog = (tree: PluginUiNode): boolean => tree.type === 'dialog'
    || (tree.children ?? []).some(hasDialog);

const isAcknowledgedFilter = (tree: PluginUiNode, key: string, value: unknown, editing = false): boolean => {
    const withinEditor = editing || tree.type === 'dialog' || tree.type === 'form' || tree.type === 'rich-text';
    if (tree.key === key) return !withinEditor && JSON.stringify(tree.value ?? tree.checked) === JSON.stringify(value);
    return (tree.children ?? []).some(child => isAcknowledgedFilter(child, key, value, withinEditor));
};

const acceptsAction = (
    tree: PluginUiNode | null,
    action: { readonly controlKey: string; readonly actionId: string },
): boolean => {
    if (!tree) return false;
    const pending = [tree];
    while (pending.length) {
        const node = pending.pop()!;
        if (node.key === action.controlKey) {
            const expected = node.type === 'dialog' ? node.closeActionId : node.actionId;
            if (expected !== action.actionId || node.disabled === true) return false;
            return node.type !== 'rich-text' || node.editable === true;
        }
        pending.push(...(node.children ?? []));
    }
    return false;
};

const acknowledgesDraft = (
    tree: PluginUiNode,
    event: Extract<PluginUiEvent, { kind: 'action' }>,
): boolean => {
    if (event.draftRevision === null) return true;
    const pending = [tree];
    while (pending.length) {
        const node = pending.pop()!;
        if (node.key === event.controlKey) {
            return node.type === 'rich-text'
                && typeof node.draftRevision === 'number'
                && node.draftRevision >= event.draftRevision;
        }
        pending.push(...(node.children ?? []));
    }
    return false;
};

const boundedError = (error: unknown): string => {
    let msg = 'The composed plugin view failed.';
    if (error instanceof Error) {
        msg = error.message;
    } else if (typeof error === 'string') {
        msg = error;
    } else if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
        msg = (error as any).message;
    }
    return msg.slice(0, 500) || 'The composed plugin view failed.';
};

const createInstanceId = () => `ui:${crypto.randomUUID()}`;

export function createPluginUiSession(
    options: PluginUiSessionOptions,
    dependencies: PluginUiSessionDependencies,
) {
    const instanceId = options.instanceId ?? createInstanceId();
    const listeners = new Set<() => void>();
    const queue: PluginUiEvent[] = [];
    const outputGestures = new WeakMap<object, number>();
    // Only host actions and successful receipts in their chain may cause effects
    // beyond reads. A read receipt cannot manufacture user authorization.
    const userInitiatedEvents = new WeakSet<object>();
    const textBuffer = createPluginTextBuffer();
    const drafts: Record<string, PluginUiRecoverableDraft> = {};
    let state: JsonValue = null;
    let tree: PluginUiNode | null = null;
    let status: PluginUiSessionSnapshot['status'] = 'idle';
    let error: string | null = null;
    let disposeReason: PluginUiSessionDisposeReason | null = null;
    let lastConflict: PluginUiEffectReceipt | null = null;
    let sequence = 0;
    let uiRevision = 0;
    let renderedPortfolioRevision: number | null = null;
    let processing = false;
    let generation: number | null = null;
    let unsubscribeHostEvents: (() => void) | null = null;
    let snapshot: PluginUiSessionSnapshot;

    const rebuildSnapshot = () => {
        snapshot = Object.freeze({
            status,
            tree,
            pendingEvents: queue.length + (processing ? 1 : 0),
            hasUnsavedChanges: hasDirtyDialog(tree) || Object.keys(drafts).length > 0,
            recoverableDrafts: Object.freeze(structuredClone(drafts)),
            lastConflict,
            error,
            disposeReason,
        });
        listeners.forEach(listener => listener());
    };
    rebuildSnapshot();

    const dispose = (reason: PluginUiSessionDisposeReason = 'manual') => {
        if (status === 'disposed') return;
        status = 'disposed';
        disposeReason = reason;
        queue.length = 0;
        textBuffer.dispose();
        unsubscribeHostEvents?.();
        unsubscribeHostEvents = null;
        rebuildSnapshot();
    };

    const fail = (cause: unknown) => {
        status = 'error';
        error = boundedError(cause);
        queue.length = 0;
        rebuildSnapshot();
    };

    const authorityIsCurrent = () => dependencies.isAuthorityCurrent(options.authority);
    const isDisposed = () => status === 'disposed';

    const processQueue = async () => {
        if (processing || status === 'disposed' || status === 'error') return;
        processing = true;
        rebuildSnapshot();
        try {
            while (queue.length && !isDisposed()) {
                if (dependencies.waitForReduction) await dependencies.waitForReduction();
                if (isDisposed()) break;
                if (!authorityIsCurrent()) {
                    dispose('authority-revoked');
                    break;
                }
                const event = queue.shift()!;
                const userInitiated = userInitiatedEvents.has(event);
                const outputGestureIssuedAt = outputGestures.get(event);
                if (event.kind === 'action' && !acceptsAction(tree, event)) {
                    throw new Error('A queued plugin action no longer matches the active control.');
                }
                const portfolioRevision = dependencies.getPortfolioRevision();
                if (event.kind === 'action' && renderedPortfolioRevision !== portfolioRevision) {
                    throw new Error('The Portfolio changed since this view was rendered. Reopen the view before editing; your draft is retained.');
                }
                const input = PluginUiInputSchema.parse({
                    schema: 'axiom.plugin-ui-input',
                    schemaVersion: 1,
                    protocolVersion: PLUGIN_UI_PROTOCOL_VERSION,
                    instanceId,
                    sequence: ++sequence,
                    uiRevision,
                    portfolioRevision,
                    event,
                    state,
                    snapshots: [],
                    environment: dependencies.getEnvironment(),
                });
                rebuildSnapshot();
                const outcome = await dependencies.reduce(options.authority.viewId, input);
                if (isDisposed()) break;
                if (!authorityIsCurrent()) {
                    dispose('authority-revoked');
                    break;
                }
                const result = PluginUiResultSchema.parse(outcome.result);
                if (outcome.viewId !== options.authority.viewId
                    || !sameIdentity(outcome.identity, options.authority)
                    || result.instanceId !== instanceId
                    || result.sequence !== input.sequence
                    || result.uiRevision !== input.uiRevision
                    || result.portfolioRevision !== input.portfolioRevision
                    || (generation !== null && outcome.authorityGeneration !== generation)) {
                    throw new Error('The composed plugin result had stale or conflicting authority.');
                }
                if (event.kind === 'action' && !acknowledgesDraft(result.tree, event)) {
                    throw new Error('The composed plugin did not acknowledge the latest editor draft revision.');
                }
                if (!userInitiated && result.effects.some(effect => ![
                    'read.search', 'read.entity', 'read.relations', 'workspace.context',
                    'storage.collection.read-page', 'storage.collection.query-page', 'storage.document.get', 'storage.document.list',
                ].includes(effect.kind))) {
                    throw new Error('Plugin effects require an initiating user action.');
                }
                generation ??= outcome.authorityGeneration;
                const closedCanvasDialog = options.surface === 'canvas-dialog'
                    && tree !== null && hasDialog(tree) && !hasDialog(result.tree);
                state = result.state;
                tree = result.tree;
                for (const [key, draft] of Object.entries(drafts)) {
                    if (isAcknowledgedFilter(tree, key, draft.value)) delete drafts[key];
                }
                renderedPortfolioRevision = input.portfolioRevision;
                uiRevision += 1;
                status = 'ready';
                error = null;
                rebuildSnapshot();

                if (closedCanvasDialog) {
                    dispose('view-closed');
                    break;
                }

                if (result.effects.length) {
                    const committingDrafts = structuredClone(drafts);
                    const receipts = await dependencies.applyEffects({
                        ...options.authority,
                        portfolioRevision: input.portfolioRevision,
                        ...(options.capturedContext ? { capturedContext: options.capturedContext } : {}),
                    }, result.effects, {
                        isCancelled: () => isDisposed() || !authorityIsCurrent()
                            || (dependencies.getActiveView?.() ?? options.authority.viewId) !== options.authority.viewId,
                        textBuffer,
                        ...(outputGestureIssuedAt === undefined
                            ? {} : { outputGesture: { issuedAt: outputGestureIssuedAt } }),
                    });
                    if (isDisposed()) break;
                    if (!authorityIsCurrent()) {
                        dispose('authority-revoked');
                        break;
                    }
                    if (queue.length + receipts.length > PLUGIN_UI_LIMITS.queuedEvents) {
                        dispose('queue-overflow');
                        break;
                    }
                    for (const receipt of receipts) {
                        const effect = result.effects.find(effect => effect.id === receipt.effectId);
                        if (receipt.ok && (effect?.kind === 'storage.collection.transact'
                            || effect?.kind === 'storage.document.transact')) {
                            for (const [key, draft] of Object.entries(committingDrafts)) {
                                if (JSON.stringify(drafts[key]) === JSON.stringify(draft)) delete drafts[key];
                            }
                        }
                        if (!receipt.ok && (receipt.error.code === 'REVISION_CONFLICT'
                            || receipt.error.code === 'STORAGE_CONFLICT')) {
                            lastConflict = receipt;
                        }
                    }
                    queue.unshift(...receipts.map(receipt => {
                        const next = PluginUiEventSchema.parse(receipt);
                        if (userInitiated && receipt.ok) userInitiatedEvents.add(next);
                        return next;
                    }));
                    rebuildSnapshot();
                }
            }
        } catch (cause) {
            if (!isDisposed()) fail(cause);
        } finally {
            processing = false;
            rebuildSnapshot();
        }
    };

    const enqueue = (event: PluginUiEvent, outputGestureIssuedAt?: number): boolean => {
        if (status === 'disposed' || status === 'error') return false;
        if (queue.length >= PLUGIN_UI_LIMITS.queuedEvents) {
            dispose('queue-overflow');
            return false;
        }
        const parsed = PluginUiEventSchema.parse(event);
        if (parsed.kind === 'action') userInitiatedEvents.add(parsed);
        if (outputGestureIssuedAt !== undefined) outputGestures.set(parsed, outputGestureIssuedAt);
        queue.push(parsed);
        void processQueue();
        return true;
    };

    const invalidate = (flags: Partial<InvalidationFlags>): boolean => {
        if (status === 'disposed' || status === 'error') return false;
        const normalized = { ...emptyFlags(), ...flags };
        if (!Object.values(normalized).some(Boolean)) return false;
        const queued = queue.find(candidate => candidate.kind === 'invalidate');
        if (queued?.kind === 'invalidate') {
            Object.keys(normalized).forEach(key => {
                const flag = key as keyof InvalidationFlags;
                queued.flags[flag] = queued.flags[flag] || normalized[flag];
            });
            rebuildSnapshot();
            return true;
        }
        return enqueue({ kind: 'invalidate', flags: normalized });
    };

    const start = () => {
        if (status !== 'idle') return false;
        if (!authorityIsCurrent()) {
            dispose('authority-revoked');
            return false;
        }
        status = 'loading';
        unsubscribeHostEvents = dependencies.subscribeHostEvents?.((event) => {
            if (!authorityIsCurrent()) {
                dispose('authority-revoked');
            } else if (event.type === 'navigation.changed') {
                if (options.surface === 'app-rail' && event.activeView !== options.authority.viewId) dispose('view-switched');
                else invalidate({ workspace: true });
            } else if (event.type === 'portfolio.changed') {
                invalidate({ data: true, workspace: true });
            }
        }) ?? null;
        if (dependencies.getActiveView && dependencies.getActiveView() !== options.authority.viewId) {
            dispose('view-switched');
            return false;
        }
        return enqueue({
            kind: 'mount',
            surface: options.surface,
            capturedContext: options.capturedContext ?? null,
        });
    };

    const stageDraft = (action: {
        readonly controlKey: string;
        readonly actionId: string;
        readonly value: JsonValue | null;
        readonly draftRevision: number | null;
    }) => {
        const parsed = PluginUiEventSchema.safeParse({ kind: 'action', ...action });
        if (status === 'disposed' || status === 'error' || !parsed.success
            || parsed.data.kind !== 'action' || parsed.data.value === null
            || !acceptsAction(tree, parsed.data)) return false;
        drafts[parsed.data.controlKey] = Object.freeze({
            value: structuredClone(parsed.data.value),
            draftRevision: parsed.data.draftRevision,
        });
        rebuildSnapshot();
        return true;
    };

    return Object.freeze({
        viewId: options.authority.viewId,
        start,
        dispose,
        requestClose: (discardUnsaved = false) => {
            if (status === 'disposed') return true;
            if (snapshot.hasUnsavedChanges && !discardUnsaved) return false;
            dispose('view-closed');
            return true;
        },
        invalidate,
        stageDraft,
        dispatchAction: (action: {
            readonly controlKey: string;
            readonly actionId: string;
            readonly value: JsonValue | null;
            readonly draftRevision: number | null;
            readonly userGesture?: boolean;
        }) => {
            if (status === 'disposed' || status === 'error' || !acceptsAction(tree, action)) return false;
            if (action.value !== null) stageDraft(action);
            const event = PluginUiEventSchema.parse({
                kind: 'action', controlKey: action.controlKey, actionId: action.actionId,
                value: action.value, draftRevision: action.draftRevision,
            });
            return enqueue(event, action.userGesture ? Date.now() : undefined);
        },
        acknowledgeDraft: (controlKey: string) => {
            if (!(controlKey in drafts)) return;
            delete drafts[controlKey];
            rebuildSnapshot();
        },
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    });
}

export type PluginUiSession = ReturnType<typeof createPluginUiSession>;
