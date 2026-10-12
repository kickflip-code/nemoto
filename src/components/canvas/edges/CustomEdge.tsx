import React from 'react';
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getSmoothStepPath, getBezierPath, getStraightPath } from 'reactflow';
import clsx from 'clsx';
import EdgeSegmentControls from './EdgeSegmentControls';
import type { Position as CanvasPosition } from '../../../types';
import { getRoutedEdgePath } from '../../../lib/edgeRouting';
import { resolveEdgeRoute } from '../../../lib/orthogonalRouting';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import { useUIStore } from '../../../stores/useUIStore';

export default function CustomEdge(props: EdgeProps) {
    const {
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        style = {},
        markerEnd,
        label,
        selected,
        data,
    } = props;

    // Extract custom properties from data (CanvasEdge compatible)
    const labelPosition = data?.labelPosition ?? 0.5;
    const labelOrientation = data?.labelOrientation ?? 'horizontal';
    const pathType = data?.pathType ?? 'default';
    const labelSize = data?.labelSize ?? 'sm';
    const labelColor = data?.labelColor;
    const isWhiteLabel = Boolean(
        labelColor && (
            labelColor === 'white' ||
            labelColor === '#e4e4e7' ||
            labelColor.toLowerCase() === '#ffffff' ||
            labelColor.includes('palette-white')
        )
    );

    const pathParams = {
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    };

    let pathResult: [string, number, number, number, number];

    // Durable absolute bends take precedence; semantic corridors follow live handles.
    const routingOptions = { cornerRadius: pathType === 'smoothstep' ? 5 : 0 };
    const [dragPoints, setDragPoints] = React.useState<CanvasPosition[] | null>(null);
    React.useEffect(() => { setDragPoints(null); }, [data, sourceX, sourceY, targetX, targetY, selected]);
    const route = React.useMemo(() => resolveEdgeRoute(pathParams, data ?? {}),
        [data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);
    const visiblePoints = dragPoints ?? route.points;
    const orthogonal = !!visiblePoints && visiblePoints.slice(1).every((point,index)=>
        point.x === visiblePoints[index].x || point.y === visiblePoints[index].y);
    const routedPath = getRoutedEdgePath(sourceX, sourceY, targetX, targetY, visiblePoints?.slice(1,-1), routingOptions);
    if (routedPath) {
        pathResult = routedPath;
    } else switch (pathType) {
        case 'smoothstep':
            pathResult = getSmoothStepPath(pathParams);
            break;
        case 'step':
            pathResult = getSmoothStepPath({ ...pathParams, borderRadius: 0 });
            break;
        case 'straight':
            pathResult = getStraightPath(pathParams);
            break;
        case 'default':
        default:
            pathResult = getBezierPath(pathParams);
            break;
    }

    const [edgePath, labelX, labelY] = pathResult;

    const pathRef = React.useRef<SVGPathElement>(null);
    const [labelCoords, setLabelCoords] = React.useState({ x: labelX, y: labelY });

    React.useLayoutEffect(() => {
        if (!pathRef.current) return;

        // Optimization: Use React Flow's exact calculation if 0.5 to guarantee pixel-perfect default alignment
        if (labelPosition === 0.5) {
            setLabelCoords({ x: labelX, y: labelY });
            return;
        }

        try {
            const totalLength = pathRef.current.getTotalLength();
            const targetLength = totalLength * labelPosition;
            const point = pathRef.current.getPointAtLength(targetLength);
            setLabelCoords({ x: point.x, y: point.y });
        } catch (e) {
            // Fallback for edge cases where DOM might not be fully ready or path is invalid
            setLabelCoords({ x: labelX, y: labelY });
        }
    }, [edgePath, labelPosition, labelX, labelY]);

    const onLabelClick = (evt: React.MouseEvent) => {
        evt.stopPropagation();
        // Labels deliberately use nodrag, so pointer capture preserves their
        // focus. A non-editable label click still needs canvas keyboard ownership.
        evt.currentTarget.closest<HTMLElement>('.nemoto-process-canvas')?.focus({ preventScroll: true });
        const { selectElements, selectedNodeIds, selectedEdgeIds } = useCanvasStore.getState();
        const isMulti = evt.ctrlKey || evt.metaKey;

        if (isMulti) {
            const isAlreadySelected = selectedEdgeIds.includes(props.id);
            const nextEdges = isAlreadySelected
                ? selectedEdgeIds.filter(id => id !== props.id)
                : [...selectedEdgeIds, props.id];
            selectElements(selectedNodeIds, nextEdges);
        } else {
            selectElements([], [props.id]);
        }

        // Ensure UI store knows to open the inspector
        const { openInspector, selectAsset } = useUIStore.getState();
        selectAsset(null); // Clear asset selection just like canvas does
        openInspector();
    };

    // Styling logic for labels
    const sizeClass = labelSize === 'lg' ? 'text-sm px-3 py-1' :
        labelSize === 'md' ? 'text-xs px-2.5 py-0.5' :
            'text-[10px] px-2 py-0.5';

    return (
        <>
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
            {route.blocked && <EdgeLabelRenderer><span className="nodrag nopan" role="status"
                style={{position:'absolute',left:labelX,top:labelY,pointerEvents:'all',background:'var(--color-app-surface)',padding:4}}
                title="No safe outside route was found. Move overlapping nodes or adjust the route manually.">⚠ Route blocked</span></EdgeLabelRenderer>}
            {selected && !useCanvasStore.getState().previewGraph && visiblePoints && orthogonal &&
                <EdgeSegmentControls id={props.id} points={visiblePoints} onPreview={setDragPoints} />}
            {selected && !useCanvasStore.getState().previewGraph && (!visiblePoints || !orthogonal) &&
                <EdgeLabelRenderer><button type="button" className="nodrag nopan nemoto-button"
                    style={{position:'absolute',left:labelX,top:labelY+24,pointerEvents:'all'}}
                    onClick={event=>{
                        event.stopPropagation();
                        const rigid = getSmoothStepPath({...pathParams,borderRadius:0})[0];
                        const points = [...rigid.matchAll(/[ML]\s*(-?[\d.e+]+)[ ,]+(-?[\d.e+]+)/gi)]
                            .map(match=>({x:Number(match[1]),y:Number(match[2])}));
                        if(points.length>2) useCanvasStore.getState().updateEdge(props.id,{routingPoints:points.slice(1,-1),routingManual:true});
                    }}>Adjust route</button></EdgeLabelRenderer>}
            {/* Hidden path strictly used for DOM-based getPointAtLength measurement */}
            <path ref={pathRef} d={edgePath} style={{ opacity: 0, pointerEvents: 'none' }} />
            {label && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: 'absolute',
                            transform: `translate(-50%, -50%) translate(${labelCoords.x}px,${labelCoords.y}px) ${labelOrientation === 'vertical' ? 'rotate(90deg)' : ''}`,
                            pointerEvents: 'all',
                        }}
                        className="nodrag nopan"
                    >
                        {/* Pill Label */}
                        <div
                            onClick={onLabelClick}
                            className={clsx(
                                "custom-edge-label cursor-pointer rounded-md font-medium tracking-wide transition-all border",
                                sizeClass,
                                selected
                                    ? "bg-app-surface border-accent-primary shadow-[0_0_10px_var(--color-accent-primary-glow,rgba(109,93,252,0.3))] font-semibold"
                                    : "bg-app-surface/90 border-app-border hover:border-text-faint shadow-xs backdrop-blur-md",
                                !labelColor && selected && "text-accent-primary",
                                !labelColor && !selected && "text-text-main hover:text-accent-primary"
                            )}
                            style={{
                                borderColor: selected ? undefined : 'var(--color-control-border, var(--color-app-border))',
                                ...(labelColor ? { color: isWhiteLabel ? 'var(--palette-white-text, var(--color-text-main))' : labelColor } : {})
                            }}
                        >
                            {label}
                        </div>
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
}
