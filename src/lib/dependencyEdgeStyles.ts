export function getDependencyEdgeStroke(linkType: string): string {
    if (linkType === 'asset-link' || linkType === 'asset-reference' || linkType === 'process-resource') {
        return 'var(--color-accent-primary)';
    }
    if (linkType === 'reference' || linkType === 'journal-reference') {
        return 'var(--color-accent-warning)';
    }
    if (linkType === 'tag-membership' || linkType === 'tag-insight') return 'var(--color-accent-purple)';
    return 'var(--color-canvas-edge)';
}
