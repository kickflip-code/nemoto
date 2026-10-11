import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from './useUIStore';

describe('journal panel UI state', () => {
    beforeEach(() => {
        useUIStore.setState({
            journalPanelExpanded: false,
            journalPanelMaximized: false,
            journalPanelHeight: 400,
        });
    });

    it('opens the journal when maximizing and restores the previous panel mode', () => {
        useUIStore.getState().toggleJournalPanelMaximized();

        expect(useUIStore.getState()).toMatchObject({
            journalPanelExpanded: true,
            journalPanelMaximized: true,
            journalPanelHeight: 400,
        });

        useUIStore.getState().toggleJournalPanelMaximized();

        expect(useUIStore.getState()).toMatchObject({
            journalPanelExpanded: true,
            journalPanelMaximized: false,
            journalPanelHeight: 400,
        });
    });

    it('leaves maximized mode when the journal is collapsed', () => {
        useUIStore.setState({
            journalPanelExpanded: true,
            journalPanelMaximized: true,
        });

        useUIStore.getState().collapseJournalPanel();

        expect(useUIStore.getState()).toMatchObject({
            journalPanelExpanded: false,
            journalPanelMaximized: false,
        });
    });
});
