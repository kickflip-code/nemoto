import { memo, useRef, useState, useLayoutEffect } from 'react';
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getSmoothStepPath, getBezierPath, getStraightPath } from 'reactflow';
import clsx from 'clsx';
import { getRoutedEdgePath } from '../../lib/edgeRouting';
import { resolveEdgeRoute } from '../../lib/orthogonalRouting';

/**
 * HTML Export Viewer Custom Edge
 * Replicates the main application's edge rendering logic for perfect visual parity.
 */
export const ViewerCustomEdge = memo((props: EdgeProps) => {
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

    const labelPosition = data?.labelPosition ?? 0.5;
    const labelOrientation = data?.labelOrientation ?? 'horizontal';
    const pathType = data?.pathType ?? 'default';
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
    const route = resolveEdgeRoute(pathParams, data ?? {});
    const routedPath = getRoutedEdgePath(sourceX, sourceY, targetX, targetY, route.points?.slice(1,-1), routingOptions);
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
    const pathRef = useRef<SVGPathElement>(null);
    const [labelCoords, setLabelCoords] = useState({ x: labelX, y: labelY });

    // Replicate high-fidelity label positioning logic
    useLayoutEffect(() => {
        if (!pathRef.current) return;

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
            setLabelCoords({ x: labelX, y: labelY });
        }
    }, [edgePath, labelPosition, labelX, labelY]);

    return (
        <>
            <BaseEdge
                path={edgePath}
                markerEnd={markerEnd}
                style={{
                    ...style,
                    stroke: selected ? 'var(--color-accent-primary)' : style.stroke,
                    strokeWidth: selected ? 2 : style.strokeWidth,
                    transition: 'all 0.3s ease'
                }}
            />
            {route.blocked && <EdgeLabelRenderer><span role="status"
                style={{position:'absolute',left:labelX,top:labelY,background:'var(--color-app-surface)',padding:4}}
                title="No safe outside route was found. Adjust this map in Nemoto.">⚠ Route blocked</span></EdgeLabelRenderer>}
            {/* Measurement path (hidden) */}
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
                        <div
                            className={clsx(
                                "custom-edge-label px-2 py-0.5 rounded-md text-[10px] font-medium tracking-wide transition-all border",
                                "backdrop-blur-md select-none shadow-xs",
                                selected
                                    ? "bg-app-surface border-accent-primary shadow-[0_0_10px_var(--color-accent-primary-glow,rgba(109,93,252,0.3))] font-semibold"
                                    : "bg-app-surface/90 border-app-border hover:border-text-faint",
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
});
