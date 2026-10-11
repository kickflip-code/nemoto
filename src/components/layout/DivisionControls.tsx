import { Columns3, Rows3 } from 'lucide-react';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { divisionLanes, divisionSettings } from '../../lib/canvasDivision';
import { AxiomDockButton } from '../ui';
import CanvasControlHint from './CanvasControlHint';

export default function DivisionControls({ preview = false }: { preview?: boolean }) {
    const { graph, setDivisionVisible, addSwimlane } = useCanvasStore();
    const settings = divisionSettings(graph);
    return <div role="group" aria-label="Division" className="flex items-center gap-1">
        {(['column', 'row'] as const).map(axis => {
            const column = axis === 'column';
            const label = column ? 'Columns' : 'Rows';
            const visible = column ? settings.columnsVisible : settings.rowsVisible;
            const lanes = divisionLanes(graph, axis);
            const active = visible && lanes.length > 0;
            return <CanvasControlHint key={axis} text={`${active ? 'Hide' : 'Show'} ${label.toLowerCase()}`}>
                <AxiomDockButton id={`add-division-${axis}`} label={label} active={active} onClick={() => {
                    if (preview) return;
                    if (!lanes.length) addSwimlane(`${column ? 'Column' : 'Row'} 1`, column ? 'gray' : 'blue', axis);
                    else setDivisionVisible(axis, !visible);
                }}>{column ? <Columns3 size={19} /> : <Rows3 size={19} />}</AxiomDockButton>
            </CanvasControlHint>;
        })}
    </div>;
}
