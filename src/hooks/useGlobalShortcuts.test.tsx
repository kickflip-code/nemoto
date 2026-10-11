import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from '../stores/useUIStore';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useGlobalShortcuts } from './useGlobalShortcuts';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

function ShortcutHarness() {
    useGlobalShortcuts();
    return null;
}

describe('global shortcuts', () => {
    beforeEach(() => {
        useUIStore.setState({
            omniboxOpen: false,
            processCreationOpen: false,
            folderCreationRequested: false,
            helpOpen: false,
            activeView: 'designer',
            leftPanelOpen: true,
            journalPanelExpanded: false,
        });
    });

    it('toggles Omnibox with Ctrl+K while it is unmounted', () => {
        render(<ShortcutHarness />);

        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        expect(useUIStore.getState().omniboxOpen).toBe(true);

        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        expect(useUIStore.getState().omniboxOpen).toBe(false);
    });

    it('toggles the Help dialog with F1', () => {
        render(<ShortcutHarness />);

        fireEvent.keyDown(window, { key: 'F1' });
        expect(useUIStore.getState().helpOpen).toBe(true);

        fireEvent.keyDown(window, { key: 'F1' });
        expect(useUIStore.getState().helpOpen).toBe(false);
    });

    it('leaves Ctrl+K available inside editable fields', () => {
        render(<ShortcutHarness />);
        const editor = document.createElement('div');
        editor.setAttribute('contenteditable', 'true');
        document.body.appendChild(editor);

        fireEvent.keyDown(editor, { key: 'k', ctrlKey: true });

        expect(useUIStore.getState().omniboxOpen).toBe(false);
        editor.remove();
    });

    it('opens process creation with Ctrl+N', () => {
        render(<ShortcutHarness />);

        fireEvent.keyDown(window, { key: 'n', ctrlKey: true });

        expect(useUIStore.getState().processCreationOpen).toBe(true);
    });

    it('requests folder creation with Ctrl+Shift+N', () => {
        render(<ShortcutHarness />);

        fireEvent.keyDown(window, { key: 'N', ctrlKey: true, shiftKey: true });

        expect(useUIStore.getState().folderCreationRequested).toBe(true);
    });

    it('leaves process and journal shortcuts available to editable fields', () => {
        render(<ShortcutHarness />);
        const input = document.createElement('input');
        document.body.appendChild(input);

        fireEvent.keyDown(input, { key: 'n', ctrlKey: true });
        fireEvent.keyDown(input, { key: 'j', ctrlKey: true });

        expect(useUIStore.getState().processCreationOpen).toBe(false);
        expect(useUIStore.getState().journalPanelExpanded).toBe(false);
        input.remove();
    });

    it('does not open another global dialog above an existing modal', () => {
        render(<ShortcutHarness />);
        const modal = document.createElement('div');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        document.body.appendChild(modal);

        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        fireEvent.keyDown(window, { key: 'F1' });

        expect(useUIStore.getState().omniboxOpen).toBe(false);
        expect(useUIStore.getState().helpOpen).toBe(false);
        modal.remove();
    });

    it('saves with Ctrl+S', async () => {
        const savePortfolio = vi.fn().mockResolvedValue(undefined);
        usePortfolioStore.setState({ savePortfolio });
        render(<ShortcutHarness />);

        fireEvent.keyDown(window, { key: 's', ctrlKey: true });

        await waitFor(() => expect(savePortfolio).toHaveBeenCalledOnce());
    });
});
