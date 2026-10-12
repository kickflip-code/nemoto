import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useUIStore } from '../../stores/useUIStore';
import Header from './Header';

describe('Header file menu', () => {
    beforeEach(() => {
        useUIStore.setState({
            activeView: 'journal',
            exportDialogOpen: false,
            folderCreationRequested: false,
            importDialogOpen: false,
            leftPanelOpen: false,
            processCreationOpen: false,
        });
        usePortfolioStore.setState({
            isDirty: false,
            isSaving: false,
            saveError: null,
            savePortfolio: vi.fn().mockResolvedValue(undefined),
        });
    });

    const openFileMenu = () => {
        render(<Header />);
        fireEvent.click(screen.getByTitle('File actions'));
        return screen.getByRole('menu', { name: 'File actions' });
    };

    it('shows the primary file actions in task order', () => {
        const menu = openFileMenu();

        expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual([
            'New process...Ctrl+N',
            'New folder...Ctrl+Shift+N',
            'SaveCtrl+S',
            'Import...',
            'Export...',
        ]);
    });

    it('opens process creation in the designer', () => {
        useUIStore.setState({ folderCreationRequested: true });
        const menu = openFileMenu();

        fireEvent.click(within(menu).getByText('New process...'));

        expect(useUIStore.getState()).toMatchObject({
            activeView: 'designer',
            folderCreationRequested: false,
            leftPanelOpen: true,
            processCreationOpen: true,
        });
    });

    it('requests folder creation in the designer', () => {
        useUIStore.setState({ processCreationOpen: true });
        const menu = openFileMenu();

        fireEvent.click(within(menu).getByText('New folder...'));

        expect(useUIStore.getState()).toMatchObject({
            activeView: 'designer',
            folderCreationRequested: true,
            leftPanelOpen: true,
            processCreationOpen: false,
        });
    });

    it('saves from the menu', () => {
        const savePortfolio = vi.fn().mockResolvedValue(undefined);
        usePortfolioStore.setState({ savePortfolio });
        const menu = openFileMenu();

        fireEvent.click(within(menu).getByText('Save'));

        expect(savePortfolio).toHaveBeenCalledOnce();
    });

    it('exposes search as a keyboard-focusable button', () => {
        render(<Header />);

        const search = screen.getByRole('button', { name: 'Search processes, resources, and notes' });
        expect(search).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
        expect(search).toHaveClass('nemoto-field');
        fireEvent.click(search);
        expect(useUIStore.getState().omniboxOpen).toBe(true);
    });
});
