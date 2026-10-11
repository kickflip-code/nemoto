import { beforeEach, describe, expect, it } from 'vitest';
import { usePortfolioStore } from './usePortfolioStore';
import { useProcessSessionStore } from './useProcessSessionStore';

describe('process session boundary', () => {
    beforeEach(() => {
        useProcessSessionStore.getState().resetForPortfolio('process-1');
    });

    it('keeps active process and breadcrumb navigation outside portfolio state', () => {
        const portfolioBefore = usePortfolioStore.getState().portfolio;

        useProcessSessionStore.getState().pushBreadcrumb('node-1');
        useProcessSessionStore.getState().setBreadcrumbStack(['node-1', 'node-2']);

        expect(useProcessSessionStore.getState()).toMatchObject({
            activeProcessId: 'process-1',
            breadcrumbStack: ['node-1', 'node-2'],
        });
        expect(usePortfolioStore.getState().portfolio).toBe(portfolioBefore);
        expect(usePortfolioStore.getState()).not.toHaveProperty('activeProcessId');
        expect(usePortfolioStore.getState()).not.toHaveProperty('breadcrumbStack');
    });

    it('resets navigation when a new portfolio session is hydrated', () => {
        useProcessSessionStore.getState().setBreadcrumbStack(['node-1']);
        useProcessSessionStore.getState().resetForPortfolio('process-2');

        expect(useProcessSessionStore.getState()).toMatchObject({
            activeProcessId: 'process-2',
            breadcrumbStack: [],
        });
    });
});
