export interface NodeBounds {
    position: { x: number; y: number };
    width?: number | null;
    height?: number | null;
}

export interface SmartHandlesResult {
    sourceHandleId: string;
    targetHandleId: string;
}

/**
 * Calculates optimal source and target handles based on relative geometric positions.
 * - Horizontal flow (right): s-right -> t-left
 * - Horizontal flow (left): s-left -> t-right
 * - Vertical flow (down): s-bottom -> t-top
 * - Vertical flow (up): s-top -> t-bottom
 */
export function getSmartHandles(
    source: NodeBounds,
    target: NodeBounds
): SmartHandlesResult {
    const sw = source.width ?? 160;
    const sh = source.height ?? 80;
    const tw = target.width ?? 160;
    const th = target.height ?? 80;

    const sourceCenter = {
        x: source.position.x + sw / 2,
        y: source.position.y + sh / 2,
    };
    const targetCenter = {
        x: target.position.x + tw / 2,
        y: target.position.y + th / 2,
    };

    const dx = targetCenter.x - sourceCenter.x;
    const dy = targetCenter.y - sourceCenter.y;

    // Check dominant direction
    if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx >= 0) {
            // Target is to the right
            return {
                sourceHandleId: 's-right',
                targetHandleId: 't-left',
            };
        } else {
            // Target is to the left
            return {
                sourceHandleId: 's-left',
                targetHandleId: 't-right',
            };
        }
    } else {
        // Predominantly vertical
        if (dy >= 0) {
            // Target is below
            return {
                sourceHandleId: 's-bottom',
                targetHandleId: 't-top',
            };
        } else {
            // Target is above
            return {
                sourceHandleId: 's-top',
                targetHandleId: 't-bottom',
            };
        }
    }
}
