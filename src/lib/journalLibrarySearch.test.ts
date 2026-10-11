import { describe, expect, it } from 'vitest';
import type { JournalEntry } from '../types/journal';
import { filterJournalEntries } from './journalLibrarySearch';

const entry = (id: string, title: string, content: string): JournalEntry => ({
    id,
    notebookId: 'notebook-1',
    title,
    content,
    contentFormat: 'html',
    contentVersion: 1,
    tags: [],
    linkedContext: [],
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
});

describe('journal library search', () => {
    const entries = [
        entry('one', 'Incident response', '<p><strong>Escalate</strong> urgent cases to the service owner.</p>'),
        entry('two', 'Weekly review', '<p>Review operational metrics.</p>'),
    ];

    it('matches note titles and rendered body text case-insensitively', () => {
        expect(filterJournalEntries(entries, 'INCIDENT')).toEqual([entries[0]]);
        expect(filterJournalEntries(entries, 'service owner')).toEqual([entries[0]]);
    });

    it('requires every search word to match the same note', () => {
        expect(filterJournalEntries(entries, 'urgent owner')).toEqual([entries[0]]);
        expect(filterJournalEntries(entries, 'urgent metrics')).toEqual([]);
    });

    it('does not treat HTML element names as note content', () => {
        expect(filterJournalEntries(entries, 'strong')).toEqual([]);
    });

    it('returns all notes for an empty query', () => {
        expect(filterJournalEntries(entries, '   ')).toBe(entries);
    });
});
