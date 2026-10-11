import { sanitizeHtml } from './sanitize';

const REMOVED_TAGS = new Set([
    'script', 'style', 'meta', 'link', 'xml', 'iframe', 'object', 'embed',
    'form', 'button', 'textarea', 'select', 'option',
]);

const SAFE_ATTRIBUTES: Record<string, Set<string>> = {
    a: new Set(['href', 'title']),
    img: new Set(['src', 'alt', 'title', 'width', 'height']),
    td: new Set(['colspan', 'rowspan', 'colwidth']),
    th: new Set(['colspan', 'rowspan', 'colwidth']),
    col: new Set(['width']),
    input: new Set(['type', 'checked']),
};

function unwrap(element: Element) {
    element.replaceWith(...Array.from(element.childNodes));
}

function wrapContents(element: Element, tagName: 'strong' | 'em' | 's') {
    if (element.matches(tagName) || !element.textContent) return;
    const wrapper = element.ownerDocument.createElement(tagName);
    while (element.firstChild) wrapper.appendChild(element.firstChild);
    element.appendChild(wrapper);
}

function normalizeOfficeLists(document: Document) {
    const listParagraphs = Array.from(document.body.querySelectorAll<HTMLElement>('p, div'))
        .filter(element => /mso-list/i.test(element.getAttribute('style') || ''));

    listParagraphs.forEach(element => {
        if (!element.isConnected) return;

        const ignoredMarkers = element.querySelectorAll<HTMLElement>('[style*="mso-list:Ignore" i]');
        const marker = Array.from(ignoredMarkers).map(candidate => candidate.textContent || '').join('').trim();
        ignoredMarkers.forEach(candidate => candidate.remove());

        const ordered = /^(?:\d+|[a-z]+|[ivxlcdm]+)[.)]$/i.test(marker.replace(/\s/g, ''));
        const listTag = ordered ? 'ol' : 'ul';
        const previous = element.previousElementSibling;
        const list = previous?.tagName.toLowerCase() === listTag
            && previous.hasAttribute('data-axiom-paste-list')
            ? previous
            : element.ownerDocument.createElement(listTag);

        if (!list.isConnected) {
            list.setAttribute('data-axiom-paste-list', 'true');
            element.before(list);
        }

        const item = element.ownerDocument.createElement('li');
        while (element.firstChild) item.appendChild(element.firstChild);
        list.appendChild(item);
        element.remove();
    });

    document.body.querySelectorAll('[data-axiom-paste-list]').forEach(list => {
        list.removeAttribute('data-axiom-paste-list');
    });
}

/**
 * Reduce Word, Teams, email and website clipboard HTML to semantic markup that
 * TipTap can round-trip. Internal mention/task metadata is preserved, while
 * document-specific classes, styles and executable markup are discarded.
 */
export function normalizeJournalPasteHtml(html: string): string {
    if (!html || typeof DOMParser === 'undefined') return sanitizeHtml(html);

    const document = new DOMParser().parseFromString(html, 'text/html');
    normalizeOfficeLists(document);

    const elements = Array.from(document.body.querySelectorAll('*'));
    elements.forEach(element => {
        const tagName = element.tagName.toLowerCase();

        if (REMOVED_TAGS.has(tagName)) {
            element.remove();
            return;
        }

        if (tagName === 'o:p' || tagName === 'font') {
            if (element.textContent?.trim()) unwrap(element);
            else element.remove();
            return;
        }

        const style = element.getAttribute('style') || '';
        if (/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style)) wrapContents(element, 'strong');
        if (/font-style\s*:\s*italic/i.test(style)) wrapContents(element, 'em');
        if (/text-decoration(?:-line)?\s*:[^;]*line-through/i.test(style)) wrapContents(element, 's');

        const dataType = element.getAttribute('data-type');
        const isInternalElement = element.classList.contains('mention')
            || dataType === 'mention'
            || dataType === 'taskList'
            || dataType === 'taskItem'
            || dataType === 'journal-image';
        const safeForTag = SAFE_ATTRIBUTES[tagName] || new Set<string>();

        Array.from(element.attributes).forEach(attribute => {
            const name = attribute.name.toLowerCase();
            const keepInternalMetadata = isInternalElement
                && (name === 'class' || name.startsWith('data-'));
            if (!safeForTag.has(name) && !keepInternalMetadata) {
                element.removeAttribute(attribute.name);
            }
        });

        if (tagName === 'span' && !isInternalElement && element.attributes.length === 0) {
            unwrap(element);
        }
    });

    return sanitizeHtml(document.body.innerHTML);
}
