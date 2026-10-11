import { divisionLanes } from '../../../lib/canvasDivision';
import { memo } from 'react';
import { useReactFlow, type NodeProps } from 'reactflow';
import { DivisionBackground } from '../DivisionBackground';
import { useUIStore } from '../../../stores/useUIStore';
import { useCanvasStore } from '../../../stores/useCanvasStore';
export const SwimlaneStackNode = memo(({ data }: NodeProps) => {
    const { getZoom } = useReactFlow();
    return <DivisionBackground graph={data.graph} getZoom={getZoom}
    onRename={data.readOnly ? undefined : (id, label) => useCanvasStore.getState().updateSwimlane(id, { label })}
    onResize={data.readOnly ? undefined : (id, axis, size) => useCanvasStore.getState().updateSwimlane(id, axis === 'row' ? { height: size } : { width: size })}
    onSelect={data.readOnly ? undefined : id => {
        useCanvasStore.getState().selectElements([], []);
        useUIStore.getState().selectSwimlane(id);
    }} onAdd={data.readOnly ? undefined : axis => {
        const state = useCanvasStore.getState();
        const count = divisionLanes(state.graph, axis).length;
        state.addSwimlane(`${axis === 'row' ? 'Row' : 'Column'} ${count + 1}`, axis === 'row' ? 'blue' : 'gray', axis);
    }} />;
});
