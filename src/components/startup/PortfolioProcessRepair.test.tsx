import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ loadPortfolioForRepair: vi.fn(), repairPortfolioProcesses: vi.fn() }));
vi.mock('../../lib/tauri', () => native);
import PortfolioProcessRepair from './PortfolioProcessRepair';

const source = () => ({ version: '1.0', processes: ['action', 'subprocess'].map((type, index) => ({
    id: `p${index}`, title: index ? 'Damaged process' : 'Healthy process', description: 'Original story',
    createdAt: '', updatedAt: '', graph: { nodes: [{ id: `n${index}`, type, label: 'Step', position: { x: 0, y: 0 } }], edges: [], swimlanes: [] },
})), assets: [] });

describe('process recovery UI', () => {
    beforeEach(() => { vi.clearAllMocks(); native.loadPortfolioForRepair.mockResolvedValue({ portfolio: source(), revision: 'native-file-revision' }); });

    it('allows inspecting and selecting without writing, then preserves the original and offers reopening', async () => {
        native.repairPortfolioProcesses.mockResolvedValue('C:/test/portfolio.before-repair-123.json');
        const reopen = vi.fn();
        render(<PortfolioProcessRepair onRepaired={reopen} />);
        fireEvent.click(screen.getByRole('button', { name: 'Manage damaged processes' }));
        const damaged = await screen.findByRole('checkbox', { name: 'Damaged process' });
        expect(screen.getByRole('checkbox', { name: 'Healthy process' })).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Remove selected processes (0)' })).toBeDisabled();
        fireEvent.click(damaged);
        expect(native.repairPortfolioProcesses).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Remove selected processes (1)' }));
        expect(await screen.findByText('C:/test/portfolio.before-repair-123.json')).toBeInTheDocument();
        expect(native.repairPortfolioProcesses).toHaveBeenCalledWith('native-file-revision', [1]);
        expect(reopen).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Open repaired portfolio' }));
        expect(reopen).toHaveBeenCalledOnce();
    });

    it('keeps the list and error visible when saving fails or the source changed', async () => {
        native.repairPortfolioProcesses.mockRejectedValue(new Error('The active portfolio changed. Reload the process list.'));
        render(<PortfolioProcessRepair onRepaired={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Manage damaged processes' }));
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Damaged process' }));
        fireEvent.click(screen.getByRole('button', { name: 'Remove selected processes (1)' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('active portfolio changed');
        expect(screen.getByRole('checkbox', { name: 'Damaged process' })).toBeChecked();
    });

    it('reports unreadable files without writing or reopening', async () => {
        native.loadPortfolioForRepair.mockResolvedValue({ portfolio: null, revision: 'invalid' });
        render(<PortfolioProcessRepair onRepaired={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Manage damaged processes' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('readable portfolio'));
        expect(native.repairPortfolioProcesses).not.toHaveBeenCalled();
    });

    it('uses the newly read revision after reloading and selecting again', async () => {
        native.repairPortfolioProcesses.mockRejectedValueOnce(new Error('The active portfolio changed.'))
            .mockResolvedValueOnce('C:/test/preserved.json');
        native.loadPortfolioForRepair.mockResolvedValueOnce({ portfolio: source(), revision: 'first' })
            .mockResolvedValueOnce({ portfolio: source(), revision: 'second' });
        render(<PortfolioProcessRepair onRepaired={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Manage damaged processes' }));
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Damaged process' }));
        fireEvent.click(screen.getByRole('button', { name: 'Remove selected processes (1)' }));
        await screen.findByRole('alert');
        fireEvent.click(screen.getByRole('button', { name: 'Reload process list' }));
        await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Damaged process' })).not.toBeChecked());
        fireEvent.click(screen.getByRole('checkbox', { name: 'Damaged process' }));
        fireEvent.click(screen.getByRole('button', { name: 'Remove selected processes (1)' }));
        await screen.findByText('C:/test/preserved.json');
        expect(native.repairPortfolioProcesses.mock.calls).toEqual([['first', [1]], ['second', [1]]]);
    });
});
