import { escapeHtml, sanitizeHtml } from './sanitize';

export const JOURNAL_CONTENT_FORMAT = 'html' as const;
export const JOURNAL_CONTENT_VERSION = 2;

const HTML_ELEMENT_PATTERN = /^\s*<\/?(?:p|h[1-3]|blockquote|pre|code|hr|br|div|figure|figcaption|ul|ol|li|table|thead|tbody|tr|th|td|colgroup|col|strong|em|s|b|i|a|img|span|label|input)\b[^>]*>/i;

/**
 * Convert legacy plain text or Markdown to safe HTML without guessing at a
 * particular Markdown dialect. Markdown punctuation remains visible, while
 * paragraphs and line breaks round-trip through TipTap without data loss.
 */
export function legacyTextToHtml(content: string): string {
    const normalized = content.replace(/\r\n?/g, '\n');
    if (!normalized) return '';

    return `<p>${escapeHtml(normalized).replace(/\n/g, '<br>')}</p>`;
}

/**
 * Return canonical, sanitized TipTap-compatible HTML for persisted journal
 * content. Existing HTML is sanitized; legacy text is wrapped losslessly.
 */
export function normalizeJournalContent(content: unknown): string {
    if (typeof content !== 'string' || content.length === 0) return '';

    const html = HTML_ELEMENT_PATTERN.test(content)
        ? content
        : legacyTextToHtml(content);

    return sanitizeHtml(html);
}
