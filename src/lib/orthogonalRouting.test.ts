import { describe, expect, it } from 'vitest';
import { getRoutingCorridor } from './edgeRouting';
import { manualRoute, moveRouteSegment, outsideRoute, resolveEdgeRoute, type RouteHandles } from './orthogonalRouting';
import type { EdgeRoutingMode, Position } from '../types';

const handles: RouteHandles = { sourceX:824,sourceY:48,targetX:224,targetY:448,sourcePosition:'right',targetPosition:'right' };
const nodes = [ {position:{x:600,y:0},width:224,height:96}, {position:{x:0,y:400},width:224,height:96},
    {position:{x:400,y:380},width:224,height:96} ];
function hits(a:Position,b:Position,n:typeof nodes[number]) {
    const {x,y}=n.position;
    return a.x===b.x ? a.x>x && a.x<x+n.width && Math.max(a.y,b.y)>y && Math.min(a.y,b.y)<y+n.height
        : a.y>y && a.y<y+n.height && Math.max(a.x,b.x)>x && Math.min(a.x,b.x)<x+n.width;
}

describe('smart outside routing',()=>{
    it.each([0,1,2,3])('avoids the intermediate node for direction %s and respects the requested side',turns=>{
        let current=structuredClone(nodes), h={...handles};
        const sides=['right','bottom','left','top'];
        const rotate=(p:Position)=>({x:-p.y,y:p.x});
        for(let turn=0;turn<turns;turn++) {
            current=current.map(n=>({position:{x:-n.position.y-n.height,y:n.position.x},width:n.height,height:n.width}));
            const a=rotate({x:h.sourceX,y:h.sourceY}), b=rotate({x:h.targetX,y:h.targetY});
            h={sourceX:a.x,sourceY:a.y,targetX:b.x,targetY:b.y,sourcePosition:sides[turn+1],targetPosition:sides[turn+1]};
        }
        const mode:EdgeRoutingMode=(['outside-right','below','outside-left','above'] as const)[turns];
        const corridor=getRoutingCorridor(mode,current,80)!;
        const points=outsideRoute(h,{routingMode:mode,routingCorridor:corridor,routingNodes:current})!;
        expect(points).not.toBeNull();
        expect(points.some(p=>turns%2===0?p.x===corridor:p.y===corridor)).toBe(true);
        points.slice(1).forEach((b,i)=>{
            const a=points[i]; expect(a.x===b.x || a.y===b.y).toBe(true);
            expect(current.some(n=>hits(a,b,n))).toBe(false);
        });
        expect(outsideRoute(h,{routingMode:mode,routingCorridor:corridor,routingNodes:[...current].reverse()})).toEqual(points);
    });
    it('keeps a simple free corridor simple and leaves Auto unchanged',()=>{
        const h={...handles,sourceX:224,sourceY:48,targetX:224,targetY:248};
        expect(outsideRoute(h,{routingMode:'outside-right',routingCorridor:304,routingNodes:[]}))
            .toEqual([{x:224,y:48},{x:304,y:48},{x:304,y:248},{x:224,y:248}]);
        expect(resolveEdgeRoute(h,{routingMode:'auto',routingNodes:nodes})).toEqual({points:null,blocked:false});
    });
    it('reports an impossible route rather than claiming obstacle avoidance succeeded',()=>{
        const result=resolveEdgeRoute(handles,{routingMode:'outside-right',routingCorridor:1000,
            routingNodes:[...nodes,{position:{x:830,y:0},width:100,height:100}]});
        expect(result.blocked).toBe(true);
    });
    it('preserves imported geometry and follows endpoint movement for manual bends',()=>{
        const bends=[{x:1000,y:48},{x:1000,y:520},{x:248,y:520},{x:248,y:448}];
        const changed={...handles,sourceY:80,targetY:430};
        const manual=manualRoute(changed,bends);
        expect(manual).toContainEqual({x:1000,y:520});
        expect(manual[0]).toEqual({x:824,y:80});
        expect(manual[manual.length-1]).toEqual({x:224,y:430});
        manual.slice(1).forEach((p,i)=>expect(p.x===manual[i].x || p.y===manual[i].y).toBe(true));
        expect(resolveEdgeRoute(changed,{routingPoints:bends}).points?.slice(1,-1)).toEqual(bends);
    });
    it('moves just an internal segment without mutating the input',()=>{
        const original=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
        expect(moveRouteSegment(original,1,160)).toEqual([{x:0,y:0},{x:160,y:0},{x:160,y:100},{x:0,y:100}]);
        expect(original[1].x).toBe(100);
        expect(moveRouteSegment(original,0,160)).toEqual(original);
    });
});
