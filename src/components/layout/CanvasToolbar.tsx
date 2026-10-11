import CanvasControlHint from './CanvasControlHint';
import { Grid, Maximize, Minus, Plus, List, Paperclip } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useReactFlow, useStore } from 'reactflow';
import BreadcrumbNav from './BreadcrumbNav';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { AxiomToolbar, AxiomToolbarButton, AxiomToolbarGroup } from '../ui';
import { getMotionDurationMs, motionDurationMs } from '../../lib/motion';
const ReadMapDialog = lazy(() => import('../canvas/ReadMapDialog'));

export default function CanvasToolbar() {
    const [reading, setReading] = useState(false);
    const zoom = useStore(state => state.transform[2]);
    const { zoomIn, zoomOut } = useReactFlow();
    const gridVisible = useSettingsStore(state => state.canvasGridVisible);
    const setGridVisible = useSettingsStore(state => state.setCanvasGridVisible);
    const linksVisible = useSettingsStore(state => state.canvasLinksVisible);
    const setLinksVisible = useSettingsStore(state => state.setCanvasLinksVisible);
    const isPreview = useCanvasStore(state => !!state.previewGraph);

    return (
        <>
        <AxiomToolbar aria-label="Canvas view controls" className="min-h-10 border-b flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1 shrink-0 z-20 backdrop-blur-sm">

            {/* Left: Drill-down Breadcrumbs */}
            <div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs">
                {isPreview ? <span className="text-text-muted">Imported process · Read-only</span> : <BreadcrumbNav />}
            </div>



            {/* Right: View Controls */}
            <div className="flex shrink-0 items-center gap-2">
                <AxiomToolbarGroup aria-label="Zoom controls" className="flex items-center gap-1 border-r pr-2">
                    <ViewButton
                        onClick={() => zoomOut({ duration: getMotionDurationMs(motionDurationMs.base) })}
                        label="Zoom out"
                    >
                        <Minus size={14} />
                    </ViewButton>
                    <output aria-label="Zoom level" className="min-w-[3rem] text-center text-xs tabular-nums text-text-muted">{Math.round(zoom * 100)}%</output>
                    <ViewButton
                        onClick={() => zoomIn({ duration: getMotionDurationMs(motionDurationMs.base) })}
                        label="Zoom in"
                    >
                        <Plus size={14} />
                    </ViewButton>
                <FitViewButton />
                </AxiomToolbarGroup>
                <AxiomToolbarGroup aria-label="Canvas display" className="flex items-center">
                    <ViewButton label="Read map" onClick={() => setReading(true)}
>
                        <List size={14} />
                    </ViewButton>
                    <ViewButton label="Show linked content" active={linksVisible}
                        title={linksVisible ? 'Hide resource and Journal indicators' : 'Show resource and Journal indicators'}
                        onClick={() => setLinksVisible(!linksVisible)}>
                        <Paperclip size={14} />
                    </ViewButton>
                    <ViewButton label="Toggle Grid" active={gridVisible}
                        title={gridVisible ? 'Hide grid (snapping stays on)' : 'Show grid (snapping stays on)'}
                        onClick={() => setGridVisible(!gridVisible)}>
                        <Grid size={14} />
                    </ViewButton>
                </AxiomToolbarGroup>
            </div>
        </AxiomToolbar>
        {reading && <Suspense fallback={<span role="status" className="sr-only">Opening Read map…</span>}><ReadMapDialog onClose={() => setReading(false)} /></Suspense>}
        </>
    );
}

function FitViewButton() {
    const { fitView } = useReactFlow();
    const handleFitView = () => fitView({ duration: getMotionDurationMs(motionDurationMs.camera), padding: 0.2 });

    return (
        <ViewButton
            onClick={handleFitView}
            label="Fit View"
        >
            <Maximize size={14} />
        </ViewButton>
    );
}

function ViewButton(props: React.ComponentProps<typeof AxiomToolbarButton>) {
    return <CanvasControlHint text={props.title || props.label} placement="bottom"><AxiomToolbarButton {...props} /></CanvasControlHint>;
}
