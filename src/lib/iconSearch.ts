import lucideTags from './metadata/lucide-tags.json';
import svTags from './metadata/sv-tags.json';

/**
 * Icon Search Engine — bilingual (Swedish + English) weighted search
 * using official Lucide tags and local Swedish translations.
 */

// ---------------------------------------------------------------------------
// 1. HELPERS & TYPES
// ---------------------------------------------------------------------------

/** Convert TitleCase (Lucide React) to kebab-case (Lucide Metadata) */
function toKebab(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Split a TitleCase icon name into lowercase words */
function splitIconName(name: string): string[] {
    return name
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .toLowerCase()
        .split(/[\s-]+/)
        .filter(w => w.length > 1);
}

interface ScoredResult {
    name: string;
    score: number;
}

// ---------------------------------------------------------------------------
// 2. SEARCH ENGINE
// ---------------------------------------------------------------------------

/**
 * Search icons by query string with weighted relevance.
 *
 * @param query - User's search string
 * @param allIconNames - Array of all valid Lucide icon names (TitleCase)
 * @param limit - Max results to return
 */
export function searchIcons(
    query: string,
    allIconNames: string[],
    limit: number = 200
): string[] {
    const q = query.toLowerCase().trim();
    if (!q) return allIconNames.slice(0, limit);

    const scored: ScoredResult[] = [];

    for (const name of allIconNames) {
        let score = 0;
        const lowerName = name.toLowerCase();
        const kebabName = toKebab(name);

        // --- A) Name Matching (High Priority) ---
        if (lowerName === q) {
            score += 200; // Exact match (e.g. "box")
        } else if (lowerName.startsWith(q)) {
            score += 150; // Prefix match (e.g. "bo")
        } else if (lowerName.includes(q)) {
            score += 80;  // Substring match
        }

        // Word matches (e.g. "arrow" matches "ArrowDown")
        const words = splitIconName(name);
        for (const word of words) {
            if (word === q) {
                score += 110;
                break;
            } else if (word.startsWith(q) && q.length >= 2) {
                score += 60;
                break;
            }
        }

        // --- B) Swedish Tag Matching (Medium Priority) ---
        // Match query against Swedish keys in sv-tags.json
        for (const [svTerm, enTags] of Object.entries(svTags)) {
            if (svTerm === q) {
                // If the term matches exactly, check if this icon is in its list
                if ((enTags as string[]).some(tag => kebabName.includes(tag) || name.toLowerCase().includes(tag.replace(/-/g, '')))) {
                    score += 130;
                }
            } else if (svTerm.startsWith(q) && q.length >= 2) {
                if ((enTags as string[]).some(tag => kebabName.includes(tag))) {
                    score += 90;
                }
            }
        }

        // --- C) Official Lucide Tags (English) ---
        const officialTags = (lucideTags as Record<string, string[]>)[kebabName] || [];
        for (const tag of officialTags) {
            const lowerTag = tag.toLowerCase();
            if (lowerTag === q) {
                score += 100; // Exact tag match
                break;
            } else if (lowerTag.startsWith(q) && q.length >= 3) {
                score += 70; // Tag prefix
                break;
            } else if (lowerTag.includes(q) && q.length >= 4) {
                score += 40; // Tag substring
                break;
            }
        }

        if (score > 0) {
            scored.push({ name, score });
        }
    }

    // Sort by score (desc) then alphabetically
    return scored
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.name.localeCompare(b.name);
        })
        .slice(0, limit)
        .map(s => s.name);
}
