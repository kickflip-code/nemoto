import { describe, expect, it, vi } from 'vitest';
import { loadBundledViewerTemplate } from './viewerTemplate';

const validTemplate = `<!DOCTYPE html>
<html>
  <head><title>Nemoto Viewer</title></head>
  <body><script id="axiom-data"><!--AXIOM_DATA--></script></body>
</html>`;

const createResponse = (body: string, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(body),
});

describe('bundled offline viewer template', () => {
    it('uses a self-contained viewer template during development exports', async () => {
        const template = await loadBundledViewerTemplate();

        expect(template).toContain('<script id="axiom-data" type="application/json"><!--AXIOM_DATA--></script>');
        expect(template).not.toMatch(/<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=|\/@vite\/|html-proxy/i);
    });

    it('loads a valid template from the emitted viewer asset', async () => {
        const response = createResponse(validTemplate);
        const fetchTemplate = vi.fn().mockResolvedValue(response);

        await expect(loadBundledViewerTemplate(fetchTemplate)).resolves.toBe(validTemplate);
        expect(fetchTemplate).toHaveBeenCalledOnce();
        expect(fetchTemplate).toHaveBeenCalledWith(expect.stringMatching(/index\.html(?:\?|$)/));
        expect(response.text).toHaveBeenCalledOnce();
    });

    it('rejects a template whose data injection marker is missing', async () => {
        const invalidTemplate = validTemplate.replace('<!--AXIOM_DATA-->', '');
        const fetchTemplate = vi.fn().mockResolvedValue(createResponse(invalidTemplate));

        await expect(loadBundledViewerTemplate(fetchTemplate)).rejects.toThrow(
            'Bundled offline viewer template is invalid: missing <!--AXIOM_DATA-->.',
        );
    });

    it('rejects Vite development shells that would make a standalone export blank', async () => {
        const developmentShell = validTemplate.replace(
            '</head>',
            '<script type="module" src="/@vite/client"></script>\n'
                + '<script type="module" src="/dist-viewer/index.html?html-proxy&index=0.js"></script>\n'
                + '</head>',
        );
        const fetchTemplate = vi.fn().mockResolvedValue(createResponse(developmentShell));

        await expect(loadBundledViewerTemplate(fetchTemplate)).rejects.toThrow(
            'Bundled offline viewer template is invalid: it references external development assets.',
        );
    });

    it('reports asset transport failures without returning partial HTML', async () => {
        const fetchTemplate = vi.fn().mockResolvedValue(createResponse('Not found', 404));

        await expect(loadBundledViewerTemplate(fetchTemplate)).rejects.toThrow(
            'Bundled offline viewer template returned HTTP 404.',
        );
    });
});
