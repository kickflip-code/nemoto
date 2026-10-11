import { describe, expect, it } from 'vitest';
import {
    ExecutablePackageReviewSchema,
    classifyExecutablePackageChange,
    createExecutableInstallApproval,
} from './executablePackageConsent';

const review = ExecutablePackageReviewSchema.parse({
    schema: 'axiom.executable-package-review',
    schemaVersion: 1,
    archiveSha256: '1'.repeat(64),
    identity: { pluginId: 'org.axiom.compute', pluginVersion: '1.0.0', dataVersion: 1 },
    name: 'Compute',
    description: 'Bounded compute fixture.',
    publisherName: null,
    requestedCapabilities: ['compute.isolated'],
    moduleSha256: '2'.repeat(64),
    compressedBytes: 100,
    expandedBytes: 200,
    contributionCount: 1,
});

describe('executable package consent contracts', () => {
    it('rejects missing acknowledgement and grants outside the reviewed request', () => {
        expect(() => createExecutableInstallApproval(
            review,
            ['compute.isolated'],
            false,
        )).toThrow(/acknowledgement/i);
        expect(() => createExecutableInstallApproval(
            review,
            ['compute.isolated', 'proposal.create'],
            true,
        )).toThrow(/did not request/i);
    });

    it('classifies a first install without inventing current state', () => {
        expect(classifyExecutablePackageChange(review, [])).toEqual({
            kind: 'install',
            current: null,
            newlyRequestedCapabilities: ['compute.isolated'],
        });
    });
});
