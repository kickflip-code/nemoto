import { generateId } from '../../lib/id';
import {
    JOURNAL_CONTENT_FORMAT,
    JOURNAL_CONTENT_VERSION,
    normalizeJournalContent,
} from '../../lib/journalContent';
import { normalizeJournalMentions, reconcileLinkedContext } from '../../lib/journalMentions';
import { normalizeEntityReference } from '../../lib/entityResolver';
import type { Portfolio } from '../../types';
import type { JournalEntry, JournalNotebook, JournalFolder, JournalTag, EntityReference, JournalData } from '../../types/journal';

const ensureJournal = (portfolio: Portfolio): JournalData => {
    return portfolio.journal || { notebooks: [], entries: [], folders: [], tags: [] };
};

function canMoveFolder(
    folders: JournalFolder[],
    itemId: string,
    targetFolderId: string | undefined,
): boolean {
    if (!folders.some(folder => folder.id === itemId)) return false;
    if (!targetFolderId) return true;

    const foldersById = new Map(folders.map(folder => [folder.id, folder]));
    const visited = new Set<string>();
    let currentId: string | null | undefined = targetFolderId;

    while (currentId) {
        if (currentId === itemId || visited.has(currentId)) return false;
        visited.add(currentId);

        const current = foldersById.get(currentId);
        if (!current) return false;
        currentId = current.parentId;
    }

    return true;
}

export const createJournalFolderLogic = (portfolio: Portfolio, title: string, parentId?: string): { portfolio: Portfolio, newFolderId: string } => {
    const journal = ensureJournal(portfolio);
    const newFolder: JournalFolder = {
        id: generateId('fld'),
        title,
        parentId,
        createdAt: new Date().toISOString()
    };

    return {
        portfolio: {
            ...portfolio,
            journal: { ...journal, folders: [...(journal.folders || []), newFolder] }
        },
        newFolderId: newFolder.id
    };
};

export const deleteJournalFolderLogic = (portfolio: Portfolio, id: string): Portfolio => {
    const journal = ensureJournal(portfolio);

    const updatedNotebooks = (journal.notebooks || []).map(n =>
        n.folderId === id ? { ...n, folderId: undefined } : n
    );

    const updatedFolders = (journal.folders || [])
        .filter(f => f.id !== id)
        .map(f => f.parentId === id ? { ...f, parentId: undefined } : f);

    return {
        ...portfolio,
        journal: { ...journal, notebooks: updatedNotebooks, folders: updatedFolders }
    };
};

export const moveJournalItemLogic = (portfolio: Portfolio, itemId: string, itemType: 'notebook' | 'folder' | 'variable', targetFolderId?: string): Portfolio => {
    const journal = ensureJournal(portfolio);

    let resolvedType = itemType;
    if (resolvedType === 'variable') {
        if ((journal.notebooks || []).some(n => n.id === itemId)) {
            resolvedType = 'notebook';
        } else if ((journal.folders || []).some(f => f.id === itemId)) {
            resolvedType = 'folder';
        }
    }

    if (resolvedType === 'notebook') {
        const notebook = (journal.notebooks || []).find(n => n.id === itemId);
        if (notebook?.title === 'Quick Notes') {
            console.warn("Quick Notes cannot be moved");
            return portfolio;
        }
        if (!notebook || (targetFolderId && !(journal.folders || []).some(folder => folder.id === targetFolderId))) {
            return portfolio;
        }

        const updatedNotebooks = (journal.notebooks || []).map(n =>
            n.id === itemId ? { ...n, folderId: targetFolderId } : n
        );
        return { ...portfolio, journal: { ...journal, notebooks: updatedNotebooks } };
    } else if (resolvedType === 'folder') {
        const folders = journal.folders || [];
        if (!canMoveFolder(folders, itemId, targetFolderId)) return portfolio;

        const updatedFolders = folders.map(f =>
            f.id === itemId ? { ...f, parentId: targetFolderId } : f
        );
        return { ...portfolio, journal: { ...journal, folders: updatedFolders } };
    }

    return portfolio;
};

export const renameJournalItemLogic = (portfolio: Portfolio, itemId: string, itemType: 'notebook' | 'folder', newTitle: string): Portfolio => {
    const journal = ensureJournal(portfolio);

    if (itemType === 'notebook') {
        const updatedNotebooks = (journal.notebooks || []).map(n =>
            n.id === itemId ? { ...n, title: newTitle, updatedAt: new Date().toISOString() } : n
        );
        return { ...portfolio, journal: { ...journal, notebooks: updatedNotebooks } };
    } else if (itemType === 'folder') {
        const updatedFolders = (journal.folders || []).map(f =>
            f.id === itemId ? { ...f, title: newTitle } : f
        );
        return { ...portfolio, journal: { ...journal, folders: updatedFolders } };
    }

    return portfolio;
};

export const createNotebookLogic = (portfolio: Portfolio, title: string, folderId?: string): { portfolio: Portfolio, newNotebookId: string } => {
    const journal = ensureJournal(portfolio);
    const newNotebook: JournalNotebook = {
        id: generateId('nb'),
        title,
        folderId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    return {
        portfolio: {
            ...portfolio,
            journal: { ...journal, notebooks: [...(journal.notebooks || []), newNotebook] }
        },
        newNotebookId: newNotebook.id
    };
};

export const deleteNotebookLogic = (portfolio: Portfolio, id: string): Portfolio => {
    const journal = ensureJournal(portfolio);
    const entriesToKeep = (journal.entries || []).filter(e => e.notebookId !== id);

    return {
        ...portfolio,
        journal: {
            ...journal,
            notebooks: (journal.notebooks || []).filter(n => n.id !== id),
            entries: entriesToKeep
        }
    };
};

export const createEntryLogic = (portfolio: Portfolio, notebookId: string, title: string = 'Untitled Note'): { portfolio: Portfolio, newEntryId: string } => {
    const journal = ensureJournal(portfolio);
    const newEntry: JournalEntry = {
        id: generateId('je'),
        notebookId,
        title,
        content: '',
        contentFormat: JOURNAL_CONTENT_FORMAT,
        contentVersion: JOURNAL_CONTENT_VERSION,
        tags: [],
        linkedContext: [],
        sharePolicy: 'shareable',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    return {
        portfolio: {
            ...portfolio,
            journal: { ...journal, entries: [newEntry, ...(journal.entries || [])] }
        },
        newEntryId: newEntry.id
    };
};

export const updateEntryLogic = (portfolio: Portfolio, id: string, updates: Partial<JournalEntry>): Portfolio => {
    const journal = ensureJournal(portfolio);
    const newEntries = (journal.entries || []).map(entry => {
        if (entry.id !== id) return entry;

        let normalizedUpdates: Partial<JournalEntry> = updates;
        if (updates.content !== undefined) {
            const canonicalContent = normalizeJournalContent(updates.content);
            const mentions = normalizeJournalMentions(canonicalContent, portfolio);
            normalizedUpdates = {
                ...updates,
                content: mentions.content,
                contentFormat: JOURNAL_CONTENT_FORMAT,
                contentVersion: JOURNAL_CONTENT_VERSION,
                linkedContext: reconcileLinkedContext(
                    updates.linkedContext || entry.linkedContext,
                    mentions.inlineReferences,
                    portfolio,
                ),
            };
        }

        return { ...entry, ...normalizedUpdates, updatedAt: new Date().toISOString() };
    });

    return {
        ...portfolio,
        journal: { ...journal, entries: newEntries }
    };
};

export const deleteEntryLogic = (portfolio: Portfolio, id: string): Portfolio => {
    const journal = ensureJournal(portfolio);
    return {
        ...portfolio,
        journal: {
            ...journal,
            entries: (journal.entries || []).filter(e => e.id !== id)
        }
    };
};

export const createTagLogic = (portfolio: Portfolio, label: string, color: string): Portfolio => {
    const journal = ensureJournal(portfolio);
    const tags = journal.tags || [];

    const existing = tags.find(t => t.label.toLowerCase() === label.trim().toLowerCase());

    if (existing) {
        const updatedTags = tags.map(t =>
            t.id === existing.id ? { ...t, archived: false, color } : t
        );
        return {
            ...portfolio,
            journal: { ...journal, tags: updatedTags }
        };
    }

    const newTag: JournalTag = {
        id: generateId('tag'),
        label: label.trim(),
        color,
        archived: false
    };

    return {
        ...portfolio,
        journal: { ...journal, tags: [...tags, newTag] }
    };
};

export const deleteTagLogic = (portfolio: Portfolio, id: string): Portfolio => {
    const journal = ensureJournal(portfolio);
    const updatedTags = (journal.tags || []).map(t =>
        t.id === id ? { ...t, archived: true } : t
    );

    return {
        ...portfolio,
        journal: { ...journal, tags: updatedTags }
    };
};

export const purgeTagLogic = (portfolio: Portfolio, id: string): Portfolio => {
    const journal = ensureJournal(portfolio);
    const updatedTags = (journal.tags || []).filter(t => t.id !== id);
    const updatedEntries = (journal.entries || []).map(entry => ({
        ...entry,
        tags: entry.tags?.filter(tid => tid !== id) || []
    }));

    return {
        ...portfolio,
        journal: { ...journal, tags: updatedTags, entries: updatedEntries }
    };
};

export const linkContextLogic = (portfolio: Portfolio, entryId: string, entityRef: EntityReference): Portfolio => {
    const journal = ensureJournal(portfolio);
    const entries = journal.entries || [];
    const entry = entries.find(e => e.id === entryId);

    if (!entry) return portfolio;

    const normalizedReference = normalizeEntityReference({ ...entityRef, source: 'manual' }, portfolio);
    const existingReferences = entry.linkedContext || [];
    const alreadyLinked = existingReferences.some(ref => ref.id === normalizedReference.id && ref.type === normalizedReference.type);

    const updatedEntries = entries.map(e =>
        e.id === entryId
            ? {
                ...e,
                linkedContext: alreadyLinked
                    ? existingReferences.map(ref =>
                        ref.id === normalizedReference.id && ref.type === normalizedReference.type
                            ? normalizedReference
                            : ref
                    )
                    : [...existingReferences, normalizedReference],
                updatedAt: new Date().toISOString()
            }
            : e
    );

    return {
        ...portfolio,
        journal: { ...journal, entries: updatedEntries }
    };
};

export const unlinkContextLogic = (portfolio: Portfolio, entryId: string, entityId: string): Portfolio => {
    const journal = ensureJournal(portfolio);
    const entries = journal.entries || [];

    const updatedEntries = entries.map(e =>
        e.id === entryId
            ? {
                ...e,
                linkedContext: (e.linkedContext || []).filter(ref => ref.id !== entityId || ref.source === 'inline'),
                updatedAt: new Date().toISOString()
            }
            : e
    );

    return {
        ...portfolio,
        journal: { ...journal, entries: updatedEntries }
    };
};

export const moveEntryLogic = (portfolio: Portfolio, entryId: string, targetNotebookId: string): Portfolio => {
    const journal = ensureJournal(portfolio);
    const entries = journal.entries || [];
    const entryIndex = entries.findIndex(e => e.id === entryId);

    if (entryIndex === -1) return portfolio;
    const entry = entries[entryIndex];
    if (entry.notebookId === targetNotebookId) return portfolio;

    const updatedEntry = { ...entry, notebookId: targetNotebookId, updatedAt: new Date().toISOString() };
    const newEntries = [...entries];
    newEntries[entryIndex] = updatedEntry;

    return {
        ...portfolio,
        journal: { ...journal, entries: newEntries }
    };
};
