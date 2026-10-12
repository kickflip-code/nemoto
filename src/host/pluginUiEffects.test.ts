import { describe, expect, it, vi } from 'vitest';
import admissionFixture from '../../fixtures/plugins/protocol/ui-admission-v1.json';
import { emptyPortfolio } from '../stores/slices/coreSlice';
import type { Portfolio } from '../types';
import {
    createEmptyPluginDataEnvelope,
    readPluginCollection,
    readPluginCollectionPage,
    transactPluginCollection,
    type PluginCollectionItem,
} from '../plugins/collectionStorage';
import { PluginViewContributionSchema } from '../plugins/contributionSchemas';
import { InstalledPluginDocumentSchema } from '../plugins/installedPackages';
import type { PluginCapability } from '../plugins/manifest';
import { parsePluginManifest } from '../plugins/manifest';
import { PluginApiPermissionError, type NemotoPluginApi } from '../plugins/publicApi';
import type { JsonValue } from '../plugins/semanticData';
import {
    createPluginUiEffectBroker,
    PluginUiEffectBrokerError,
    type PluginUiEffectAuthority,
    type PluginUiEffectDependencies,
} from './pluginUiEffects';

const manifest = parsePluginManifest(admissionFixture.manifest);
const storageView = PluginViewContributionSchema.parse(admissionFixture.legacyView);
if (storageView.renderer !== 'collection-list') throw new Error('Expected collection storage fixture.');

const installed = InstalledPluginDocumentSchema.parse({
    schema: 'axiom.installed-plugin',
    schemaVersion: 1,
    installedAt: '2026-09-12T10:00:00.000Z',
    manifest,
    grantedCapabilities: manifest.capabilities,
    approvedInteractiveOperations: [admissionFixture.composedView.operation],
    contributions: {
        'contributions/legacy.view.json': admissionFixture.legacyView,
        'contributions/composed.view.json': admissionFixture.composedView,
    },
});

const authority: PluginUiEffectAuthority = {
    pluginId: manifest.id,
    pluginVersion: manifest.version,
    dataVersion: manifest.dataVersion,
    viewId: admissionFixture.composedView.id,
    operation: admissionFixture.composedView.operation,
    portfolioRevision: 0,
};

const item = (id: string, title = 'Review'): PluginCollectionItem => ({
    id,
    createdAt: '2026-09-12T10:00:00.000Z',
    updatedAt: '2026-09-12T10:00:00.000Z',
    values: { title },
});

function createHarness(initialPortfolio: Portfolio = structuredClone(emptyPortfolio)) {
    let portfolio = initialPortfolio;
    let revision = 0;
    const grants = new Set<PluginCapability>(manifest.capabilities);
    const transact = vi.fn((input: Parameters<PluginUiEffectDependencies['transactCollection']>[0]): JsonValue => {
        if (!grants.has('plugin-data.write')) throw new PluginApiPermissionError(input.pluginId, 'plugin-data.write');
        if (input.expectedPortfolioRevision !== revision) throw new Error('unexpected stale commit');
        const result = transactPluginCollection(
            portfolio,
            input.pluginId,
            input.view,
            input.collectionId,
            input.operations,
        );
        if (result.changed) {
            portfolio = result.portfolio;
            revision += 1;
        }
        return {
            portfolioRevision: revision,
            operations: result.operations.map(operation => ({ ...operation })),
        };
    });
    const dependencies: PluginUiEffectDependencies = {
        getInstalledDocument: pluginId => pluginId === manifest.id ? installed : null,
        getActiveIdentity: pluginId => pluginId === manifest.id ? {
            pluginId: manifest.id,
            pluginVersion: manifest.version,
            dataVersion: manifest.dataVersion,
        } : null,
        hasCapability: (_pluginId, capability) => grants.has(capability),
        getPortfolioRevision: () => revision,
        connectPublicApi: () => { throw new Error('Public API should not be used by collection effects.'); },
        readCollectionPage: input => readPluginCollectionPage(
            portfolio,
            input.pluginId,
            input.collectionId,
            revision,
            input.cursor,
            input.limit,
            input.query,
        ),
        transactCollection: transact,
        showNotice: vi.fn(),
        saveTextOutput: vi.fn(async () => ({ status: 'saved', fileName: 'report.txt' })),
        copyTextOutput: vi.fn(async () => ({ status: 'copied' })),
    };
    return {
        broker: createPluginUiEffectBroker(dependencies),
        dependencies,
        grants,
        transact,
        getPortfolio: () => portfolio,
        getRevision: () => revision,
    };
}

const putEffect = (records: PluginCollectionItem[], expectedPortfolioRevision = 0) => ({
    id: 'collection:write',
    kind: 'storage.collection.transact',
    payload: {
        collectionId: 'records',
        expectedPortfolioRevision,
        operations: records.map(record => ({ operationId: `put:${record.id}`, kind: 'put', item: record })),
    },
});

describe('composed UI effect broker', () => {
    it('commits an installed-schema collection batch atomically and increments once', async () => {
        const harness = createHarness();
        const receipts = await harness.broker.apply(authority, [putEffect([item('one'), item('two')])]);

        expect(receipts).toEqual([{
            kind: 'effect-result', effectId: 'collection:write', ok: true,
            result: {
                portfolioRevision: 1,
                operations: [
                    { operationId: 'put:one', itemId: 'one', updatedAt: item('one').updatedAt },
                    { operationId: 'put:two', itemId: 'two', updatedAt: item('two').updatedAt },
                ],
            },
        }]);
        expect(harness.transact).toHaveBeenCalledTimes(1);
        expect(harness.getRevision()).toBe(1);
        expect(readPluginCollection(harness.getPortfolio(), manifest.id, 'records').items).toHaveLength(2);
    });

    it('returns a stale-revision receipt without attempting a write', async () => {
        const harness = createHarness();
        await harness.broker.apply(authority, [putEffect([item('seed')])]);

        const receipts = await harness.broker.apply(authority, [putEffect([item('stale')])]);

        expect(receipts).toEqual([expect.objectContaining({
            ok: false,
            error: expect.objectContaining({ code: 'REVISION_CONFLICT', retryable: true, outcomeUnknown: false }),
        })]);
        expect(harness.transact).toHaveBeenCalledTimes(1);
        expect(readPluginCollection(harness.getPortfolio(), manifest.id, 'records').items.map(value => value.id))
            .toEqual(['seed']);
    });

    it('rejects stale item deletion without partially applying another operation', async () => {
        const harness = createHarness();
        await harness.broker.apply(authority, [putEffect([item('seed')])]);
        const currentAuthority = { ...authority, portfolioRevision: 1 };
        const receipts = await harness.broker.apply(currentAuthority, [{
            id: 'collection:delete', kind: 'storage.collection.transact',
            payload: {
                collectionId: 'records', expectedPortfolioRevision: 1,
                operations: [
                    { operationId: 'put:new', kind: 'put', item: item('new') },
                    { operationId: 'delete:seed', kind: 'delete', itemId: 'seed', expectedUpdatedAt: '2026-09-12T11:00:00.000Z' },
                ],
            },
        }]);

        expect(receipts[0]).toMatchObject({
            ok: false,
            error: { code: 'STORAGE_CONFLICT', retryable: true, outcomeUnknown: false },
        });
        expect(harness.getRevision()).toBe(1);
        expect(readPluginCollection(harness.getPortfolio(), manifest.id, 'records').items.map(value => value.id))
            .toEqual(['seed']);
    });

    it('rejects malformed batches and foreign collection scope before any effect runs', async () => {
        const harness = createHarness();
        await expect(harness.broker.apply(authority, [{
            ...putEffect([item('one')]),
            payload: { ...putEffect([item('one')]).payload, operations: [{ operationId: 'bad', kind: 'put', item: { id: 'bad' } }] },
        }])).rejects.toMatchObject({ code: 'INVALID_EFFECT_BATCH' });
        await expect(harness.broker.apply(authority, [{
            id: 'foreign', kind: 'storage.collection.read-page',
            payload: { collectionId: 'another-namespace', cursor: null, limit: 10 },
        }])).rejects.toEqual(expect.objectContaining<Partial<PluginUiEffectBrokerError>>({ code: 'STORAGE_SCOPE_DENIED' }));
        expect(harness.transact).not.toHaveBeenCalled();
        expect(harness.getPortfolio()).toEqual(emptyPortfolio);
    });

    it('leaves the namespace unchanged when installed scalar validation or quota validation fails', async () => {
        const harness = createHarness();
        const invalid = { ...item('invalid'), values: { title: 'Review', undeclared: 'blocked' } };
        const invalidReceipt = await harness.broker.apply(authority, [putEffect([item('would-have-written'), invalid])]);
        expect(invalidReceipt[0]).toMatchObject({
            ok: false,
            error: { code: 'INVALID_STORAGE_DATA', outcomeUnknown: false },
        });
        expect(harness.getRevision()).toBe(0);
        expect(harness.getPortfolio()).toEqual(emptyPortfolio);

        const envelope = createEmptyPluginDataEnvelope();
        envelope.documents = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
            `near-quota/${index}`,
            { documentVersion: 1, value: Array.from({ length: 3 }, () => 'x'.repeat(85_000)) },
        ]));
        const nearQuota = {
            ...structuredClone(emptyPortfolio),
            extensions: { [manifest.id]: envelope },
        };
        const quotaHarness = createHarness(nearQuota);
        const quotaReceipt = await quotaHarness.broker.apply(authority, [putEffect(
            Array.from({ length: 100 }, (_, index) => item(`record-${index}`, 'x'.repeat(500))),
        )]);
        expect(quotaReceipt[0]).toMatchObject({
            ok: false,
            error: { code: 'STORAGE_QUOTA_EXCEEDED', outcomeUnknown: false },
        });
        expect(quotaHarness.getRevision()).toBe(0);
        expect(quotaHarness.getPortfolio()).toBe(nearQuota);
    });

    it('rechecks grants at commit and never retries an uncertain mutation', async () => {
        const revoked = createHarness();
        const revokeAtCommit = vi.fn((input: Parameters<PluginUiEffectDependencies['transactCollection']>[0]): JsonValue => {
            revoked.grants.delete('plugin-data.write');
            throw new PluginApiPermissionError(input.pluginId, 'plugin-data.write');
        });
        const revokedBroker = createPluginUiEffectBroker({ ...revoked.dependencies, transactCollection: revokeAtCommit });
        const revokedReceipt = await revokedBroker.apply(authority, [putEffect([item('blocked')])]);
        expect(revokedReceipt[0]).toMatchObject({ ok: false, error: { code: 'AUTHORITY_REVOKED', outcomeUnknown: false } });
        expect(revokeAtCommit).toHaveBeenCalledTimes(1);

        const uncertain = createHarness();
        const fail = vi.fn(() => { throw new Error('commit channel closed'); });
        const uncertainBroker = createPluginUiEffectBroker({ ...uncertain.dependencies, transactCollection: fail });
        const uncertainReceipt = await uncertainBroker.apply(authority, [putEffect([item('unknown')])]);
        expect(uncertainReceipt[0]).toMatchObject({ ok: false, error: { code: 'EFFECT_FAILED', outcomeUnknown: true } });
        expect(fail).toHaveBeenCalledTimes(1);
    });

    it('pages collection reads against the shared Portfolio revision', async () => {
        const harness = createHarness();
        await harness.broker.apply(authority, [putEffect([item('one'), item('two')])]);
        const currentAuthority = { ...authority, portfolioRevision: 1 };
        const first = await harness.broker.apply(currentAuthority, [{
            id: 'page:first', kind: 'storage.collection.read-page',
            payload: { collectionId: 'records', cursor: null, limit: 1 },
        }]);
        expect(first[0]).toMatchObject({
            ok: true,
            result: { portfolioRevision: 1, collectionId: 'records', items: [{ id: 'one' }] },
        });
        if (!first[0].ok) throw new Error('Expected a successful first page.');
        const cursor = (first[0].result as { nextCursor: string }).nextCursor;
        const second = await harness.broker.apply(currentAuthority, [{
            id: 'page:second', kind: 'storage.collection.read-page',
            payload: { collectionId: 'records', cursor, limit: 1 },
        }]);
        expect(second[0]).toMatchObject({ ok: true, result: { items: [{ id: 'two' }], nextCursor: null } });
    });

    it('reads all 5,000 records in bounded pages without changing stored data', async () => {
        const envelope = createEmptyPluginDataEnvelope();
        const records = Array.from({ length: 5_000 }, (_, index) => item(`record-${index}`));
        envelope.collections.records = { items: records };
        const portfolio = { ...structuredClone(emptyPortfolio), extensions: { [manifest.id]: envelope } };
        const before = JSON.stringify(portfolio);
        const harness = createHarness(portfolio);
        const ids: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
            const receipts = await harness.broker.apply(authority, [{
                id: `page:${pages}`, kind: 'storage.collection.read-page',
                payload: { collectionId: 'records', cursor, limit: 100 },
            }]);
            const receipt = receipts[0];
            if (!receipt.ok) throw new Error(`Read failed: ${JSON.stringify(receipt.error)}`);
            const page = receipt.result as unknown as { items: PluginCollectionItem[]; nextCursor: string | null };
            expect(page.items.length).toBeLessThanOrEqual(100);
            expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThanOrEqual(64 * 1024);
            ids.push(...page.items.map(record => record.id));
            cursor = page.nextCursor;
            pages += 1;
            if (pages > 50) throw new Error('Paging failed to terminate.');
        } while (cursor !== null);
        expect(pages).toBe(50);
        expect(new Set(ids)).toEqual(new Set(records.map(record => record.id)));
        expect(JSON.stringify(harness.getPortfolio())).toBe(before);
        expect(harness.transact).not.toHaveBeenCalled();
    });

    it('routes an admitted document batch through the identity-bound public API once', async () => {
        let revision = 0;
        const transact = vi.fn(() => {
            revision += 1;
            return {
                schema: 'axiom.plugin-storage-transaction-result' as const,
                schemaVersion: 1 as const,
                scope: 'portfolio' as const,
                portfolioRevision: revision,
                operations: [{ operationId: 'put:view', key: 'view/state', documentVersion: 1 }],
            };
        });
        const documentView = {
            ...admissionFixture.composedView,
            ui: { ...admissionFixture.composedView.ui, requiredEffects: ['storage.document.transact'] },
        };
        const documentInstalled = InstalledPluginDocumentSchema.parse({
            ...installed,
            contributions: { ...installed.contributions, 'contributions/composed.view.json': documentView },
        });
        const harness = createHarness();
        const broker = createPluginUiEffectBroker({
            ...harness.dependencies,
            getInstalledDocument: () => documentInstalled,
            getPortfolioRevision: () => revision,
            connectPublicApi: () => ({
                storage: { portfolio: { transact } },
            }) as unknown as NemotoPluginApi,
        });
        const receipts = await broker.apply(authority, [{
            id: 'document:write',
            kind: 'storage.document.transact',
            payload: {
                schema: 'axiom.plugin-storage-transaction', schemaVersion: 1, scope: 'portfolio',
                expectedPortfolioRevision: 0,
                operations: [{
                    operationId: 'put:view', kind: 'put', key: 'view/state',
                    expectedDocumentVersion: null, value: { filter: 'open' },
                }],
            },
        }]);

        expect(receipts[0]).toMatchObject({ ok: true, result: { portfolioRevision: 1 } });
        expect(transact).toHaveBeenCalledTimes(1);
        expect(revision).toBe(1);
    });

    function createOutputBroker(overrides: Partial<PluginUiEffectDependencies> = {}) {
        const outputView = {
            ...admissionFixture.composedView,
            ui: {
                ...admissionFixture.composedView.ui,
                requiredEffects: ['output.clipboard-text', 'output.text-file'],
            },
        };
        const outputManifest = parsePluginManifest({
            ...admissionFixture.manifest,
            capabilities: [...admissionFixture.manifest.capabilities, 'clipboard.write', 'file.write-selected'],
        });
        const outputDocument = InstalledPluginDocumentSchema.parse({
            ...installed,
            manifest: outputManifest,
            grantedCapabilities: outputManifest.capabilities,
            contributions: { ...installed.contributions, 'contributions/composed.view.json': outputView },
        });
        const harness = createHarness();
        const broker = createPluginUiEffectBroker({
            ...harness.dependencies,
            getInstalledDocument: () => outputDocument,
            hasCapability: () => true,
            ...overrides,
        });
        return { ...harness, broker, outputDocument };
    }

    it('requires a fresh host gesture for clipboard output and forwards exact text once', async () => {
        const copyTextOutput = vi.fn(async () => ({ status: 'copied' }));
        const harness = createOutputBroker({ copyTextOutput, now: () => 10_000 });
        const effect = {
            id: 'copy', kind: 'output.clipboard-text' as const, payload: { text: 'Exact filtered output\nåäö' },
        };

        const denied = await harness.broker.apply(authority, [effect]);
        expect(denied[0]).toMatchObject({ ok: false, error: { code: 'USER_GESTURE_REQUIRED', outcomeUnknown: false } });
        expect(copyTextOutput).not.toHaveBeenCalled();

        const expired = await harness.broker.apply(authority, [effect], { outputGesture: { issuedAt: 4_999 } });
        expect(expired[0]).toMatchObject({ ok: false, error: { code: 'USER_GESTURE_REQUIRED' } });

        const copied = await harness.broker.apply(authority, [effect], { outputGesture: { issuedAt: 10_000 } });
        expect(copied).toEqual([{ kind: 'effect-result', effectId: 'copy', ok: true, result: { status: 'copied' } }]);
        expect(copyTextOutput).toHaveBeenCalledTimes(1);
        expect(copyTextOutput).toHaveBeenCalledWith({ text: 'Exact filtered output\nåäö' });
    });

    it('returns cancellation without exposing a selected file path', async () => {
        const saveTextOutput = vi.fn(async () => ({ status: 'cancelled' }));
        const harness = createOutputBroker({ saveTextOutput, now: () => 20_000 });
        const receipt = await harness.broker.apply(authority, [{
            id: 'export', kind: 'output.text-file',
            payload: { suggestedBaseName: 'tasks-filtered', text: 'one\ntwo' },
        }], { outputGesture: { issuedAt: 20_000 } });

        expect(receipt).toEqual([{
            kind: 'effect-result', effectId: 'export', ok: true, result: { status: 'cancelled' },
        }]);
        expect(JSON.stringify(receipt)).not.toContain('path');
    });

    it('consumes one gesture for one output effect, including a failed output attempt', async () => {
        const copyTextOutput = vi.fn(async () => { throw new Error('Clipboard busy'); });
        const saveTextOutput = vi.fn(async () => ({ status: 'saved', fileName: 'later.txt' }));
        const harness = createOutputBroker({ copyTextOutput, saveTextOutput, now: () => 30_000 });
        const receipts = await harness.broker.apply(authority, [
            { id: 'copy', kind: 'output.clipboard-text', payload: { text: 'one' } },
            { id: 'export', kind: 'output.text-file', payload: { suggestedBaseName: 'later', text: 'two' } },
        ], { outputGesture: { issuedAt: 30_000 } });

        expect(receipts[0]).toMatchObject({ ok: false, error: { code: 'EFFECT_FAILED', outcomeUnknown: true } });
        expect(receipts).toHaveLength(1);
        expect(copyTextOutput).toHaveBeenCalledTimes(1);
        expect(saveTextOutput).not.toHaveBeenCalled();
    });

    it('preflights a revoked output grant before opening an output surface', async () => {
        const harness = createOutputBroker({ hasCapability: (_pluginId, capability) => capability !== 'clipboard.write' });
        await expect(harness.broker.apply(authority, [{
            id: 'copy', kind: 'output.clipboard-text', payload: { text: 'blocked' },
        }], { outputGesture: { issuedAt: Date.now() } })).rejects.toMatchObject({ code: 'AUTHORITY_REVOKED' });
        expect(harness.dependencies.copyTextOutput).not.toHaveBeenCalled();
    });

    it('stops before the next queued effect when its owning session is cancelled', async () => {
        const harness = createHarness();
        let cancelled = false;
        const readPage = vi.fn((input: Parameters<PluginUiEffectDependencies['readCollectionPage']>[0]) => {
            cancelled = true;
            return harness.dependencies.readCollectionPage(input);
        });
        const broker = createPluginUiEffectBroker({
            ...harness.dependencies,
            readCollectionPage: readPage,
        });
        const receipts = await broker.apply(authority, [
            { id: 'page:one', kind: 'storage.collection.read-page', payload: { collectionId: 'records', cursor: null, limit: 1 } },
            { id: 'page:two', kind: 'storage.collection.read-page', payload: { collectionId: 'records', cursor: null, limit: 1 } },
        ], { isCancelled: () => cancelled });

        expect(readPage).toHaveBeenCalledTimes(1);
        expect(receipts).toHaveLength(1);
        expect(receipts[0]).toMatchObject({ effectId: 'page:one', ok: true });
    });

    it('rejects a canvas save when its captured target was deleted', async () => {
        const harness = createHarness();
        const broker = createPluginUiEffectBroker({
            ...harness.dependencies,
            isCapturedContextCurrent: () => false,
        });
        const canvasAuthority = {
            ...authority,
            capturedContext: {
                schema: 'axiom.entity-reference' as const,
                schemaVersion: 1 as const,
                kind: 'core.node' as const,
                id: 'deleted-node',
                location: { processId: 'process-one', graphPath: ['parent'] },
            },
        };

        await expect(broker.apply(canvasAuthority, [putEffect([item('one')])]))
            .rejects.toMatchObject({ code: 'CAPTURED_CONTEXT_STALE' });
        expect(harness.transact).not.toHaveBeenCalled();
        expect(harness.getRevision()).toBe(0);
    });

    it('routes package navigation through the constrained workspace broker', async () => {
        const harness = createHarness();
        const open = vi.fn(input => ({
            schema: 'axiom.plugin-navigation-result' as const,
            schemaVersion: 1 as const,
            status: 'opened' as const,
            reference: input.reference,
        }));
        const broker = createPluginUiEffectBroker({
            ...harness.dependencies,
            connectPublicApi: () => ({ workspace: { open } }) as unknown as NemotoPluginApi,
        });
        const reference = {
            schema: 'axiom.entity-reference' as const, schemaVersion: 1 as const,
            kind: 'core.node' as const, id: 'node-one', location: { processId: 'process-one' },
        };
        const receipts = await broker.apply(authority, [{
            id: 'open:context', kind: 'workspace.open',
            payload: { schema: 'axiom.plugin-navigation-intent', schemaVersion: 1, action: 'reveal', reference },
        }]);

        expect(open).toHaveBeenCalledWith({
            schema: 'axiom.plugin-navigation-intent', schemaVersion: 1, action: 'reveal', reference,
        });
        expect(receipts[0]).toMatchObject({ ok: true, result: { status: 'opened', reference } });
    });

    it('fails closed when a collection page exceeds the 64 KiB executable UI limit', async () => {
        const harness = createHarness();
        const hugeItem = item('large', 'x'.repeat(65 * 1024));
        const broker = createPluginUiEffectBroker({
            ...harness.dependencies,
            readCollectionPage: () => ({
                portfolioRevision: 0,
                collectionId: 'records',
                items: [hugeItem],
                nextCursor: null,
            }),
        });
        const receipts = await broker.apply(authority, [
            { id: 'page:huge', kind: 'storage.collection.read-page', payload: { collectionId: 'records', cursor: null, limit: 1 } },
        ]);
        expect(receipts).toEqual([
            {
                kind: 'effect-result',
                effectId: 'page:huge',
                ok: false,
                error: {
                    code: 'SNAPSHOT_PAGE_LIMIT_EXCEEDED',
                    message: 'Records in this collection exceed the 64 KiB executable UI limit. Open the standard view to access or edit large records.',
                    retryable: false,
                    outcomeUnknown: false,
                },
            },
        ]);
    });
});
