import { describe, expect, it } from 'vitest';
import { escapeHtml, sanitizeHtml } from './sanitize';

describe('journal HTML sanitizer', () => {
    it('escapes interpolated user text', () => {
        expect(escapeHtml(`<tag a="1">Tom & Jerry's</tag>`))
            .toBe('&lt;tag a=&quot;1&quot;&gt;Tom &amp; Jerry&#39;s&lt;/tag&gt;');
    });

    it.each([
        '<img src="x" onerror="alert(1)">',
        '<a href="javascript:alert(1)">Open</a>',
        '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
        '<svg><script>alert(1)</script><a xlink:href="javascript:alert(1)">x</a></svg>',
        '<math><mtext><img src="x" onerror="alert(1)"></mtext></math>',
        '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">Run</button></form>',
        '<template><img src="x" onerror="alert(1)"></template>',
    ])('neutralizes executable payload %#', payload => {
        const sanitized = sanitizeHtml(payload);

        expect(sanitized).not.toMatch(/<script|<iframe|<svg|<math|<form|<template/i);
        expect(sanitized).not.toMatch(/onerror|javascript:|srcdoc|formaction|xlink:href/i);
    });

    it('preserves the safe journal extension contract', () => {
        const sanitized = sanitizeHtml(`
            <p><a href="https://example.com" title="Documentation">Safe link</a></p>
            <span class="mention" data-type="mention" data-entity-id="asset-1" data-entity-type="asset">@Laptop</span>
            <figure data-type="journal-image" data-width="60%" data-align="right" data-caption="Diagram" data-embedded-size="1">
                <img src="data:image/png;base64,AA==" alt="Diagram">
                <figcaption>Diagram</figcaption>
            </figure>
        `);

        expect(sanitized).toContain('href="https://example.com"');
        expect(sanitized).toContain('data-entity-id="asset-1"');
        expect(sanitized).toContain('data-width="60%"');
        expect(sanitized).toContain('data-align="right"');
        expect(sanitized).toContain('src="data:image/png;base64,AA=="');
        expect(sanitized).toContain('<figcaption>Diagram</figcaption>');
    });
});
