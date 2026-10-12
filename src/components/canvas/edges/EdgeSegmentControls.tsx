import { useEffect, useRef } from 'react';
import { EdgeLabelRenderer, useReactFlow } from 'reactflow';
import type { Position } from '../../../types';
import { moveRouteSegment } from '../../../lib/orthogonalRouting';
import { useCanvasStore } from '../../../stores/useCanvasStore';

interface Props {
    id: string; points: Position[]; onPreview: (points: Position[] | null) => void;
}

/** Local pointer preview; one durable update at release, none on cancel. */
export default function EdgeSegmentControls({ id, points, onPreview }: Props) {
    const flow = useReactFlow();
    // Keep handles available on a straight orthogonal route: dragging its middle
    // third introduces two bends while keeping both endpoint leads attached.
    const editable = points.length === 2 && (points[0].x === points[1].x || points[0].y === points[1].y)
        ? [points[0], {x:points[0].x+(points[1].x-points[0].x)/3,y:points[0].y+(points[1].y-points[0].y)/3},
            {x:points[0].x+2*(points[1].x-points[0].x)/3,y:points[0].y+2*(points[1].y-points[0].y)/3},points[1]]
        : points;
    const drag = useRef<{
        index: number; points: Position[]; graph: ReturnType<typeof useCanvasStore.getState>['graph'];
        pointerId: number; start: Position; element: HTMLButtonElement; moved: boolean;
    } | null>(null);
    const cancel = () => { drag.current = null; onPreview(null); };
    useEffect(() => {
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) {
            event.preventDefault(); event.stopPropagation(); cancel();
        } };
        window.addEventListener('keydown', key, true);
        return () => { window.removeEventListener('keydown', key, true); };
    }, [onPreview]);
    const shifted = (event: React.PointerEvent) => {
        const current = drag.current!;
        const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const p = current.points[current.index], q = current.points[current.index + 1];
        const coordinate = p.x === q.x ? p.x + position.x-current.start.x : p.y + position.y-current.start.y;
        return moveRouteSegment(current.points, current.index, Math.round(coordinate));
    };
    return <EdgeLabelRenderer>{editable.slice(1,-2).map((a, offset) => {
        const index=offset+1, b=editable[index+1];
        if ((a.x!==b.x && a.y!==b.y) || Math.hypot(a.x-b.x,a.y-b.y)<16) return null;
        return <button key={index} type="button" className="nodrag nopan nemoto-edge-segment-handle"
            aria-label={`Move connection segment ${index}`} title="Drag segment · Arrow keys move 8 px · Escape cancels"
            style={{ position:'absolute', left:(a.x+b.x)/2, top:(a.y+b.y)/2, transform:'translate(-50%, -50%)',
                width:14, height:14, borderRadius:4, border:'2px solid var(--color-accent-primary)',
                background:'var(--color-app-surface)', pointerEvents:'all', cursor:a.x===b.x?'ew-resize':'ns-resize' }}
            onClick={event=>event.stopPropagation()}
            onPointerDown={event=>{
                if(event.button!==0 || useCanvasStore.getState().previewGraph) return;
                event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
                drag.current={index,points:editable.map(p=>({...p})),graph:useCanvasStore.getState().graph,
                    pointerId:event.pointerId,start:flow.screenToFlowPosition({x:event.clientX,y:event.clientY}),
                    element:event.currentTarget,moved:false};
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event=>{
                if(!drag.current || drag.current.pointerId!==event.pointerId) return;
                if(useCanvasStore.getState().graph!==drag.current.graph) { cancel(); return; }
                drag.current.moved = true;
                onPreview(shifted(event));
            }}
            onPointerUp={event=>{
                const current=drag.current; if(!current || current.pointerId!==event.pointerId) return;
                event.stopPropagation(); const next=shifted(event);
                drag.current=null; onPreview(null);
                if(current.moved && useCanvasStore.getState().graph===current.graph && !useCanvasStore.getState().previewGraph
                    && JSON.stringify(next)!==JSON.stringify(current.points)) {
                    useCanvasStore.getState().updateEdge(id,{routingPoints:next.slice(1,-1),routingManual:true});
                }
                if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={cancel} onLostPointerCapture={()=>{if(drag.current) cancel();}}
            onKeyDown={event=>{
                const delta = a.x===b.x ? (event.key==='ArrowLeft'?-8:event.key==='ArrowRight'?8:0)
                    : (event.key==='ArrowUp'?-8:event.key==='ArrowDown'?8:0);
                if(!delta || useCanvasStore.getState().previewGraph) return;
                event.preventDefault(); event.stopPropagation();
                const next=moveRouteSegment(editable,index,(a.x===b.x?a.x:a.y)+delta);
                useCanvasStore.getState().updateEdge(id,{routingPoints:next.slice(1,-1),routingManual:true});
            }} />;
    })}</EdgeLabelRenderer>;
}
