export interface CanvasLocation {
    processId: string;
    nodePath: string[];
    portfolioGeneration: number;
}

interface SessionLocation {
    activeProcessId: string | null;
    breadcrumbStack: string[];
    portfolioGeneration: number;
}

export function canvasLocationFromSession(session: SessionLocation): CanvasLocation | null {
    return session.activeProcessId ? {
        processId: session.activeProcessId,
        nodePath: [...session.breadcrumbStack],
        portfolioGeneration: session.portfolioGeneration,
    } : null;
}

export function canvasLocationMatchesSession(location: CanvasLocation | null, session: SessionLocation): boolean {
    return !!location && location.processId === session.activeProcessId
        && location.portfolioGeneration === session.portfolioGeneration
        && location.nodePath.length === session.breadcrumbStack.length
        && location.nodePath.every((id, index) => id === session.breadcrumbStack[index]);
}
