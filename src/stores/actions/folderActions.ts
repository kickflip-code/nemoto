import { generateId } from '../../lib/id';
import type { ProcessFolder, Portfolio } from '../../types';

/**
 * Adds a new process folder.
 */
export const addFolderLogic = (
    portfolio: Portfolio,
    title: string,
    parentId?: string
): Portfolio => {
    const newFolder: ProcessFolder = {
        id: generateId('fldr'),
        title,
        parentId,
        createdAt: new Date().toISOString()
    };

    return {
        ...portfolio,
        processFolders: [...(portfolio.processFolders || []), newFolder]
    };
};

/**
 * Updates an existing process folder.
 */
export const updateFolderLogic = (
    portfolio: Portfolio,
    id: string,
    updates: Partial<ProcessFolder>
): Portfolio => {
    return {
        ...portfolio,
        processFolders: (portfolio.processFolders || []).map(f =>
            f.id === id ? { ...f, ...updates } : f
        )
    };
};

/**
 * Safely deletes a folder.
 * Moves all direct child processes and subfolders to the root level to prevent data loss.
 */
export const deleteFolderLogic = (
    portfolio: Portfolio,
    id: string
): Portfolio => {
    // Safe Delete: Move children to Root
    const newProcesses = portfolio.processes.map(p =>
        p.folderId === id ? { ...p, folderId: undefined } : p
    );

    // Remove target folder and orphan subfolders
    const newFolders = (portfolio.processFolders || [])
        .filter(f => f.id !== id)
        .map(f => f.parentId === id ? { ...f, parentId: undefined } : f);

    return {
        ...portfolio,
        processes: newProcesses,
        processFolders: newFolders
    };
};

/**
 * Moves an item (process or folder) to a target folder.
 * Prevents circular folder moves.
 */
export const moveItemLogic = (
    portfolio: Portfolio,
    itemId: string,
    itemType: 'process' | 'folder',
    targetFolderId: string | undefined
): Portfolio => {
    const folders = portfolio.processFolders || [];

    // Prevent circular moves (folder into itself, its descendants, or an
    // already-corrupt ancestry chain).
    if (itemType === 'folder') {
        if (!folders.some(folder => folder.id === itemId)) return portfolio;

        const foldersById = new Map(folders.map(folder => [folder.id, folder]));
        const visited = new Set<string>();
        let currentId: string | null | undefined = targetFolderId;
        while (currentId) {
            if (currentId === itemId || visited.has(currentId)) {
                console.warn('Cannot move folder into a cyclic hierarchy');
                return portfolio;
            }
            visited.add(currentId);
            const current = foldersById.get(currentId);
            if (!current) return portfolio;
            currentId = current.parentId;
        }

        return {
            ...portfolio,
            processFolders: folders.map(f =>
                f.id === itemId ? { ...f, parentId: targetFolderId } : f
            )
        };
    }

    if (itemType === 'process') {
        if (!portfolio.processes.some(process => process.id === itemId)) return portfolio;
        if (targetFolderId && !folders.some(folder => folder.id === targetFolderId)) return portfolio;
        return {
            ...portfolio,
            processes: portfolio.processes.map(p =>
                p.id === itemId ? { ...p, folderId: targetFolderId, updatedAt: new Date().toISOString() } : p
            )
        };
    }

    return portfolio;
};
