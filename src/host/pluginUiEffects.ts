import type { NemotoPluginApi, PluginApiIdentity } from '../plugins/publicApi';
import {
    PluginApiPermissionError,
    PluginApiRevisionConflictError,
    PluginApiSessionError,
} from '../plugins/publicApi';
import {
    PluginUiEffectRequestSchema,
    type PluginUiEffectRequest,
    type PluginUiEvent,
} from '../plugins/pluginUiContracts';
import {
    PLUGIN_UI_LIMITS,
    requiredCapabilitiesForPluginUi,
    requiredCapabilitiesForPluginUiEffect,
} from '../plugins/pluginUiProtocol';
import { PluginViewContributionSchema, type PluginCollectionListView, type PluginComposedView } from '../plugins/contributionSchemas';
import type { InstalledPluginDocument } from '../plugins/installedPackages';
import type { PluginCapability } from '../plugins/manifest';
import { JsonValueSchema, type JsonValue } from '../plugins/semanticData';
import {
    PluginStorageContractError,
    PluginStorageDataError,
    PluginStorageDocumentConflictError,
    PluginStorageQuotaError,
} from '../plugins/storageContracts';
import {
    PluginCollectionConflictError,
    PluginCollectionValidationError,
    type PluginCollectionPage,
    type PluginCollectionTransactionOperation,
} from '../plugins/collectionStorage';
import { samePluginApiIdentity } from './pluginPublicApi';
import type { UniversalEntityReference } from '../plugins/universalReference';
import type { PluginCollectionQuery } from '../plugins/collectionQuery';
import type { PluginTextBuffer } from './pluginTextBuffer';

export interface PluginUiEffectAuthority {
    readonly pluginId: string;
    readonly pluginVersion: string;
    readonly dataVersion: number;
    readonly viewId: string;
    readonly operation: string;
    readonly portfolioRevision: number;
    readonly capturedContext?: UniversalEntityReference;
}

export type PluginUiEffectReceipt = Extract<PluginUiEvent, { kind: 'effect-result' }>;

export interface PluginUiEffectDependencies {
    readonly getInstalledDocument: (pluginId: string) => InstalledPluginDocument | null;
    readonly getActiveIdentity: (pluginId: string) => PluginApiIdentity | null;
    readonly hasCapability: (pluginId: string, capability: PluginCapability) => boolean;
    readonly getPortfolioRevision: () => number;
    readonly connectPublicApi: (pluginId: string) => NemotoPluginApi;
    readonly readCollectionPage: (input: {
        readonly pluginId: string;
        readonly collectionId: string;
        readonly portfolioRevision: number;
        readonly cursor: string | null;
        readonly limit: number;
        readonly query?: PluginCollectionQuery;
    }) => PluginCollectionPage;
    readonly transactCollection: (input: {
        readonly pluginId: string;
        readonly view: PluginCollectionListView;
        readonly collectionId: string;
        readonly expectedPortfolioRevision: number;
        readonly operations: readonly PluginCollectionTransactionOperation[];
    }) => JsonValue;
    readonly showNotice: (notice: {
        readonly message: string;
        readonly severity: 'info' | 'success' | 'warning' | 'error';
    }) => void | Promise<void>;
    readonly saveTextOutput: (input: {
        readonly suggestedBaseName: string;
        readonly text: string;
    }) => Promise<JsonValue>;
    readonly copyTextOutput: (input: { readonly text: string }) => Promise<JsonValue>;
    readonly now?: () => number;
    readonly isCapturedContextCurrent?: (reference: UniversalEntityReference) => boolean;
}

export class PluginUiEffectBrokerError extends Error {
    constructor(
        message: string,
        readonly code:
            | 'AUTHORITY_REVOKED'
            | 'EFFECT_NOT_DECLARED'
            | 'INVALID_EFFECT_BATCH'
            | 'STORAGE_SCOPE_DENIED'
            | 'CAPTURED_CONTEXT_STALE'
            | 'USER_GESTURE_REQUIRED'
            | 'EFFECT_UNAVAILABLE'
            | 'SNAPSHOT_PAGE_LIMIT_EXCEEDED',
    ) {
        super(message);
        this.name = 'PluginUiEffectBrokerError';
    }
}

interface ResolvedAuthority {
    readonly composedView: PluginComposedView;
    readonly storageView: PluginCollectionListView;
}

const contribution = (document: InstalledPluginDocument, id: string) => {
    const reference = document.manifest.contributes.views?.find(candidate => candidate.id === id);
    if (!reference) return null;
    const source = document.contributions[reference.path];
    if (source === undefined) return null;
    const parsed = PluginViewContributionSchema.safeParse(source);
    return parsed.success && parsed.data.id === id ? parsed.data : null;
};

function resolveAuthority(
    authority: PluginUiEffectAuthority,
    dependencies: PluginUiEffectDependencies,
): ResolvedAuthority {
    const document = dependencies.getInstalledDocument(authority.pluginId);
    const identity = dependencies.getActiveIdentity(authority.pluginId);
    if (!document
        || document.manifest.version !== authority.pluginVersion
        || document.manifest.dataVersion !== authority.dataVersion
        || !identity
        || !samePluginApiIdentity(authority, identity)) {
        throw new PluginUiEffectBrokerError('The composed plugin authority is no longer active.', 'AUTHORITY_REVOKED');
    }
    const view = contribution(document, authority.viewId);
    if (!view || view.renderer !== 'composed-view' || view.operation !== authority.operation
        || !document.approvedInteractiveOperations.includes(authority.operation)
        || !dependencies.hasCapability(authority.pluginId, 'compute.isolated')) {
        throw new PluginUiEffectBrokerError('The composed view operation is not approved for this installed package.', 'AUTHORITY_REVOKED');
    }
    if (requiredCapabilitiesForPluginUi(view.ui).some(
        capability => !dependencies.hasCapability(authority.pluginId, capability),
    )) {
        throw new PluginUiEffectBrokerError('A capability required by the composed view has been revoked.', 'AUTHORITY_REVOKED');
    }
    const storageView = contribution(document, view.storageViewId);
    if (!storageView || storageView.renderer !== 'collection-list'
        || !storageView.id.startsWith(`${authority.pluginId}/`)) {
        throw new PluginUiEffectBrokerError('The installed storage declaration is unavailable.', 'STORAGE_SCOPE_DENIED');
    }
    return { composedView: view, storageView };
}

function preflightEffect(
    authority: PluginUiEffectAuthority,
    effect: PluginUiEffectRequest,
    dependencies: PluginUiEffectDependencies,
): ResolvedAuthority {
    const resolved = resolveAuthority(authority, dependencies);
    if (!resolved.composedView.ui.requiredEffects.includes(effect.kind)) {
        throw new PluginUiEffectBrokerError(`Effect '${effect.kind}' was not declared by this view.`, 'EFFECT_NOT_DECLARED');
    }
    for (const capability of requiredCapabilitiesForPluginUiEffect(effect.kind)) {
        if (!dependencies.hasCapability(authority.pluginId, capability)) {
            throw new PluginUiEffectBrokerError(`Effect '${effect.kind}' lost capability '${capability}'.`, 'AUTHORITY_REVOKED');
        }
    }
    if ((effect.kind === 'storage.collection.read-page' || effect.kind === 'storage.collection.query-page' || effect.kind === 'storage.collection.transact')
        && effect.payload.collectionId !== resolved.storageView.collection.id) {
        throw new PluginUiEffectBrokerError('The effect targeted a collection outside its installed storage declaration.', 'STORAGE_SCOPE_DENIED');
    }
    if ((effect.kind === 'storage.collection.transact' || effect.kind === 'storage.document.transact')
        && effect.payload.expectedPortfolioRevision !== authority.portfolioRevision) {
        throw new PluginUiEffectBrokerError('The storage batch revision does not match the reduction input.', 'INVALID_EFFECT_BATCH');
    }
    if ((effect.kind === 'storage.collection.transact' || effect.kind === 'storage.document.transact')
        && authority.capturedContext
        && !dependencies.isCapturedContextCurrent?.(authority.capturedContext)) {
        throw new PluginUiEffectBrokerError('The captured canvas object is no longer available.', 'CAPTURED_CONTEXT_STALE');
    }
    return resolved;
}

function parseEffectBatch(input: readonly unknown[]): PluginUiEffectRequest[] {
    if (input.length > PLUGIN_UI_LIMITS.effectsPerResult) {
        throw new PluginUiEffectBrokerError('The effect batch exceeds the result limit.', 'INVALID_EFFECT_BATCH');
    }
    const effects = input.map(effect => {
        const parsed = PluginUiEffectRequestSchema.safeParse(effect);
        if (!parsed.success) throw new PluginUiEffectBrokerError('The effect batch is malformed.', 'INVALID_EFFECT_BATCH');
        return parsed.data;
    });
    if (new Set(effects.map(effect => effect.id)).size !== effects.length) {
        throw new PluginUiEffectBrokerError('Effect IDs must be unique.', 'INVALID_EFFECT_BATCH');
    }
    if (effects.filter(effect => effect.kind === 'storage.collection.transact' || effect.kind === 'storage.document.transact').length > 1) {
        throw new PluginUiEffectBrokerError('Only one storage batch is allowed.', 'INVALID_EFFECT_BATCH');
    }
    if (effects.filter(effect => effect.kind === 'notice.show').length > 1) {
        throw new PluginUiEffectBrokerError('Only one notice is allowed.', 'INVALID_EFFECT_BATCH');
    }
    return effects;
}

const json = (value: unknown): JsonValue => JsonValueSchema.parse(
    value === undefined ? null : JSON.parse(JSON.stringify(value))
);

async function executeEffect(
    authority: PluginUiEffectAuthority,
    effect: PluginUiEffectRequest,
    resolved: ResolvedAuthority,
    dependencies: PluginUiEffectDependencies,
    outputAllowed: boolean,
    textBuffer?: PluginTextBuffer,
): Promise<JsonValue> {
    const api = () => dependencies.connectPublicApi(authority.pluginId);
    switch (effect.kind) {
        case 'read.search': return json(api().read.search(effect.payload));
        case 'read.entity': return json(api().read.getEntity(effect.payload.reference));
        case 'read.relations': return json(api().read.queryRelations({
            ...effect.payload,
            cursor: effect.payload.cursor ?? undefined,
        }));
        case 'storage.collection.read-page':
        case 'storage.collection.query-page': {
            const page = dependencies.readCollectionPage({
                pluginId: authority.pluginId,
                collectionId: effect.payload.collectionId,
                portfolioRevision: dependencies.getPortfolioRevision(),
                cursor: effect.payload.cursor,
                limit: effect.payload.limit,
                ...(effect.kind === 'storage.collection.query-page' ? { query: effect.payload.query } : {}),
            });
            const serialized = JSON.stringify(page);
            if (new TextEncoder().encode(serialized).byteLength > PLUGIN_UI_LIMITS.snapshotPageBytes) {
                throw new PluginUiEffectBrokerError(
                    'Records in this collection exceed the 64 KiB executable UI limit. Open the standard view to access or edit large records.',
                    'SNAPSHOT_PAGE_LIMIT_EXCEEDED',
                );
            }
            return json(page);
        }
        case 'storage.collection.transact':
            return dependencies.transactCollection({
                pluginId: authority.pluginId,
                view: resolved.storageView,
                collectionId: effect.payload.collectionId,
                expectedPortfolioRevision: effect.payload.expectedPortfolioRevision,
                operations: effect.payload.operations,
            });
        case 'storage.document.get': return json(api().storage.portfolio.get(effect.payload.key));
        case 'storage.document.list': return json(api().storage.portfolio.list({
            ...effect.payload,
            cursor: effect.payload.cursor ?? undefined,
        }));
        case 'storage.document.transact': return json(api().storage.portfolio.transact(effect.payload));
        case 'workspace.context': return json(api().workspace.getContext());
        case 'workspace.open': return json(api().workspace.open(effect.payload));
        case 'output.text-buffer':
            if (!textBuffer) throw new Error('No active text preparation session.');
            if (effect.payload.operation === 'reset') textBuffer.reset(authority.portfolioRevision);
            return { bytes: textBuffer.append(effect.payload.text, authority.portfolioRevision) };
        case 'notice.show':
            await dependencies.showNotice(effect.payload);
            return {};
        case 'output.text-file':
            if (!outputAllowed) throw new PluginUiEffectBrokerError(
                'Choose the plugin action again to export text.', 'USER_GESTURE_REQUIRED',
            );
            if ('buffered' in effect.payload && !textBuffer) throw new Error('No prepared text.');
            return json(await dependencies.saveTextOutput({ suggestedBaseName: effect.payload.suggestedBaseName,
                text: 'text' in effect.payload ? effect.payload.text : textBuffer!.read(authority.portfolioRevision) }));
        case 'output.clipboard-text':
            if (!outputAllowed) throw new PluginUiEffectBrokerError(
                'Choose the plugin action again to copy text.', 'USER_GESTURE_REQUIRED',
            );
            if ('buffered' in effect.payload && !textBuffer) throw new Error('No prepared text.');
            return json(await dependencies.copyTextOutput({
                text: 'text' in effect.payload ? effect.payload.text : textBuffer!.read(authority.portfolioRevision) }));
    }
}

const boundedMessage = (error: unknown): string => {
    const message = error instanceof Error ? error.message : 'The plugin effect failed.';
    return message.slice(0, 500) || 'The plugin effect failed.';
};

function errorReceipt(effect: PluginUiEffectRequest, error: unknown): PluginUiEffectReceipt {
    let code = 'EFFECT_FAILED';
    let retryable = false;
    let outcomeUnknown = effect.kind === 'storage.collection.transact'
        || effect.kind === 'storage.document.transact'
        || effect.kind === 'output.text-file'
        || effect.kind === 'output.clipboard-text';
    if (error instanceof PluginApiRevisionConflictError) {
        code = 'REVISION_CONFLICT'; retryable = true; outcomeUnknown = false;
    } else if (error instanceof PluginStorageDocumentConflictError || error instanceof PluginCollectionConflictError) {
        code = 'STORAGE_CONFLICT'; retryable = true; outcomeUnknown = false;
    } else if (error instanceof PluginStorageQuotaError) {
        code = 'STORAGE_QUOTA_EXCEEDED'; outcomeUnknown = false;
    } else if (error instanceof PluginStorageContractError || error instanceof PluginStorageDataError || error instanceof PluginCollectionValidationError) {
        code = 'INVALID_STORAGE_DATA'; outcomeUnknown = false;
    } else if (error instanceof PluginApiPermissionError || error instanceof PluginApiSessionError) {
        code = 'AUTHORITY_REVOKED'; outcomeUnknown = false;
    } else if (error instanceof PluginUiEffectBrokerError) {
        code = error.code; outcomeUnknown = false;
    }
    return Object.freeze({
        kind: 'effect-result', effectId: effect.id, ok: false,
        error: Object.freeze({ code, message: boundedMessage(error), retryable, outcomeUnknown }),
    });
}

export function createPluginUiEffectBroker(dependencies: PluginUiEffectDependencies) {
    return Object.freeze({
        apply: async (
            authority: PluginUiEffectAuthority,
            input: readonly unknown[],
            options?: {
                readonly isCancelled?: () => boolean;
                readonly outputGesture?: { readonly issuedAt: number };
                readonly textBuffer?: PluginTextBuffer;
            },
        ): Promise<readonly PluginUiEffectReceipt[]> => {
            const effects = parseEffectBatch(input);
            effects.forEach(effect => preflightEffect(authority, effect, dependencies));
            let acceptedRevision = authority.portfolioRevision;
            const outputGestureIssuedAt = options?.outputGesture?.issuedAt;
            let outputGestureAvailable = outputGestureIssuedAt !== undefined;
            const receipts: PluginUiEffectReceipt[] = [];
            for (const effect of effects) {
                if (options?.isCancelled?.()) break;
                try {
                    const live = preflightEffect(authority, effect, dependencies);
                    const actualRevision = dependencies.getPortfolioRevision();
                    if (actualRevision !== acceptedRevision) {
                        throw new PluginApiRevisionConflictError(acceptedRevision, actualRevision);
                    }
                    const isOutput = effect.kind === 'output.text-file' || effect.kind === 'output.clipboard-text';
                    const currentTime = dependencies.now?.() ?? Date.now();
                    const outputAllowed = !isOutput || (outputGestureAvailable
                        && outputGestureIssuedAt !== undefined
                        && currentTime >= outputGestureIssuedAt
                        && currentTime - outputGestureIssuedAt <= 5_000);
                    if (isOutput) outputGestureAvailable = false;
                    const result = await executeEffect(authority, effect, live, dependencies, outputAllowed, options?.textBuffer);
                    if (effect.kind === 'storage.collection.transact' || effect.kind === 'storage.document.transact') {
                        const resultRevision = (result as { portfolioRevision?: unknown }).portfolioRevision;
                        if (typeof resultRevision === 'number') acceptedRevision = resultRevision;
                    }
                    receipts.push(Object.freeze({ kind: 'effect-result', effectId: effect.id, ok: true, result }));
                } catch (error) {
                    receipts.push(errorReceipt(effect, error));
                    // Earlier effects may have committed. Do not execute dependent
                    // work or retry an uncertain outcome after a failed effect.
                    break;
                }
            }
            return Object.freeze(receipts);
        },
    });
}
