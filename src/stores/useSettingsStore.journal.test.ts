import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from './useSettingsStore';

describe('journal workspace preferences', () => {
    beforeEach(() => {
        useSettingsStore.setState({
            journalDock: 'bottom',
            journalPanelWidth: 840,
        });
    });

    it('stores the selected dock on the device', () => {
        useSettingsStore.getState().setJournalDock('left');
        expect(useSettingsStore.getState().journalDock).toBe('left');
    });

    it('keeps the side panel width within its usable bounds', () => {
        useSettingsStore.getState().setJournalPanelWidth(200);
        expect(useSettingsStore.getState().journalPanelWidth).toBe(560);

        useSettingsStore.getState().setJournalPanelWidth(1600);
        expect(useSettingsStore.getState().journalPanelWidth).toBe(1200);
    });
});
