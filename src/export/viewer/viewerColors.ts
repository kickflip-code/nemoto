const VIEWER_PALETTE: Record<string, string> = {
    default: 'var(--color-app-active)',
    gray: 'var(--palette-gray, #52525b)',
    white: 'var(--palette-white, #e4e4e7)',
    blue: 'var(--palette-blue, #3b82f6)',
    green: 'var(--palette-green, #22c55e)',
    purple: 'var(--palette-purple, #a855f7)',
    orange: 'var(--palette-orange, #f97316)',
    red: 'var(--palette-red, #ef4444)',
    amber: 'var(--palette-amber, #f59e0b)',
    warning: 'var(--palette-amber, #f59e0b)',
};

export function resolveViewerColor(idOrColor: string | undefined | null): string | null {
    if (!idOrColor) return null;
    return VIEWER_PALETTE[idOrColor] || idOrColor;
}

export function withViewerColorAlpha(color: string, alphaHex: string): string {
    if (/^#[0-9a-f]{6}$/i.test(color) && /^[0-9a-f]{2}$/i.test(alphaHex)) {
        return `${color}${alphaHex}`;
    }

    const alpha = Number.parseInt(alphaHex, 16);
    const percentage = Number.isFinite(alpha) ? Math.round((alpha / 255) * 100) : 100;
    return `color-mix(in srgb, ${color} ${percentage}%, transparent)`;
}
