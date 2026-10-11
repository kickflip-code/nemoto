import { useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { AxiomButton, AxiomDialog } from '../ui';
import { buildReadMap, readMapPath } from './readMap';

export default function ReadMapDialog({ onClose }: { onClose: () => void }) {
    const prefix = useId();
    const graph = useCanvasStore(state => state.previewGraph ?? state.graph);
    const preview = useCanvasStore(state => !!state.previewGraph);
    const selectedNodes = useCanvasStore(state => state.selectedNodeIds);
    const selectedEdges = useCanvasStore(state => state.selectedEdgeIds);
    const assets = usePortfolioStore(state => state.portfolio.assets);
    const activeId = useProcessSessionStore(state => state.activeProcessId);
    const path = useProcessSessionStore(state => state.breadcrumbStack);
    const process = usePortfolioStore(state => state.portfolio.processes.find(item => item.id === activeId));
    const map = useMemo(() => buildReadMap(graph, assets, selectedNodes, selectedEdges, preview), [graph, assets, selectedNodes, selectedEdges, preview]);
    const location = readMapPath(process, path, preview);
    const nodeId = (number: number) => `${prefix}-node-${number}`;
    const nodeLink = (node: typeof map.nodes[number] | undefined) => node
        ? <a href={`#${nodeId(node.number)}`} className="text-accent-primary underline break-words"
            onClick={event => {
                event.preventDefault();
                const heading = document.getElementById(nodeId(node.number));
                heading?.focus({ preventScroll: true });
                heading?.scrollIntoView({ block: 'start', behavior: 'auto' });
            }}>{node.title}</a>
        : <span>Missing node</span>;
    const connection = (index: number) => {
        const edge = map.connections[index];
        return <li key={edge.number} className="break-words">
            Connection {edge.number}: from {nodeLink(edge.source)} to {nodeLink(edge.target)}.
            {' '}{edge.label}{edge.selected ? ' — selected connection' : ''}
        </li>;
    };

    return createPortal(<AxiomDialog aria-labelledby={`${prefix}-title`} aria-describedby={`${prefix}-description`}
        onClose={onClose} isolateBackground rootClassName="z-[10100]" panelClassName="w-full max-w-3xl max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
        <header className="axiom-dialog-header shrink-0 flex items-start justify-between gap-4 px-5 py-4">
            <div className="min-w-0"><h2 id={`${prefix}-title`} className="font-bold">Read map</h2>
                <p className="text-sm break-words">{location}</p></div>
            <AxiomButton onClick={onClose}>Close</AxiomButton>
        </header>
        <div role="region" aria-label="Map contents" tabIndex={0}
            className="min-h-0 overflow-y-auto p-5 space-y-5 text-sm select-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary focus-visible:-outline-offset-2">
            <p id={`${prefix}-description`}>Read the current map as text. Follow a connection link to read its node.
                {' '}This view does not edit the map. Close it to return to the canvas.</p>
            <p role="status" aria-live="polite" aria-atomic="true">{map.summary}</p>
            <p className="text-text-muted">Node numbers identify entries in this view, not execution order.
                {preview && ' Resource names use the imported node labels; the open Portfolio is not used to resolve them.'}</p>
            {map.nodes.length === 0 && <p>This map has no nodes.</p>}
            {map.nodes.map(node => <section key={node.id} aria-labelledby={nodeId(node.number)} className="border border-app-border rounded p-4 space-y-2">
                <h3 id={nodeId(node.number)} tabIndex={-1} className="scroll-mt-4 font-bold break-words focus:outline focus:outline-2 focus:outline-accent-primary">{node.title}</h3>
                {node.label.length > 100 && <p className="whitespace-pre-wrap break-words">{node.label}</p>}
                {node.selected && <p>Selected node</p>}
                {node.lane && <p>Division: {node.lane}</p>}
                {node.row && <p>Row: {node.row}</p>}
                {node.column && <p>Column: {node.column}</p>}
                {node.event && <p>Event: {node.event}</p>}
                {node.hasDrilldown && <p>Has a drilldown reference. Close Read map to navigate using the process tree or node menu.</p>}
                <h4 className="font-medium">Incoming connections ({node.incoming.length})</h4>
                {node.incoming.length ? <ul className="space-y-2">{node.incoming.map(connection)}</ul> : <p>None</p>}
                <h4 className="font-medium">Outgoing connections ({node.outgoing.length})</h4>
                {node.outgoing.length ? <ul className="space-y-2">{node.outgoing.map(connection)}</ul> : <p>None</p>}
            </section>)}
            {map.connections.some(edge => !edge.source || !edge.target) && <section aria-label="Connections with missing nodes">
                <h3 className="font-bold">Connections with missing nodes</h3>
                <ul>{map.connections.flatMap((edge, index) => !edge.source || !edge.target ? [connection(index)] : [])}</ul>
            </section>}
        </div>
    </AxiomDialog>, document.body);
}
