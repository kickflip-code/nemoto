import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { findJournalTextMatches } from './journalSearch';

let editor: Editor | null = null;

afterEach(() => {
    editor?.destroy();
    editor = null;
});

function createDocument(content: string) {
    editor = new Editor({ extensions: [StarterKit], content });
    return editor.state.doc;
}

describe('journal text search', () => {
    it('finds text across marks and multiple blocks', () => {
        const document = createDocument('<p>Hello <strong>world</strong></p><p>WORLD</p>');
        const matches = findJournalTextMatches(document, 'world', false);

        expect(matches).toHaveLength(2);
        expect(matches.map(match => document.textBetween(match.from, match.to))).toEqual(['world', 'WORLD']);
    });

    it('respects case-sensitive search', () => {
        const document = createDocument('<p>World world WORLD</p>');

        expect(findJournalTextMatches(document, 'world', true)).toHaveLength(1);
        expect(findJournalTextMatches(document, 'world', false)).toHaveLength(3);
    });

    it('returns non-overlapping matches and ignores an empty query', () => {
        const document = createDocument('<p>aaaa</p>');

        expect(findJournalTextMatches(document, 'aa', true)).toHaveLength(2);
        expect(findJournalTextMatches(document, '', false)).toEqual([]);
    });
});
