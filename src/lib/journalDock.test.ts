import { describe, expect, it } from 'vitest';
import {
    JOURNAL_SIDE_DOCK_MIN_VIEWPORT_WIDTH,
    resolveJournalDock,
} from './journalDock';

describe('journal dock resolution', () => {
    it('keeps bottom as the default layout', () => {
        expect(resolveJournalDock('bottom', 3440, true)).toBe('bottom');
    });

    it('uses the left dock only in a sufficiently wide designer workspace', () => {
        expect(resolveJournalDock('left', JOURNAL_SIDE_DOCK_MIN_VIEWPORT_WIDTH, true)).toBe('left');
        expect(resolveJournalDock('left', JOURNAL_SIDE_DOCK_MIN_VIEWPORT_WIDTH - 1, true)).toBe('bottom');
        expect(resolveJournalDock('left', 3440, false)).toBe('bottom');
    });
});
