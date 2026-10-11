import DOMPurify from 'dompurify';

/**
 * Strict HTML sanitizer for TipTap journal content.
 *
 * Only allows TipTap-compatible tags and attributes. Extension-owned data-*
 * metadata is preserved for mentions and future custom blocks; executable
 * markup is stripped. This prevents XSS from imported .axiom files or crafted
 * journal content.
 */

const ALLOWED_TAGS = [
    // Block elements
    'p', 'h1', 'h2', 'h3', 'blockquote', 'pre', 'code', 'hr', 'br', 'div',
    'figure', 'figcaption',
    // Lists
    'ul', 'ol', 'li',
    // Table elements
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col',
    // Inline formatting
    'strong', 'em', 's', 'b', 'i',
    // Links & media
    'a', 'img',
    // Mentions & generic inline
    'span',
    // Task list elements
    'label', 'input',
];

const ALLOWED_ATTR = [
    // Links
    'href', 'target', 'rel',
    // Images
    'src', 'alt', 'title', 'width', 'height',
    // Styling class (for mentions, task lists, prose)
    'class', 'style',
    // Task list checkbox
    'type', 'checked',
    // Table attributes
    'colspan', 'rowspan', 'colwidth',
    // TipTap data attributes (mentions, task lists)
    'data-type',           // "mention", "taskList", "taskItem"
    'data-id',             // mention entity ID (from import)
    'data-label',          // mention display label (from import)
    'data-mention-id',     // mention entity ID (from TipTap)
    'data-mention-type',   // "resource", "process", "subprocess"
    'data-entity-id',      // canonical typed mention entity ID
    'data-entity-type',    // canonical entity type
    'data-process-id',     // owning process for node mentions
    'data-entity-path',    // node path from the process root
    'data-hint',           // mention tooltip
    'data-dangling',       // unresolved mention state
    'data-width',          // journal image display width
    'data-align',          // journal image alignment
    'data-caption',        // journal image caption
    'data-embedded-size',  // embedded media byte count
    'data-checked',        // task item checked state
];

const FORBIDDEN_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'template', 'svg', 'math'];
const FORBIDDEN_ATTR = ['srcdoc', 'formaction', 'xlink:href'];

/**
 * Sanitize HTML content using DOMPurify with a strict whitelist.
 * Safe for use with dangerouslySetInnerHTML.
 */
export function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        FORBID_TAGS: FORBIDDEN_TAGS,
        FORBID_ATTR: FORBIDDEN_ATTR,
        // Journal extensions use data-* metadata for mentions and custom blocks.
        // Data attributes are inert and must survive import/edit/export round-trips.
        ALLOW_DATA_ATTR: true,
    });
}

/**
 * Escape HTML special characters in a string.
 * Use this when interpolating user-controlled values into HTML strings.
 */
export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
