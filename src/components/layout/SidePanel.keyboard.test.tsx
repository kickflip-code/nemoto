import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import SidePanel from './SidePanel';
import { ThemeProvider } from '../../context/ThemeContext';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { emptyPortfolio } from '../../stores/slices/coreSlice';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { useUIStore } from '../../stores/useUIStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useSettingsStore } from '../../stores/useSettingsStore';

describe('Portfolio keyboard navigation', () => {
    it('creates a resource through named keyboard-accessible controls', async () => {
        const user = userEvent.setup();
        render(<ThemeProvider><SidePanel /></ThemeProvider>);
        screen.getByRole('button', { name: 'Quick Create Resource' }).focus();
        await user.keyboard('{Enter}');
        expect(screen.getByRole('combobox', { name: 'Category' })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('textbox', { name: 'Resource Name' })).toHaveFocus();
        await user.keyboard('Keyboard resource');
        await user.tab();
        await user.keyboard('{Enter}');
        expect(usePortfolioStore.getState().portfolio.assets).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Keyboard resource' })]));
        const resource = screen.getByRole('button', { name: 'Keyboard resource' });
        act(() => useUIStore.getState().selectAsset(null));
        resource.focus();
        await user.keyboard(' ');
        expect(resource).toHaveAttribute('aria-pressed', 'true');
        await user.keyboard('{Shift>}{F10}{/Shift}');
        expect(screen.getByRole('menu')).toBeInTheDocument();
        await user.keyboard('{Escape}');
        expect(resource).toHaveFocus();
    });

    beforeEach(() => {
        const portfolio = structuredClone(emptyPortfolio);
        portfolio.processFolders = [{ id: 'folder', title: 'Lifecycle' }];
        portfolio.processes = [{ id: 'process', title: 'Needs', folderId: 'folder', mode: 'blank',
            createdAt: '2026-09-08', updatedAt: '2026-09-08',
            graph: { nodes: [{ id: 'child', type: 'action', label: 'Investigation', position: { x: 0, y: 0 }, subGraphId: 'sub' }], edges: [], swimlanes: [] },
            subGraphs: { sub: { nodes: [], edges: [], swimlanes: [] } },
        }];
        usePortfolioStore.getState().hydratePortfolio(portfolio);
        useProcessSessionStore.getState().resetForPortfolio(null);
        useUIStore.setState({ processCreationOpen: false, folderCreationRequested: false });
    });

    it.each(['void', 'soft', 'hard'] as const)('opens a folder, process and context menu by keyboard in %s', async theme => {
        useSettingsStore.setState({ theme, activeThemeId: null });
        const user = userEvent.setup();
        render(<ThemeProvider><SidePanel /></ThemeProvider>);
        const resources = screen.getByRole('button', { name: 'Resources' });
        resources.focus();
        await user.keyboard(' ');
        expect(resources).toHaveAttribute('aria-expanded', 'true');
        await user.keyboard('{Enter}');
        expect(resources).toHaveAttribute('aria-expanded', 'false');
        const folder = screen.getByRole('button', { name: 'Lifecycle' });
        folder.focus();
        await user.keyboard('{Enter}');
        expect(folder).toHaveAttribute('aria-expanded', 'true');
        const process = screen.getByRole('button', { name: 'Needs' });
        process.focus();
        await user.keyboard(' ');
        expect(useProcessSessionStore.getState().activeProcessId).toBe('process');
        expect(process).toHaveAttribute('aria-current', 'page');
        fireEvent.keyDown(process, { key: 'F10', shiftKey: true });
        expect(screen.getByRole('menu')).toBeInTheDocument();
        expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(process).toHaveFocus();
        screen.getByRole('button', { name: 'Expand Needs' }).focus();
        await user.keyboard('{Enter}');
        const child = screen.getByRole('button', { name: 'Investigation' });
        child.focus();
        await user.keyboard('{Enter}');
        expect(useProcessSessionStore.getState().breadcrumbStack).toEqual(['child']);
        expect(useCanvasStore.getState().graph.nodes).toEqual([]);
        act(() => useProcessSessionStore.getState().resetForPortfolio(null));
    });
});
