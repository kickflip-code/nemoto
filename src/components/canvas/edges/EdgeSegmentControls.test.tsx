import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import EdgeSegmentControls from './EdgeSegmentControls';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import { decodePortfolioJson, serializePortfolioEnvelope } from '../../../lib/portfolioCodec';
import { emptyPortfolio } from '../../../stores/slices/coreSlice';
import { createSharedProcessProjection } from '../../../export/shareablePortfolio';

vi.mock('reactflow',()=>({
    EdgeLabelRenderer: ({children}:{children:React.ReactNode})=>children,
    useReactFlow: ()=>({screenToFlowPosition:({x,y}:{x:number;y:number})=>({x:x/2,y:y/2})}),
    applyNodeChanges: vi.fn(), applyEdgeChanges: vi.fn(),
}));
const points=[{x:224,y:48},{x:500,y:48},{x:500,y:248},{x:224,y:248}];
beforeEach(()=>{
    vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId=1; });
    HTMLElement.prototype.setPointerCapture=vi.fn();
    HTMLElement.prototype.hasPointerCapture=()=>true;
    HTMLElement.prototype.releasePointerCapture=vi.fn();
    useCanvasStore.getState().loadGraph({nodes:[],swimlanes:[],edges:[{id:'e',sourceId:'a',targetId:'b',style:'solid',routingMode:'outside-right'}]});
    useCanvasStore.temporal.getState().clear();
});
afterEach(()=>vi.unstubAllGlobals());

describe('segment manipulation',()=>{
    it('previews at canvas zoom then commits once and supports Undo/Redo and file/share round trips',()=>{
        const preview=vi.fn(); render(<EdgeSegmentControls id="e" points={points} onPreview={preview}/>);
        const handle=screen.getByRole('button',{name:'Move connection segment 1'});
        fireEvent.pointerDown(handle,{button:0,clientX:1000,clientY:200});
        fireEvent.pointerMove(handle,{clientX:1120,clientY:200});
        expect(preview).toHaveBeenLastCalledWith([{x:224,y:48},{x:560,y:48},{x:560,y:248},{x:224,y:248}]);
        expect(useCanvasStore.getState().graph.edges[0].routingPoints).toBeUndefined();
        fireEvent.pointerUp(handle,{clientX:1120,clientY:200});
        const edge=useCanvasStore.getState().graph.edges[0];
        expect(edge.routingPoints).toEqual([{x:560,y:48},{x:560,y:248}]);
        expect(edge.routingManual).toBe(true);
        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(1);
        act(()=>useCanvasStore.temporal.getState().undo());
        expect(useCanvasStore.getState().graph.edges[0].routingPoints).toBeUndefined();
        act(()=>useCanvasStore.temporal.getState().redo());
        expect(useCanvasStore.getState().graph.edges[0]).toEqual(edge);
        const portfolio=structuredClone(emptyPortfolio);
        portfolio.processes=[{id:'p',title:'Process',mode:'blank',createdAt:'',updatedAt:'',graph:{swimlanes:[],edges:[edge],
            nodes:['a','b'].map((id,i)=>({id,type:'action',label:id,position:{x:0,y:i*200}}))}}];
        const decoded=decodePortfolioJson(serializePortfolioEnvelope(portfolio)).portfolio;
        expect(decoded.processes[0].graph.edges[0]).toMatchObject(edge);
        expect(createSharedProcessProjection(decoded,'p',true).portfolio.processes[0].graph.edges[0]).toMatchObject(edge);
        act(()=>useCanvasStore.getState().updateEdge('e',{routingPoints:undefined,routingManual:undefined}));
        expect(useCanvasStore.getState().graph.edges[0].routingMode).toBe('outside-right');
    });
    it.each(['escape','cancel','navigation'])('does not save an interrupted drag: %s',reason=>{
        render(<EdgeSegmentControls id="e" points={points} onPreview={vi.fn()}/>);
        const handle=screen.getByRole('button',{name:'Move connection segment 1'});
        fireEvent.pointerDown(handle,{button:0,clientX:1000,clientY:200});
        fireEvent.pointerMove(handle,{clientX:1100,clientY:200});
        if(reason==='escape') fireEvent.keyDown(window,{key:'Escape'});
        if(reason==='cancel') fireEvent.pointerCancel(handle);
        if(reason==='navigation') act(()=>useCanvasStore.getState().loadGraph({nodes:[],edges:[],swimlanes:[]}));
        fireEvent.pointerUp(handle,{clientX:1100,clientY:200});
        expect(useCanvasStore.getState().graph.edges[0]?.routingPoints).toBeUndefined();
        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(0);
    });
    it('allows keyboard adjustment along the segment axis',()=>{
        render(<EdgeSegmentControls id="e" points={points} onPreview={vi.fn()}/>);
        fireEvent.keyDown(screen.getByRole('button'),{key:'ArrowRight'});
        expect(useCanvasStore.getState().graph.edges[0].routingPoints?.[0].x).toBe(508);
    });
});
