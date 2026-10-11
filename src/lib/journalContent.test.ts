import { describe, expect, it } from 'vitest';
import {
    JOURNAL_CONTENT_FORMAT,
    JOURNAL_CONTENT_VERSION,
    legacyTextToHtml,
    normalizeJournalContent,
} from './journalContent';

describe('journal content contract', () => {
    it('declares the canonical HTML contract', () => {
        expect(JOURNAL_CONTENT_FORMAT).toBe('html');
        expect(JOURNAL_CONTENT_VERSION).toBe(2);
    });

    it('converts legacy text without losing punctuation or line breaks', () => {
        expect(legacyTextToHtml('A & B\r\n<x>\n**bold**'))
            .toBe('<p>A &amp; B<br>&lt;x&gt;<br>**bold**</p>');
    });

    it('treats Markdown as legacy text rather than executable HTML', () => {
        expect(normalizeJournalContent('**bold** and [link](https://example.com)'))
            .toBe('<p>**bold** and [link](https://example.com)</p>');
    });

    it('sanitizes existing HTML while preserving journal metadata', () => {
        const normalized = normalizeJournalContent(`
            <h2 onclick="alert(1)">Title</h2>
            <script>alert(1)</script>
            <figure data-type="journal-image" data-width="75%" data-align="left" data-caption="Diagram" data-embedded-size="12">
                <img src="data:image/png;base64,AA==" alt="Diagram" onerror="alert(1)">
                <figcaption>Diagram</figcaption>
            </figure>
        `);

        expect(normalized).toContain('<h2>Title</h2>');
        expect(normalized).toContain('data-type="journal-image"');
        expect(normalized).toContain('data-width="75%"');
        expect(normalized).toContain('data-align="left"');
        expect(normalized).toContain('<figcaption>Diagram</figcaption>');
        expect(normalized).not.toMatch(/script|onclick|onerror/i);
    });

    it('returns empty content for unsupported persisted values', () => {
        expect(normalizeJournalContent(null)).toBe('');
        expect(normalizeJournalContent({ content: 'text' })).toBe('');
    });
});
