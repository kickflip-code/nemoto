import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, Toaster } from 'sonner';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { emptyPortfolio } from '../../stores/slices/coreSlice';
import { useUIStore } from '../../stores/useUIStore';
import ExportDialog from './ExportDialog';

const nativeExport = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: nativeExport.save }));
vi.mock('../../lib/tauri', async importOriginal => ({
    ...await importOriginal<typeof import('../../lib/tauri')>(),
    writeNemotoFileAtomic: nativeExport.write,
}));

describe('Process export through the real service', () => {
    beforeEach(() => {
        nativeExport.save.mockReset().mockResolvedValue('C:/Exports/process.ax');
        nativeExport.write.mockReset().mockResolvedValue(undefined);
        const portfolio = structuredClone(emptyPortfolio);
        portfolio.processes = [{ id: 'process-1', title: 'Process', mode: 'blank',
            createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z',
            graph: { nodes: [], edges: [], swimlanes: [] }, subGraphs: {} }];
        usePortfolioStore.getState().hydratePortfolio(portfolio);
        useUIStore.setState({ exportDialogOpen: true });
    });

    afterEach(() => {
        toast.dismiss();
        useUIStore.setState({ exportDialogOpen: false });
    });

    it('shows a write error, keeps the dialog open, and succeeds on retry', async () => {
        nativeExport.write.mockRejectedValueOnce(new Error('Access denied'));
        render(<><Toaster /><ExportDialog /></>);
        const exportButton = screen.getByRole('button', { name: /Export Active Process/ });
        fireEvent.click(exportButton);
        expect(await screen.findByText(/Failed to export process: Access denied/)).toBeVisible();
        expect(screen.queryByText('Process export saved')).not.toBeInTheDocument();
        expect(useUIStore.getState().exportDialogOpen).toBe(true);
        expect(exportButton).toBeEnabled();
        fireEvent.click(exportButton);
        expect(await screen.findByText('Process export saved')).toBeVisible();
        expect(nativeExport.write).toHaveBeenCalledTimes(2);
        expect(useUIStore.getState().exportDialogOpen).toBe(false);
        const payload = JSON.parse(nativeExport.write.mock.calls[1][1]);
        expect(payload.kind).toBe('process-fragment');
        expect(payload.data.processes[0].id).toBe('process-1');
    });

    it('cancels without writing, showing an error, or announcing success', async () => {
        nativeExport.save.mockResolvedValue(null);
        const dismiss = vi.spyOn(toast, 'dismiss');
        const error = vi.spyOn(toast, 'error');
        const success = vi.spyOn(toast, 'success');
        render(<><Toaster /><ExportDialog /></>);
        fireEvent.click(screen.getByRole('button', { name: /Export Active Process/ }));
        await waitFor(() => expect(dismiss).toHaveBeenCalled());
        expect(nativeExport.write).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        expect(success).not.toHaveBeenCalled();
        expect(useUIStore.getState().exportDialogOpen).toBe(true);
    });

    it('reports preparation errors before opening the native save dialog', async () => {
        useProcessSessionStore.setState({ activeProcessId: 'missing-process' });
        render(<><Toaster /><ExportDialog /></>);
        fireEvent.click(screen.getByRole('button', { name: /Export Active Process/ }));
        expect(await screen.findByText(/Failed to export process:/)).toBeVisible();
        expect(nativeExport.save).not.toHaveBeenCalled();
        expect(nativeExport.write).not.toHaveBeenCalled();
        expect(useUIStore.getState().exportDialogOpen).toBe(true);
    });
});

describe('ExportDialog accessibility', () => {
    beforeEach(() => {
        usePortfolioStore.setState({ portfolio: structuredClone(emptyPortfolio) });
        useProcessSessionStore.setState({ activeProcessId: null, breadcrumbStack: [] });
    });

    afterEach(() => {
        useUIStore.setState({ exportDialogOpen: false });
        useProcessSessionStore.setState({ activeProcessId: null, breadcrumbStack: [] });
    });

    it('moves focus inside and closes with Escape', () => {
        useUIStore.setState({ exportDialogOpen: true });
        render(<ExportDialog />);

        const dialog = screen.getByRole('dialog', { name: 'Export' });
        expect(dialog).toHaveFocus();
        expect(screen.getByRole('button', { name: 'Close export dialog' })).toBeInTheDocument();

        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(useUIStore.getState().exportDialogOpen).toBe(false);
    });

    it('summarizes internal notes without adding another export step', () => {
        const portfolio = structuredClone(emptyPortfolio);
        portfolio.processes = [{
            id: 'process-1',
            title: 'Process',
            createdAt: '2026-09-03T00:00:00.000Z',
            updatedAt: '2026-09-03T00:00:00.000Z',
            mode: 'blank',
            graph: { nodes: [], edges: [], swimlanes: [], mode: 'blank' },
            subGraphs: {},
        }];
        portfolio.journal.notebooks = [{
            id: 'notebook-1',
            title: 'Notebook',
            createdAt: '2026-09-03T00:00:00.000Z',
            updatedAt: '2026-09-03T00:00:00.000Z',
        }];
        portfolio.journal.entries = [{
            id: 'entry-internal',
            notebookId: 'notebook-1',
            title: 'Internal note',
            content: '<p>Internal</p>',
            contentFormat: 'html',
            contentVersion: 1,
            tags: [],
            linkedContext: [{ id: 'process-1', type: 'process' }],
            sharePolicy: 'internal',
            createdAt: '2026-09-03T00:00:00.000Z',
            updatedAt: '2026-09-03T00:00:00.000Z',
        }];
        usePortfolioStore.setState({ portfolio });
        useProcessSessionStore.setState({ activeProcessId: 'process-1', breadcrumbStack: [] });

        render(<ExportDialog />);

        expect(screen.getByText('Include linked resources and shareable journal notes')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('1 internal note will be excluded.');
    });
});
