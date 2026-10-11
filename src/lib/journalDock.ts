export type JournalDock = 'bottom' | 'left';

/** Keep the three-column journal usable and preserve meaningful canvas space. */
export const JOURNAL_SIDE_DOCK_MIN_VIEWPORT_WIDTH = 2200;

export function resolveJournalDock(
    preference: JournalDock,
    viewportWidth: number,
    designerActive: boolean,
): JournalDock {
    return preference === 'left'
        && designerActive
        && viewportWidth >= JOURNAL_SIDE_DOCK_MIN_VIEWPORT_WIDTH
        ? 'left'
        : 'bottom';
}
