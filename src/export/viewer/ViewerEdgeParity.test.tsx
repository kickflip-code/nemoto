import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Position, type EdgeProps } from 'reactflow';
import CustomEdge from '../../components/canvas/edges/CustomEdge';
import { ViewerCustomEdge } from './ViewerCustomEdge';
import { toFlowEdge } from '../../components/canvas/flowConfiguration';
import { toViewerEdge } from './viewerGraph';
import type { CanvasEdge } from '../../types';

vi.mock('reactflow', async importOriginal => ({
    ...await importOriginal<typeof import('reactflow')>(),
    BaseEdge: ({ path }: { path: string }) => <svg><path data-testid="drawn-edge" d={path} /></svg>,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);

it('uses the same obstacle detour and moved manual endpoints in editor and export', () => {
    const nodes = [
        {id:'a',type:'action' as const,label:'Supplier',position:{x:600,y:0}},
        {id:'b',type:'action' as const,label:'Test',position:{x:0,y:400}},
        {id:'fax',type:'action' as const,label:'Fax',position:{x:400,y:380}},
    ];
    for (const manual of [false,true]) {
        const edge:CanvasEdge={id:'return',sourceId:'a',targetId:'b',style:'solid',type:'step',routingMode:'outside-right',
            ...(manual?{routingManual:true,routingPoints:[{x:950,y:48},{x:950,y:540},{x:260,y:540},{x:260,y:448}]}:{})};
        const params={id:'return',source:'a',target:'b',sourceX:824,sourceY:manual?100:48,targetX:224,targetY:448,
            sourcePosition:Position.Right,targetPosition:Position.Right};
        render(<CustomEdge {...params} data={toFlowEdge(edge,false,nodes).data}/>);
        const editor=screen.getByTestId('drawn-edge').getAttribute('d');
        cleanup();
        render(<ViewerCustomEdge {...params} data={toViewerEdge(edge,nodes.map(n=>({x:n.position.x,y:n.position.y,w:224,h:96}))).data}/>);
        expect(screen.getByTestId('drawn-edge').getAttribute('d')).toBe(editor);
        expect(editor).not.toContain('L 224 448 L');
        cleanup();
    }
});

describe.each([['editor', CustomEdge], ['viewer', ViewerCustomEdge]] as const)('%s rendered routing', (_name, Edge) => {
    function draw(extra: Partial<CanvasEdge> = {}) {
        const edge: CanvasEdge = { id: 'return', sourceId: 'a', targetId: 'b', style: 'solid', type: 'step',
            routingMode: 'outside-right', routingMargin: 80, ...extra };
        const nodes = [
            { id: 'a', type: 'action' as const, label: 'A', position: { x: 0, y: 0 } },
            { id: 'b', type: 'action' as const, label: 'B', position: { x: 0, y: 200 } },
        ];
        const data = _name === 'editor' ? toFlowEdge(edge, false, nodes).data
            : toViewerEdge(edge, nodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y, w: 224, h: 96 }))).data;
        const props = { id: edge.id, source: 'a', target: 'b', sourceX: 224, sourceY: 48,
            targetX: 224, targetY: 248, sourcePosition: Position.Right, targetPosition: Position.Right,
            data, label: 'Return' } as EdgeProps;
        render(<Edge {...props} />);
        return screen.getByTestId('drawn-edge').getAttribute('d');
    }

    it('draws the outside corridor supplied by the graph adapter and centers its label there', () => {
        expect(draw()).toBe('M 224 48 L 304 48 L 304 248 L 224 248');
        expect(screen.getByText('Return').parentElement).toHaveStyle({ transform: 'translate(-50%, -50%) translate(304px,148px)' });
    });

    it('uses absolute bends in preference to the semantic corridor', () => {
        expect(draw({ routingPoints: [{ x: 400, y: 48 }, { x: 400, y: 248 }] }))
            .toBe('M 224 48 L 400 48 L 400 248 L 224 248');
    });

    it('retains ordinary smoothstep rendering when no route is configured', () => {
        const path = draw({ routingMode: 'auto', type: 'smoothstep' });
        expect(path).toContain('Q');
        expect(path).not.toContain('304');
    });
});
