import { describe, expect, it } from 'vitest';
import { normalizeJournalLink } from './journalLinks';

describe('journal link normalization', () => {
    it('keeps an empty link as the unlink action', () => {
        expect(normalizeJournalLink('   ')).toBe('');
    });

    it('adds HTTPS to ordinary domains', () => {
        expect(normalizeJournalLink('example.com/path')).toBe('https://example.com/path');
    });

    it.each([
        ['https://example.com/a', 'https://example.com/a'],
        ['http://example.com', 'http://example.com/'],
        ['mailto:hello@example.com', 'mailto:hello@example.com'],
        ['tel:+461234567', 'tel:+461234567'],
    ])('accepts supported link %s', (input, expected) => {
        expect(normalizeJournalLink(input)).toBe(expected);
    });

    it.each(['javascript:alert(1)', 'data:text/html,unsafe', 'file:///tmp/test', 'http://'])
        ('rejects unsafe or invalid link %s', input => {
            expect(normalizeJournalLink(input)).toBeNull();
        });
});
