import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pako from 'pako';
import App from './App';
import { NodeLinkedContent } from '../../components/canvas/NodeLinkedContentBase';
import viewerCss from './viewer.css?inline';

vi.mock('./GravityView', () => ({ GravityView: () => null }));
vi.mock('./ViewerNodeTypes', () => ({ ViewerNodeTypes: {} }));
vi.mock('./ViewerCustomEdge', () => ({ ViewerCustomEdge: () => null }));
vi.mock('reactflow', () => ({
    default: ({ nodes, onNodeClick, onNodeDoubleClick, onPaneClick }: any) => <div>
        {nodes.map((node: any) => <button key={node.id} aria-label={node.data.label} onClick={event => onNodeClick(event, node)} onDoubleClick={event => onNodeDoubleClick(event, node)}>{node.data.label}<NodeLinkedContent content={node.data.linkedContent} /></button>)}
        <button onClick={onPaneClick}>Map background</button>
    </div>,
    ReactFlowProvider: ({ children }: any) => children,
    Background: () => null,
    Controls: () => null,
}));

function modifyExport(update: (payload: any) => void) {
    const element = document.getElementById('axiom-data')!;
    const bytes = Uint8Array.from(atob(element.textContent!), c => c.charCodeAt(0));
    const payload = JSON.parse(pako.inflate(bytes, { to: 'string' }));
    update(payload);
    element.textContent = btoa(String.fromCharCode(...pako.gzip(JSON.stringify(payload))));
}

describe('standalone reader interactions', () => {
    beforeEach(() => {
        const payload = {
            rootProcessId: 'process', theme: 'void', exportedAt: '2026-10-02',
            data: {
                processes: [{ id: 'process', title: 'Åtgärdsflöde', graph: {
                    nodes: [{ id: 'step', type: 'action', label: 'Inspect step', assetIds: ['resource'], position: { x: 0, y: 0 } }], edges: [],
                } }],
                assets: [{ id: 'resource', name: 'Resource to read', description: 'Copy resource details', metadata: { path: 'ÅÄÖ/åäö' } }],
                journal: { entries: [{ id: 'note', title: 'Long journal note', createdAt: '2026-10-02', content: '<p>Readable journal content</p>'.repeat(100), linkedContext: [{ id: 'step', type: 'node' }] }] },
            },
        };
        const element = document.createElement('script');
        element.type = 'application/json';
        element.id = 'axiom-data';
        element.textContent = btoa(String.fromCharCode(...pako.gzip(JSON.stringify(payload))));
        document.body.appendChild(element);
    });

    afterEach(() => document.getElementById('axiom-data')?.remove());

    it('explicitly allows selection on portalled reader text even when the page disables it', () => {
        const style = document.createElement('style');
        style.textContent = viewerCss;
        document.head.appendChild(style);
        const previousSelection = document.body.style.userSelect;
        document.body.style.userSelect = 'none';
        modifyExport(payload => {
            payload.data.journal.entries[0].content = '<p>Copy paragraph</p><pre><code>echo Copy script</code></pre>';
        });
        try {
            render(<App />);
            fireEvent.click(screen.getByRole('button', { name: 'Inspect step' }));
            fireEvent.click(screen.getByText('Resource to read'));
            expect(getComputedStyle(screen.getByRole('dialog', { name: 'Resource to read' })).userSelect).toBe('text');
            for (const text of ['Copy resource details', 'ÅÄÖ/åäö']) {
                expect(getComputedStyle(screen.getByText(text)).userSelect).toBe('text');
            }
            fireEvent.click(screen.getByRole('button', { name: 'Close resource' }));
            fireEvent.click(screen.getByText('Long journal note'));
            expect(getComputedStyle(screen.getByRole('dialog', { name: 'Long journal note' })).userSelect).toBe('text');
            for (const text of ['Copy paragraph', 'echo Copy script']) {
                expect(getComputedStyle(screen.getByText(text)).userSelect).toBe('text');
            }
        } finally {
            style.remove();
            document.body.style.userSelect = previousSelection;
        }
    });

    it('does not show stale indicators for content omitted from the export', () => {
        modifyExport(payload => {
            payload.data.assets = [];
            payload.data.journal.entries = [];
            payload.data.processes[0].graph.nodes[0].data = { linkedContent: { resources: true, journal: true } };
        });
        render(<App />);
        expect(screen.queryByRole('img', { name: 'Linked resources' })).not.toBeInTheDocument();
        expect(screen.queryByRole('img', { name: 'Linked Journal notes' })).not.toBeInTheDocument();
    });

    it('resolves process-scoped Journal links inside nested graphs', () => {
        modifyExport(payload => {
            const process = payload.data.processes[0];
            const child = { ...process.graph.nodes[0], id: 'child', label: 'Nested step' };
            process.graph.nodes[0].subGraphId = 'nested';
            process.subGraphs = { nested: { nodes: [child], edges: [] } };
            payload.data.journal.entries[0].linkedContext = [{ id: 'child', type: 'node', processId: 'process' }];
        });
        render(<App />);
        expect(screen.queryByRole('img', { name: 'Linked Journal notes' })).not.toBeInTheDocument();
        fireEvent.doubleClick(screen.getByRole('button', { name: 'Inspect step' }));
        expect(screen.getByRole('button', { name: 'Nested step' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Linked Journal notes' })).toBeInTheDocument();
    });

    it('keeps notes linked to a resource node reachable after its reader closes', () => {
        modifyExport(payload => { payload.data.processes[0].graph.nodes[0].type = 'resource'; });
        render(<App />);
        fireEvent.click(screen.getByRole('button', { name: 'Resource to read' }));
        expect(screen.getByRole('dialog', { name: 'Resource to read' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close resource' }));
        fireEvent.click(screen.getByText('Long journal note'));
        expect(screen.getByRole('dialog', { name: 'Long journal note' })).toBeInTheDocument();
    });

    it('opens details only on selection and supports closing and reopening them', () => {
        render(<App />);
        expect(screen.getByRole('img', { name: 'Linked resources' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Linked Journal notes' })).toBeInTheDocument();
        expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Inspect step' }));
        expect(screen.getByRole('complementary', { name: 'Selection details' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
        expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Inspect step' }));
        expect(screen.getByRole('complementary')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Map background' }));
        expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    });

    it('opens and closes full resource and journal readers and shows a readable download control', () => {
        render(<App />);
        expect(screen.getByRole('button', { name: 'Download .nemoto-process' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Inspect step' }));
        fireEvent.click(screen.getByText('Resource to read'));
        expect(screen.getByRole('dialog', { name: 'Resource to read' })).toHaveTextContent('ÅÄÖ/åäö');
        fireEvent.click(screen.getByRole('button', { name: 'Close resource' }));
        fireEvent.click(screen.getByText('Long journal note'));
        expect(screen.getByRole('dialog', { name: 'Long journal note' })).toHaveTextContent('Readable journal content');
        fireEvent.click(screen.getByRole('button', { name: 'Close journal entry' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
