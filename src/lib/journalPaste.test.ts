import { describe, expect, it } from 'vitest';
import { normalizeJournalPasteHtml } from './journalPaste';

function parseBody(html: string) {
    return new DOMParser().parseFromString(html, 'text/html').body;
}

describe('journal paste normalization', () => {
    it('removes executable and document-specific markup', () => {
        const body = parseBody(normalizeJournalPasteHtml(`
            <p class="MsoNormal" onclick="alert(1)" style="color:red">Safe</p>
            <script>alert(1)</script><iframe src="https://example.com"></iframe>
        `));

        expect(body.textContent?.trim()).toBe('Safe');
        expect(body.querySelector('script, iframe')).toBeNull();
        expect(body.querySelector('p')?.attributes).toHaveLength(0);
    });

    it('keeps semantic formatting expressed through inline styles', () => {
        const body = parseBody(normalizeJournalPasteHtml(`
            <p>
                <span style="font-weight:700">Bold</span>
                <span style="font-style:italic">Italic</span>
                <span style="text-decoration:line-through">Strike</span>
            </p>
        `));

        expect(body.querySelector('strong')?.textContent).toBe('Bold');
        expect(body.querySelector('em')?.textContent).toBe('Italic');
        expect(body.querySelector('s')?.textContent).toBe('Strike');
        expect(body.querySelector('[style]')).toBeNull();
    });

    it('turns consecutive Word list paragraphs into a semantic list', () => {
        const body = parseBody(normalizeJournalPasteHtml(`
            <p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1. </span>First</p>
            <p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2. </span>Second</p>
        `));

        expect(Array.from(body.querySelectorAll('ol > li')).map(item => item.textContent?.trim()))
            .toEqual(['First', 'Second']);
    });

    it('preserves internal mention metadata and unwraps decorative spans', () => {
        const body = parseBody(normalizeJournalPasteHtml(`
            <p><span class="mention" data-type="mention" data-entity-id="asset-1" data-entity-type="asset" style="color:red">@Laptop</span></p>
            <p><span class="external" style="color:blue">Plain</span></p>
        `));
        const mention = body.querySelector<HTMLElement>('.mention');

        expect(mention?.dataset.entityId).toBe('asset-1');
        expect(mention?.dataset.entityType).toBe('asset');
        expect(mention?.hasAttribute('style')).toBe(false);
        expect(body.querySelector('.external')).toBeNull();
        expect(body.textContent).toContain('Plain');
    });
});
