import type { Position, EdgeRoutingMode } from '../types';
import { getDynamicRoutingPoints, normalizeRoutingMargin, resolveRoutingNodeSize, type RoutingNodeBounds } from './edgeRouting';

export interface RouteHandles {
    sourceX: number; sourceY: number; targetX: number; targetY: number;
    sourcePosition: string; targetPosition: string;
}
export interface RouteData {
    routingMode?: EdgeRoutingMode | null;
    routingCorridor?: number | null;
    routingMargin?: number | null;
    routingPoints?: Position[] | null;
    routingManual?: boolean;
    routingNodes?: RoutingNodeBounds[];
}
const PAD = 24;
export function simplifyRoute(points: Position[]): Position[] {
    const result: Position[] = [];
    for (const point of points) {
        const last = result[result.length - 1];
        if (last && last.x === point.x && last.y === point.y) continue;
        const before = result[result.length - 2];
        if (before && last && ((before.x === last.x && last.x === point.x && (last.y-before.y)*(point.y-last.y) >= 0)
            || (before.y === last.y && last.y === point.y && (last.x-before.x)*(point.x-last.x) >= 0))) result.pop();
        result.push(point);
    }
    return result;
}
function stub(point: Position, side: string): Position {
    return { x: point.x + (side === 'right' ? PAD : side === 'left' ? -PAD : 0),
        y: point.y + (side === 'bottom' ? PAD : side === 'top' ? -PAD : 0) };
}
const horizontal = (side: string) => side === 'left' || side === 'right';

/** Manual bends stay in canvas coordinates. Orthogonal endpoint leads follow the nodes. */
export function manualRoute(handles: RouteHandles, bends: Position[]): Position[] {
    const source = { x: handles.sourceX, y: handles.sourceY };
    const target = { x: handles.targetX, y: handles.targetY };
    if (!bends.length) return [source, target];
    const a = stub(source, handles.sourcePosition), b = stub(target, handles.targetPosition);
    const first = bends[0], last = bends[bends.length - 1];
    return simplifyRoute([source, a,
        horizontal(handles.sourcePosition) ? { x: a.x, y: first.y } : { x: first.x, y: a.y },
        ...bends,
        horizontal(handles.targetPosition) ? { x: b.x, y: last.y } : { x: last.x, y: b.y }, b, target]);
}

/** Drag only internal orthogonal segments; endpoint handles remain attached. */
export function moveRouteSegment(points: Position[], index: number, coordinate: number): Position[] {
    const result = points.map(point => ({ ...point }));
    if (index < 1 || index >= points.length - 2 || !Number.isFinite(coordinate)) return result;
    const a = result[index], b = result[index + 1];
    if (a.x === b.x) a.x = b.x = coordinate;
    else if (a.y === b.y) a.y = b.y = coordinate;
    return result;
}

/** Rectilinear visibility grid, constrained to visit the user's chosen outside corridor.
 * Deterministic costs prefer short paths with few bends. Auto is deliberately unchanged.
 * Work is bounded for pathological imports; callers show when no safe route was found.
 */
export function outsideRoute(handles: RouteHandles, data: RouteData): Position[] | null {
    const mode = data.routingMode;
    if (!mode || mode === 'auto' || !Number.isFinite(data.routingCorridor)) return null;
    const source = { x: handles.sourceX, y: handles.sourceY }, target = { x: handles.targetX, y: handles.targetY };
    const a = stub(source, handles.sourcePosition), b = stub(target, handles.targetPosition);
    const rectangles = (data.routingNodes ?? []).filter(node => node.type !== 'group' && node.type !== 'swimlane')
        .filter(node => Number.isFinite(node.position.x) && Number.isFinite(node.position.y)).map(node => {
            const size = resolveRoutingNodeSize(node);
            return { l: node.position.x-PAD, r: node.position.x+size.width+PAD,
                t: node.position.y-PAD, b: node.position.y+size.height+PAD };
        });
    const clear = (p: Position, q: Position) => !rectangles.some(r => p.x === q.x
        ? p.x > r.l && p.x < r.r && Math.max(p.y,q.y) > r.t && Math.min(p.y,q.y) < r.b
        : p.y > r.t && p.y < r.b && Math.max(p.x,q.x) > r.l && Math.min(p.x,q.x) < r.r);
    const direct = getDynamicRoutingPoints(mode, data.routingCorridor, a.x, a.y, b.x, b.y)!;
    const expectedSide = mode === 'outside-right' ? 'right' : mode === 'outside-left' ? 'left' : mode === 'above' ? 'top' : 'bottom';
    const simple = [a,...direct,b];
    if (handles.sourcePosition === expectedSide && handles.targetPosition === expectedSide
        && simple.slice(1).every((point,index)=>clear(simple[index],point))) {
        return simplifyRoute([source,...simple,target]);
    }
    const verticalCorridor = mode === 'outside-right' || mode === 'outside-left';
    const corridor = data.routingCorridor!;
    const margin = normalizeRoutingMargin(data.routingMargin);
    const xs = [...new Set([a.x,b.x,...rectangles.flatMap(r=>[r.l,r.r]),
        ...(verticalCorridor ? [corridor] : [])])].sort((x,y)=>x-y);
    const ys = [...new Set([a.y,b.y,...rectangles.flatMap(r=>[r.t,r.b]),
        ...(!verticalCorridor ? [corridor] : [])])].sort((x,y)=>x-y);
    // Include outer clearance on the perpendicular axis as a stable escape route.
    if (verticalCorridor) { ys.unshift((ys[0] ?? 0)-margin); ys.push(ys[ys.length-1]+margin); }
    else { xs.unshift((xs[0] ?? 0)-margin); xs.push(xs[xs.length-1]+margin); }
    if (xs.length*ys.length > 40000) return null;
    const width = xs.length;
    const at = (cell: number): Position => ({ x: xs[cell%width], y: ys[Math.floor(cell/width)] });
    const visits = (p: Position) => verticalCorridor ? p.x === corridor : p.y === corridor;
    const start = ys.indexOf(a.y)*width+xs.indexOf(a.x), end = ys.indexOf(b.y)*width+xs.indexOf(b.x);
    // State encodes cell, incoming axis and whether the required corridor was visited.
    const encode = (cell:number, axis:number, via:boolean) => cell*4+axis*2+Number(via);
    const initial = encode(start, horizontal(handles.sourcePosition) ? 0 : 1, false);
    const costs = new Map<number,number>([[initial,0]]), previous = new Map<number,number>();
    const heap: { key:number; score:number; cost:number }[] = [];
    const push = (entry: typeof heap[number]) => {
        heap.push(entry); let i=heap.length-1;
        while(i>0) { const parent=(i-1)>>1; if(heap[parent].score<=entry.score) break; heap[i]=heap[parent]; i=parent; }
        heap[i]=entry;
    };
    const pop = () => {
        const first=heap[0], last=heap.pop()!;
        if(heap.length) { let i=0; while(i*2+1<heap.length) { let child=i*2+1;
            if(child+1<heap.length && heap[child+1].score<heap[child].score) child++;
            if(heap[child].score>=last.score) break; heap[i]=heap[child]; i=child;
        } heap[i]=last; } return first;
    };
    push({key:initial, score:0, cost:0});
    let explored=0;
    while(heap.length && explored++<160000) {
        const current=pop(); if(current.cost !== costs.get(current.key)) continue;
        const cell=Math.floor(current.key/4), axis=Math.floor(current.key%4/2), via=!!(current.key%2), p=at(cell);
        if(cell===end && via) {
            const path: Position[]=[]; let key: number|undefined=current.key;
            while(key!==undefined) { path.push(at(Math.floor(key/4))); key=previous.get(key); }
            return simplifyRoute([source,...path.reverse(),target]);
        }
        const x=cell%width, y=Math.floor(cell/width);
        for(const next of [x>0?cell-1:-1,x+1<width?cell+1:-1,y>0?cell-width:-1,y+1<ys.length?cell+width:-1]) {
            if(next<0) continue; const q=at(next); if(!clear(p,q)) continue;
            const nextAxis=p.y===q.y?0:1, nextVia=via||(visits(p)&&visits(q)), key=encode(next,nextAxis,nextVia);
            const cost=current.cost+Math.abs(p.x-q.x)+Math.abs(p.y-q.y)+(axis!==nextAxis?40:0)+(next===end && nextAxis!==(horizontal(handles.targetPosition)?0:1)?40:0);
            if(cost>=(costs.get(key)??Infinity)) continue;
            costs.set(key,cost); previous.set(key,current.key);
            push({key,cost,score:cost+Math.abs(q.x-b.x)+Math.abs(q.y-b.y)});
        }
    }
    return null;
}

export function resolveEdgeRoute(handles: RouteHandles, data: RouteData): { points: Position[] | null; blocked: boolean } {
    const source={x:handles.sourceX,y:handles.sourceY}, target={x:handles.targetX,y:handles.targetY};
    if(data.routingPoints?.length) return { points: data.routingManual ? manualRoute(handles,data.routingPoints)
        : [source,...data.routingPoints,target], blocked:false };
    if(!data.routingMode || data.routingMode==='auto') return {points:null,blocked:false};
    const points=outsideRoute(handles,data);
    const fallback=getDynamicRoutingPoints(data.routingMode,data.routingCorridor,source.x,source.y,target.x,target.y);
    return { points: points ?? (fallback ? [source,...fallback,target] : null), blocked:!points };
}
