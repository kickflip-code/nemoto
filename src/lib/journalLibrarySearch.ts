import type { JournalEntry } from '../types/journal';

const HTML_TAG_PATTERN = /<[^>]*>/g;
const NON_BREAKING_SPACE_PATTERN = /&(?:nbsp|#160);/gi;

const normalizeSearchText = (value: string): string => value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const getEntrySearchText = (entry: JournalEntry): string => normalizeSearchText(
    `${entry.title} ${entry.content
        .replace(HTML_TAG_PATTERN, ' ')
        .replace(NON_BREAKING_SPACE_PATTERN, ' ')}`,
);

/** Filter journal notes by title and rendered body text. Every search word must match. */
export function filterJournalEntries(entries: JournalEntry[], query: string): JournalEntry[] {
    const searchTerms = normalizeSearchText(query).split(' ').filter(Boolean);
    if (searchTerms.length === 0) return entries;

    return entries.filter(entry => {
        const searchableText = getEntrySearchText(entry);
        return searchTerms.every(term => searchableText.includes(term));
    });
}
