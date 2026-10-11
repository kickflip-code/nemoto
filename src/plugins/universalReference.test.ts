import { describe, expect, it } from 'vitest';
import {
    coreEntityReference,
    CURRENT_UNIVERSAL_REFERENCE_SCHEMA_VERSION,
    parseUniversalEntityReference,
    pluginEntityReference,
    UniversalReferenceContractError,
} from './universalReference';

describe('universal entity reference contract', () => {
    it('distinguishes Core kinds from plugin-owned kinds', () => {
        expect(coreEntityReference('core.asset', 'role-anna')).toEqual({
            schema: 'axiom.entity-reference',
            schemaVersion: 1,
            kind: 'core.asset',
            id: 'role-anna',
            location: undefined,
        });
        expect(pluginEntityReference(
            'org.axiom.fmea/failure-mode',
            'failure-mode-1',
        )).toMatchObject({
            kind: 'org.axiom.fmea/failure-mode',
            id: 'failure-mode-1',
        });
    });

    it('requires graph-owned Core references to identify their process', () => {
        expect(() => parseUniversalEntityReference({
            schema: 'axiom.entity-reference',
            schemaVersion: 1,
            kind: 'core.node',
            id: 'node-1',
        })).toThrow(UniversalReferenceContractError);

        expect(coreEntityReference('core.node', 'node-1', {
            processId: 'process-1',
            graphPath: ['drilldown-parent'],
        }).location).toEqual({
            processId: 'process-1',
            graphPath: ['drilldown-parent'],
        });
    });

    it('rejects unknown fields and future reference versions explicitly', () => {
        expect(() => parseUniversalEntityReference({
            schema: 'axiom.entity-reference',
            schemaVersion: 1,
            kind: 'core.asset',
            id: 'asset-1',
            mutableStore: true,
        })).toThrow(UniversalReferenceContractError);

        try {
            parseUniversalEntityReference({
                schema: 'axiom.entity-reference',
                schemaVersion: CURRENT_UNIVERSAL_REFERENCE_SCHEMA_VERSION + 1,
                kind: 'core.asset',
                id: 'asset-1',
            });
            throw new Error('Expected future reference version to be rejected.');
        } catch (error) {
            expect(error).toBeInstanceOf(UniversalReferenceContractError);
            expect((error as UniversalReferenceContractError).code).toBe('UNSUPPORTED_SCHEMA_VERSION');
        }
    });
});

