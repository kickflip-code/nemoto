import { describe, expect, it } from 'vitest';
import {
    estimateBase64Bytes,
    estimateEmbeddedJournalMediaBytes,
    formatJournalMediaBytes,
    isSupportedJournalImage,
    JOURNAL_IMAGE_ACCEPT,
} from './journalMedia';

describe('journal media helpers', () => {
    it('advertises and accepts only the supported local image formats', () => {
        expect(JOURNAL_IMAGE_ACCEPT).toBe('image/png,image/jpeg,image/webp,image/gif');
        expect(isSupportedJournalImage(new File(['x'], 'image.PNG', { type: 'image/png' }))).toBe(true);
        expect(isSupportedJournalImage(new File(['x'], 'animation.gif', { type: 'image/gif' }))).toBe(true);
        expect(isSupportedJournalImage(new File(['x'], 'vector.svg', { type: 'image/svg+xml' }))).toBe(false);
    });

    it.each([
        [0, '0 B'],
        [1023, '1023 B'],
        [1536, '2 KB'],
        [2.25 * 1024 * 1024, '2.3 MB'],
    ])('formats %s bytes for the interface', (bytes, formatted) => {
        expect(formatJournalMediaBytes(bytes)).toBe(formatted);
    });

    it.each([
        ['', 0],
        ['AA==', 1],
        ['SGk=', 2],
        ['SGVsbG8=', 5],
    ])('estimates the decoded size of %s', (base64, bytes) => {
        expect(estimateBase64Bytes(base64)).toBe(bytes);
    });

    it('totals embedded journal images across entries', () => {
        const total = estimateEmbeddedJournalMediaBytes([
            { content: '<p>Text</p><img src="data:image/png;base64,AA==">' },
            { content: '<img src="data:image/webp;base64,SGk="><img src="https://example.com/image.png">' },
            {},
        ]);

        expect(total).toBe(3);
        expect(estimateEmbeddedJournalMediaBytes(null)).toBe(0);
    });
});
