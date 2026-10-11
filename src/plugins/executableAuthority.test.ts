import { describe, expect, it } from 'vitest';
import {
    ExecutableActivationSnapshotSchema,
    ExecutableAuthoritySyncOutcomeSchema,
    createExecutableActivationSnapshot,
} from './executableAuthority';

const requirement = {
    pluginId: 'org.axiom.compute',
    version: '=1.0.0',
    dataVersion: 1,
    requirement: 'recommended' as const,
    activation: 'active' as const,
};

describe('executable authority synchronization contracts', () => {
    it('carries only strict Portfolio activation facts into the native boundary', () => {
        const snapshot = createExecutableActivationSnapshot([requirement]);

        expect(Object.keys(snapshot).sort()).toEqual(['requirements', 'schema', 'schemaVersion']);
        expect(snapshot.requirements).toEqual([requirement]);
        expect(snapshot).not.toHaveProperty('identity');
        expect(snapshot).not.toHaveProperty('grantedCapabilities');
        expect(snapshot).not.toHaveProperty('authorityScopeId');
    });

    it('rejects duplicate requirements and caller-added authority fields', () => {
        expect(ExecutableActivationSnapshotSchema.safeParse({
            schema: 'axiom.executable-activation-snapshot',
            schemaVersion: 1,
            requirements: [requirement, requirement],
        }).success).toBe(false);
        expect(ExecutableActivationSnapshotSchema.safeParse({
            schema: 'axiom.executable-activation-snapshot',
            schemaVersion: 1,
            requirements: [requirement],
            grantedCapabilities: ['proposal.create'],
        }).success).toBe(false);
    });

    it('requires authorization to agree with native eligibility and either execution-gate state', () => {
        const base = {
            schema: 'axiom.executable-authority-sync',
            schemaVersion: 1,
            authorityScopeId: 'portfolio:main',
            hostPluginApiVersion: '1.8.0',
            executionEnabled: false,
            decisions: [{
                identity: {
                    pluginId: 'org.axiom.compute',
                    pluginVersion: '1.0.0',
                    dataVersion: 1,
                },
                portfolioActive: true,
                compatible: true,
                effectiveCapabilities: ['compute.isolated'],
                eligible: true,
                authorized: false,
                authorityGeneration: 1,
                invalidatedSessions: 0,
            }],
        };
        expect(ExecutableAuthoritySyncOutcomeSchema.parse(base)).toMatchObject({
            executionEnabled: false,
            decisions: [{ eligible: true, authorized: false }],
        });
        expect(ExecutableAuthoritySyncOutcomeSchema.safeParse({
            ...base,
            decisions: [{ ...base.decisions[0], authorized: true }],
        }).success).toBe(false);
        expect(ExecutableAuthoritySyncOutcomeSchema.parse({
            ...base,
            executionEnabled: true,
            decisions: [{ ...base.decisions[0], authorized: true }],
        })).toMatchObject({
            executionEnabled: true,
            decisions: [{ eligible: true, authorized: true }],
        });
        expect(ExecutableAuthoritySyncOutcomeSchema.safeParse({
            ...base,
            executionEnabled: true,
        }).success).toBe(false);
    });

    it('accepts the complete native-owned capability set needed by packaged UI plugins', () => {
        const outcome = {
            schema: 'axiom.executable-authority-sync',
            schemaVersion: 1,
            authorityScopeId: 'portfolio:main',
            hostPluginApiVersion: '1.8.0',
            executionEnabled: true,
            decisions: [{
                identity: {
                    pluginId: 'org.axiom.tasks',
                    pluginVersion: '1.1.0',
                    dataVersion: 1,
                },
                portfolioActive: true,
                compatible: true,
                effectiveCapabilities: [
                    'compute.isolated',
                    'plugin-data.write',
                    'portfolio.read-scoped',
                    'workspace.navigate',
                ],
                eligible: true,
                authorized: true,
                authorityGeneration: 1,
                invalidatedSessions: 0,
            }],
        };

        expect(ExecutableAuthoritySyncOutcomeSchema.parse(outcome).decisions[0].effectiveCapabilities)
            .toEqual(outcome.decisions[0].effectiveCapabilities);
        expect(ExecutableAuthoritySyncOutcomeSchema.safeParse({
            ...outcome,
            decisions: [{
                ...outcome.decisions[0],
                effectiveCapabilities: [...outcome.decisions[0].effectiveCapabilities, 'unknown.capability'],
            }],
        }).success).toBe(false);
    });
});
