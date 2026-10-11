import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PluginImportReviewDialog from './PluginImportReviewDialog';
import type { PreparedPluginImport } from '../../stores/actions/preparedPluginImport';

const plan: PreparedPluginImport = { sourceId: 'source', sourceName: 'example.axiom', mergedItemCount: 1, rows: [
    { pluginId: 'org.example.notes', recordId: 'r1', role: 'Subject', oldTarget: 'Old node', destination: 'New node', status: 'mapped' },
    { pluginId: 'org.example.notes', recordId: 'future', role: 'Unsupported document', oldTarget: 'Unknown', destination: 'Retained in source file', status: 'excluded' },
] };
describe('plugin import review', () => {
    it('shows the mapping and requires acknowledging exclusions before commit', () => {
        const onCommit = vi.fn();
        render(<PluginImportReviewDialog plan={plan} onClose={vi.fn()} onCommit={onCommit} />);
        expect(screen.getByRole('dialog', { name: 'Review plugin import' })).toBeInTheDocument();
        expect(screen.getByText('Old node')).toBeInTheDocument();
        expect(screen.getByText('New node')).toBeInTheDocument();
        const commit = screen.getByRole('button', { name: 'Import reviewed data' });
        expect(commit).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(commit);
        expect(onCommit).toHaveBeenCalledOnce();
    });
    it('shows a stale-plan failure without permitting a blind retry', () => {
        const onCommit = vi.fn(() => { throw new Error('The import preview is stale.'); });
        const onClose = vi.fn();
        render(<PluginImportReviewDialog plan={{ ...plan, rows: [plan.rows[0]] }} onClose={onClose} onCommit={onCommit} />);
        fireEvent.click(screen.getByRole('button', { name: 'Import reviewed data' }));
        expect(screen.getByRole('alert')).toHaveTextContent('stale');
        expect(screen.getByRole('button', { name: 'Import reviewed data' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
