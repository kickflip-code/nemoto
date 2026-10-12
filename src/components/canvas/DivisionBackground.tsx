import { useRef, useState, type CSSProperties } from 'react';
import { DivisionHeading } from './DivisionHeading';
import { Plus } from 'lucide-react';
import type { CanvasGraph } from '../../types';
import { divisionBounds, divisionLanes, divisionSettings, type DivisionAxis } from '../../lib/canvasDivision';
import { getPaletteColor } from '../../constants/palette';

/** Shared theme-aware geometry for editor and standalone HTML. No content is moved. */
export function DivisionBackground({ graph: sourceGraph, onSelect, onAdd, onRename, onResize, getZoom }: {
    graph: CanvasGraph; onSelect?: (id: string) => void; onAdd?: (axis: DivisionAxis) => void;
    onRename?: (id: string, name: string) => void; onResize?: (id: string, axis: DivisionAxis, size: number) => void; getZoom?: () => number;
}) {
    const [preview, setPreview] = useState<{ id: string; axis: DivisionAxis; size: number } | null>(null);
    const drag = useRef<{ id: string; axis: DivisionAxis; start: number; size: number; zoom: number; next: number } | null>(null);
    const graph = preview ? { ...sourceGraph, swimlanes: sourceGraph.swimlanes.map(lane => lane.id === preview.id
        ? { ...lane, [preview.axis === 'column' ? 'width' : 'height']: preview.size } : lane) } : sourceGraph;
    const settings = divisionSettings(graph);
    const bounds = divisionBounds(graph);
    const columns = divisionLanes(graph, 'column');
    const contentWidth = Math.max(640, columns.reduce((sum, lane) => sum + (lane.width ?? 300), 0), ...graph.nodes.map(node => node.position.x + (node.width ?? 224) + 32));
    return <div className="relative pointer-events-none" style={{ width: bounds.width + (onAdd && settings.columnsVisible && columns.length ? 44 : 0), height: bounds.height + (onAdd && settings.rowsVisible && divisionLanes(graph, 'row').length ? 48 : 0) }}>
        <div style={{ position: 'absolute', left: 0, top: 0 }}>
            {(['row', 'column'] as const).map(axis => {
                if (!(axis === 'row' ? settings.rowsVisible : settings.columnsVisible)) return null;
                let offset = 0;
                const column = axis === 'column';
                const headings = divisionLanes(graph, axis).map((lane, index) => {
                    const size = column ? lane.width ?? 300 : lane.height;
                    const start = offset;
                    offset += size;
                    const style = {
                        left: column ? start : 10, top: column ? -48 : start + 7,
                        width: column ? size : undefined, maxWidth: column ? undefined : Math.max(120, (columns[0]?.width ?? 320) - 24),
                        height: column ? 48 : 26, '--division-accent': getPaletteColor(lane.color),
                    } as CSSProperties;
                    const className = `nemoto-division-heading ${column ? 'nemoto-division-column bg-app-surface shadow-soft-down' : 'nemoto-division-row'}${onSelect ? ' nodrag nopan pointer-events-auto' : ''}`;
                    const label = <><span className="nemoto-division-accent" aria-hidden="true" /><span className="nemoto-division-label">{lane.label}</span></>;
                    return <div key={lane.id}>
                        {!column && index % 2 === 0 && <div className="nemoto-division-band" style={{ top: start, width: contentWidth, height: size }} />}
                        <div className={`nemoto-division-line ${column ? 'is-column' : 'is-row'}`} style={{ left: column ? offset : 0, top: column ? 0 : offset,
                            width: column ? 1 : contentWidth, height: column ? Math.max(1000, bounds.height, ...graph.nodes.map(node => node.position.y + (node.height ?? 96) + 32)) : 1 }} />
                        {onSelect ? <DivisionHeading label={lane.label} kind={column ? 'column' : 'row'} style={style} className={className}
                            onSelect={() => onSelect(lane.id)} onRename={onRename ? name => onRename(lane.id, name) : undefined} />
                            : <div style={style} className={className}>{label}</div>}
                        {onResize && <div role="separator" tabIndex={0} aria-label={`Resize ${column ? 'width' : 'height'}: ${lane.label}`}
                            aria-orientation={column ? 'vertical' : 'horizontal'} aria-valuemin={32} aria-valuemax={Math.max(10000, Math.round(size))} aria-valuenow={Math.round(size)} aria-valuetext={`${Math.round(size)} pixels`}
                            className={`nemoto-division-resizer nodrag nopan pointer-events-auto ${column ? 'is-column' : 'is-row'}`}
                            style={column ? { left: offset - 4, top: -48, width: 8, height: Math.max(48, bounds.height) }
                                : { left: 0, top: offset - 4, width: contentWidth, height: 8 }}
                            title={`Drag to resize ${column ? 'width' : 'height'}. Arrow keys resize by 16 px.`}
                            onClick={e => e.stopPropagation()}
                            onPointerDown={e => {
                                if (e.button !== 0) return;
                                e.preventDefault(); e.stopPropagation(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
                                drag.current = { id: lane.id, axis, start: column ? e.clientX : e.clientY, size, zoom: getZoom?.() || 1, next: size };
                            }}
                            onPointerMove={e => {
                                const d = drag.current; if (!d || d.id !== lane.id) return;
                                d.next = Math.max(32, Math.round(d.size + ((column ? e.clientX : e.clientY) - d.start) / d.zoom));
                                setPreview({ id: lane.id, axis, size: d.next });
                            }}
                            onPointerUp={e => {
                                const d = drag.current; if (!d || d.id !== lane.id) return;
                                drag.current = null; setPreview(null);
                                if (d.next !== d.size) onResize(lane.id, axis, d.next);
                                e.currentTarget.releasePointerCapture(e.pointerId);
                            }}
                            onLostPointerCapture={() => { drag.current = null; setPreview(null); }}
                            onPointerCancel={() => { drag.current = null; setPreview(null); }}
                            onKeyDown={e => {
                                if (e.key === 'Escape') { drag.current = null; setPreview(null); e.stopPropagation(); return; }
                                const delta = e.key === (column ? 'ArrowRight' : 'ArrowDown') ? 16 : e.key === (column ? 'ArrowLeft' : 'ArrowUp') ? -16 : 0;
                                if (delta) { e.preventDefault(); e.stopPropagation(); onResize(lane.id, axis, Math.max(32, size + delta)); }
                            }} />}
                    </div>;
                });
                return <div key={axis}>{headings}{onAdd && headings.length > 0 && <button type="button"
                    className="nemoto-division-add nodrag nopan pointer-events-auto" aria-label={`Add ${column ? 'column' : 'row'}`}
                    title={`Add ${column ? 'column' : 'row'}`} style={{ left: column ? offset + 4 : 8, top: column ? -48 : offset + 6 }}
                    onClick={event => { event.stopPropagation(); onAdd(axis); }}><Plus size={15} /></button>}</div>;
            })}
        </div>
    </div>;
}
