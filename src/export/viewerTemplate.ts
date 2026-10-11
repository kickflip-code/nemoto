import viewerTemplateUrl from '../../dist-viewer/index.html?url';

const REQUIRED_VIEWER_TEMPLATE_ANCHORS = [
    '<head>',
    '</head>',
    '<!--AXIOM_DATA-->',
    'Nemoto Viewer',
] as const;

const EXTERNAL_VIEWER_ASSET_PATTERN = /<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=|\/@vite\/|html-proxy/i;

type TemplateFetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

function validateViewerTemplate(template: string): string {
    const missingAnchor = REQUIRED_VIEWER_TEMPLATE_ANCHORS.find(anchor => !template.includes(anchor));

    if (missingAnchor) {
        throw new Error(`Bundled offline viewer template is invalid: missing ${missingAnchor}.`);
    }

    if (EXTERNAL_VIEWER_ASSET_PATTERN.test(template)) {
        throw new Error('Bundled offline viewer template is invalid: it references external development assets.');
    }

    return template;
}

export async function loadBundledViewerTemplate(
    fetchTemplate: TemplateFetch = globalThis.fetch,
): Promise<string> {
    // Vite transforms HTML fetched through its development server into a shell
    // that references /@vite/client and html-proxy modules. Those references
    // cannot work once the exported file is opened on its own, so development
    // uses the already-built single-file viewer as raw text instead.
    if (import.meta.env.DEV && fetchTemplate === globalThis.fetch) {
        const viewerModule = await import('../../dist-viewer/index.html?raw');
        return validateViewerTemplate(viewerModule.default);
    }

    let response: Pick<Response, 'ok' | 'status' | 'text'>;

    try {
        response = await fetchTemplate(viewerTemplateUrl);
    } catch (error) {
        const detail = error instanceof Error ? ` ${error.message}` : '';
        throw new Error(`Could not load the bundled offline viewer template.${detail}`);
    }

    if (!response.ok) {
        throw new Error(`Bundled offline viewer template returned HTTP ${response.status}.`);
    }

    return validateViewerTemplate(await response.text());
}
