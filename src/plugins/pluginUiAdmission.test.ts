import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/plugins/protocol/ui-admission-v1.json';
import { PluginViewContributionSchema } from './contributionSchemas';
import { ExecutablePackageReviewSchema, createExecutableInstallApproval } from './executablePackageConsent';
import { parsePluginManifest } from './manifest';
import { requiredCapabilitiesForPluginUi, validateComposedViewAdmission } from './packageInspection';

const clone = <T>(value: T): T => structuredClone(value);

describe('composed view package admission', () => {
    it.each(Object.entries(fixture.effectCapabilities))('maps %s to its exact additional grants', (effect, capabilities) => {
        const requirement = PluginViewContributionSchema.parse({
            ...fixture.composedView,
            ui: { ...fixture.composedView.ui, requiredEffects: [effect] },
        });
        if (requirement.renderer !== 'composed-view') throw new Error('Expected composed view.');
        expect(requiredCapabilitiesForPluginUi(requirement.ui))
            .toEqual(['compute.isolated', ...capabilities].sort());
    });

    it.each(fixture.cases)('$name', testCase => {
        const manifestSource = clone(fixture.manifest);
        manifestSource.compatibility.axiomPluginApi = testCase.apiRange;
        manifestSource.capabilities = testCase.capabilities;
        const viewSource = clone(fixture.composedView);
        viewSource.operation = testCase.operation;
        viewSource.storageViewId = testCase.storageViewId;
        viewSource.ui.requiredPrimitives = testCase.requiredPrimitives;
        viewSource.ui.requiredEffects = testCase.requiredEffects;
        try {
            const manifest = parsePluginManifest(manifestSource);
            const legacy = PluginViewContributionSchema.parse(fixture.legacyView);
            const view = PluginViewContributionSchema.parse(viewSource);
            const views = [legacy, view];
            if (testCase.duplicateOperation) {
                views.push(PluginViewContributionSchema.parse({
                    ...viewSource,
                    id: 'org.axiom.ui-fixture/composed-two',
                }));
            }
            validateComposedViewAdmission(manifest, views);
            expect(testCase.valid).toBe(true);
        } catch {
            expect(testCase.valid).toBe(false);
        }
    });

    it('binds exact reviewed operations and all required grants into approval', () => {
        const review = ExecutablePackageReviewSchema.parse({
            schema: 'axiom.executable-package-review', schemaVersion: 1,
            archiveSha256: 'a'.repeat(64),
            identity: { pluginId: 'org.axiom.ui-fixture', pluginVersion: '1.0.0', dataVersion: 1 },
            name: 'Fixture', description: 'Fixture', publisherName: null,
            requestedCapabilities: ['compute.isolated', 'portfolio.read-scoped'],
            moduleSha256: 'b'.repeat(64), compressedBytes: 100, expandedBytes: 200,
            contributionCount: 2,
            interactiveOperations: [{
                viewId: 'org.axiom.ui-fixture/composed',
                operation: 'ui.records.reduce',
                requiredCapabilities: ['compute.isolated', 'portfolio.read-scoped'],
            }],
        });
        expect(() => createExecutableInstallApproval(review, ['compute.isolated'], true))
            .toThrow(/every capability/i);
        expect(createExecutableInstallApproval(
            review,
            ['compute.isolated', 'portfolio.read-scoped'],
            true,
        )).toMatchObject({ approvedInteractiveOperations: ['ui.records.reduce'] });
    });

    it('keeps existing proposal reviews operation-free', () => {
        const review = ExecutablePackageReviewSchema.parse({
            schema: 'axiom.executable-package-review', schemaVersion: 1,
            archiveSha256: 'a'.repeat(64),
            identity: { pluginId: 'org.axiom.proposal', pluginVersion: '1.0.0', dataVersion: 1 },
            name: 'Proposal', description: 'Proposal fixture', publisherName: null,
            requestedCapabilities: ['compute.isolated', 'proposal.create'],
            moduleSha256: 'b'.repeat(64), compressedBytes: 100, expandedBytes: 200,
            contributionCount: 1,
        });
        expect(review.interactiveOperations).toEqual([]);
        expect(createExecutableInstallApproval(review, ['compute.isolated'], true)
            .approvedInteractiveOperations).toEqual([]);
    });
});
