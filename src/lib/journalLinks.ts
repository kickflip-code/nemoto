const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Normalize user-entered journal links and reject executable/unknown schemes. */
export function normalizeJournalLink(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return '';

    const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;

    try {
        const url = new URL(withProtocol);
        return ALLOWED_PROTOCOLS.has(url.protocol) ? url.toString() : null;
    } catch {
        return null;
    }
}
