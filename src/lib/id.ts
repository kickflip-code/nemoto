/**
 * Centralized ID generation utility.
 * Uses crypto.randomUUID() for guaranteed uniqueness across portfolios.
 * Prefix is preserved for debuggability (e.g. "proc-", "node-", "edge-").
 */
export function generateId(prefix: string): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    // Fallback for non-secure contexts or older environments
    return `${prefix}-${Math.random().toString(36).substring(2, 9)}-${Date.now().toString(36)}`;
}
