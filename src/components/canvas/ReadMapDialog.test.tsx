import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useState } from 'react';
import { ThemeProvider } from '../../context/ThemeContext';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { emptyPortfolio } from '../../stores/slices/coreSlice';
import ReadMapDialog from './ReadMapDialog';

const scroll = vi.fn();
function Harness() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Read map</button>{open && <ReadMapDialog onClose={() => setOpen(false)} />}</>;
}

describe('Read map keyboard and data isolation', () => {
    it('isolates background headings and newly mounted portals, then restores access on close', async () => {
        const user = userEvent.setup();
        const { container, unmount } = render(<StrictMode><h1>Background process</h1><Harness /></StrictMode>);
        container.setAttribute('aria-hidden', 'false');
        const trigger = screen.getByRole('button', { name: 'Read map' });
        await user.click(trigger);
        expect(container).toHaveAttribute('inert');
        expect(container).toHaveAttribute('aria-hidden', 'true');
        expect(screen.queryByRole('heading', { name: 'Background process' })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Read map' })).toBeInTheDocument();
        const latePortal = document.createElement('div');
        const alreadyHidden = document.createElement('div');
        alreadyHidden.setAttribute('inert', '');
        alreadyHidden.setAttribute('aria-hidden', 'true');
        try {
            await act(async () => { document.body.append(latePortal, alreadyHidden); });
            expect(latePortal).toHaveAttribute('inert');
            expect(latePortal).toHaveAttribute('aria-hidden', 'true');
            await user.keyboard('{Escape}');
            expect(container).not.toHaveAttribute('inert');
            expect(container).toHaveAttribute('aria-hidden', 'false');
            expect(screen.getByRole('heading', { name: 'Background process' })).toBeInTheDocument();
            expect(trigger).toHaveFocus();
            expect(latePortal).not.toHaveAttribute('inert');
            expect(latePortal).not.toHaveAttribute('aria-hidden');
            expect(alreadyHidden).toHaveAttribute('inert');
            expect(alreadyHidden).toHaveAttribute('aria-hidden', 'true');
            await user.click(trigger);
            unmount();
            expect(container).not.toHaveAttribute('inert');
        } finally {
            latePortal.remove();
            alreadyHidden.remove();
        }
    });

    beforeEach(() => {
        HTMLElement.prototype.scrollIntoView = scroll;
        scroll.mockClear();
        const portfolio = structuredClone(emptyPortfolio);
        portfolio.processes = [{ id: 'process', title: 'Lifecycle', mode: 'blank', createdAt: '', updatedAt: '', subGraphs: {},
            graph: { nodes: [
                { id: 'a', type: 'action', label: 'First', position: { x: 0, y: 0 } },
                { id: 'b', type: 'action', label: 'Next', position: { x: 100, y: 0 } },
            ], edges: [{ id: 'edge', sourceId: 'a', targetId: 'b', style: 'solid', label: 'Approved' }], swimlanes: [] },
        }];
        portfolio.assets = [{ id: 'shared-id', type: 'system', name: 'Private local name' }];
        usePortfolioStore.getState().hydratePortfolio(portfolio);
        useProcessSessionStore.getState().resetForPortfolio('process');
        useCanvasStore.getState().loadGraph(portfolio.processes[0].graph);
        useCanvasStore.getState().selectElements(['a'], ['edge']);
        useCanvasStore.temporal.getState().clear();
    });

    it.each(['void', 'soft', 'hard'] as const)('follows a connection and returns focus without editing data in %s', async theme => {
        useSettingsStore.setState({ theme, activeThemeId: null });
        const user = userEvent.setup();
        const before = structuredClone({ graph: useCanvasStore.getState().graph, portfolio: usePortfolioStore.getState().portfolio,
            revision: usePortfolioStore.getState().changeRevision, dirty: usePortfolioStore.getState().isDirty });
        render(<ThemeProvider><Harness /></ThemeProvider>);
        await user.tab();
        await user.keyboard('{Enter}');
        expect(await screen.findByRole('dialog', { name: 'Read map' })).toHaveFocus();
        expect(screen.getByText('Lifecycle')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('1 node and 1 connection selected');
        await user.tab(); // Close
        await user.tab(); // Scrollable map contents, also usable without links
        expect(screen.getByRole('region', { name: 'Map contents' })).toHaveFocus();
        await user.tab(); // source
        await user.tab(); // destination
        expect(screen.getAllByRole('link', { name: 'Node 2 — action: Next' })[0]).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(screen.getByRole('heading', { name: 'Node 2 — action: Next' })).toHaveFocus();
        expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Read map' })).toHaveFocus();
        expect({ graph: useCanvasStore.getState().graph, portfolio: usePortfolioStore.getState().portfolio,
            revision: usePortfolioStore.getState().changeRevision, dirty: usePortfolioStore.getState().isDirty }).toEqual(before);
        expect(useCanvasStore.temporal.getState().pastStates).toEqual([]);
        expect(useCanvasStore.getState().selectedNodeIds).toEqual(['a']);
    });

    it('reads only the imported graph, with no local resource-name or selection bleed', async () => {
        useCanvasStore.getState().setPreviewGraph({ nodes: [{ id: 'a', type: 'resource', label: 'Imported system', position: { x: 0, y: 0 }, assetIds: ['shared-id'] }], edges: [], swimlanes: [] });
        render(<ReadMapDialog onClose={() => {}} />);
        expect(screen.getByText('Imported process — read-only')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /Imported system/ })).toBeInTheDocument();
        expect(screen.queryByText(/Private local name|Lifecycle|Selected node/)).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Read-only preview; no selection');
    });

    it('keeps the status quiet on position changes and updates it on a real selection change', async () => {
        render(<ReadMapDialog onClose={() => {}} />);
        const status = screen.getByRole('status');
        const changes = vi.fn();
        const observer = new MutationObserver(changes);
        observer.observe(status, { childList: true, characterData: true, subtree: true });
        await act(async () => useCanvasStore.getState().updateNodes([{ id: 'a', updates: { position: { x: 50, y: 20 } } }]));
        expect(changes).not.toHaveBeenCalled();
        await act(async () => useCanvasStore.getState().selectElements([], []));
        expect(status).toHaveTextContent('0 nodes and 0 connections selected');
        expect(changes).toHaveBeenCalledOnce();
        observer.disconnect();
    });

    it('keeps labels as text and exposes dangling connections and an empty map', () => {
        useCanvasStore.getState().loadGraph({ nodes: [], swimlanes: [], edges: [{ id: 'broken', sourceId: 'a', targetId: 'b', style: 'solid', label: '<img src=x onerror=alert(1)>' }] });
        const { container } = render(<ReadMapDialog onClose={() => {}} />);
        expect(screen.getByText('This map has no nodes.')).toBeInTheDocument();
        const broken = screen.getByRole('region', { name: 'Connections with missing nodes' });
        expect(within(broken).getAllByText('Missing node')).toHaveLength(2);
        expect(broken).toHaveTextContent('<img src=x onerror=alert(1)>');
        expect(container.ownerDocument.querySelector('img')).toBeNull();
    });
});
