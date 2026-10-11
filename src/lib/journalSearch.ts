export interface JournalTextMatch {
    from: number;
    to: number;
}

function textOffsetToDocumentPosition(block: any, blockPosition: number, offset: number): number {
    let textOffset = 0;
    let documentPosition = blockPosition + 1;

    for (let index = 0; index < block.childCount; index += 1) {
        const child = block.child(index);
        const childTextLength = child.textContent?.length || 0;

        if (offset <= textOffset + childTextLength) {
            return documentPosition + Math.max(0, offset - textOffset);
        }

        textOffset += childTextLength;
        documentPosition += child.nodeSize;
    }

    return Math.max(blockPosition + 1, blockPosition + block.nodeSize - 1);
}

/** Find non-overlapping text matches within each text block, including text split by marks. */
export function findJournalTextMatches(
    document: any,
    query: string,
    caseSensitive: boolean,
): JournalTextMatch[] {
    if (!query) return [];

    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const matches: JournalTextMatch[] = [];

    document.descendants((node: any, position: number) => {
        if (!node.isTextblock) return true;

        const originalText = node.textContent || '';
        const haystack = caseSensitive ? originalText : originalText.toLocaleLowerCase();
        let offset = 0;

        while (offset <= haystack.length - needle.length) {
            const matchOffset = haystack.indexOf(needle, offset);
            if (matchOffset < 0) break;

            matches.push({
                from: textOffsetToDocumentPosition(node, position, matchOffset),
                to: textOffsetToDocumentPosition(node, position, matchOffset + query.length),
            });
            offset = matchOffset + Math.max(needle.length, 1);
        }

        return false;
    });

    return matches;
}
