export interface JournalTag {
    id: string;
    label: string;
    color: string; // ID from Palette
    archived?: boolean;
    extensions?: Record<string, unknown>;
}

export interface JournalNotebook {
    id: string;
    title: string;
    folderId?: string | null; // Optional parent folder
    createdAt: string;
    updatedAt: string;
    extensions?: Record<string, unknown>;
}

export interface JournalFolder {
    id: string;
    title: string;
    parentId?: string | null; // Recursive folder structure
    createdAt: string;
    extensions?: Record<string, unknown>;
}

// Entity reference for type-safe linking
export interface EntityReference {
    id: string;
    type: 'process' | 'node' | 'asset' | 'journalEntry' | 'tag' | 'incident';
    processId?: string;
    path?: string[];
    source?: 'inline' | 'manual';
    extensions?: Record<string, unknown>;
}

export interface JournalEntry {
    id: string;
    notebookId: string;
    title: string;
    content: string; // Canonical, sanitized TipTap-compatible HTML
    contentFormat: 'html';
    contentVersion: number;
    tags: string[] | null; // JournalTag IDs
    linkedContext: EntityReference[] | null; // Typed entity references (was string[])
    /** Controls shared HTML/.ax exports. Full .axiom backups always retain the entry. */
    sharePolicy?: 'shareable' | 'internal';
    createdAt: string;
    updatedAt: string;
    extensions?: Record<string, unknown>;
}

export interface JournalData {
    notebooks: JournalNotebook[];
    folders: JournalFolder[]; // NEW
    entries: JournalEntry[];
    tags: JournalTag[];
    extensions?: Record<string, unknown>;
}
