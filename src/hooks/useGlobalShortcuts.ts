import { useEffect } from 'react';
import { useUIStore } from '../stores/useUIStore';
import { useJournalStore } from '../stores/useJournalStore';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { invoke } from '@tauri-apps/api/core';

const isEditableTarget = (target: EventTarget | null): boolean => {
    const element = target instanceof HTMLElement ? target : null;
    const editableAncestor = element?.closest('[contenteditable]');
    return Boolean(
        element?.isContentEditable
        || element?.closest('input, textarea, select')
        || (editableAncestor && editableAncestor.getAttribute('contenteditable') !== 'false')
    );
};

const hasOpenModal = (): boolean => Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));

export function useGlobalShortcuts() {
    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            const modKey = e.ctrlKey || e.metaKey;

            // F1 -> Toggle the Help dialog.
            if (e.key === 'F1') {
                const { helpOpen, openHelp, closeHelp } = useUIStore.getState();
                if (hasOpenModal() && !helpOpen) return;
                e.preventDefault();
                e.stopPropagation();
                if (helpOpen) closeHelp();
                else openHelp();
                return;
            }

            // Ctrl/Cmd + K -> Toggle Omnibox. Editable fields keep their own
            // shortcuts, including the journal editor's link command.
            if (e.key.toLowerCase() === 'k' && modKey && !e.altKey) {
                if (isEditableTarget(e.target)) return;

                const { omniboxOpen, openOmnibox, closeOmnibox } = useUIStore.getState();
                if (hasOpenModal() && !omniboxOpen) return;
                e.preventDefault();
                e.stopPropagation();
                if (omniboxOpen) closeOmnibox();
                else openOmnibox();
                return;
            }

            // Ctrl/Cmd + N -> New process. Add Shift for a new folder.
            if (e.key.toLowerCase() === 'n' && modKey && !e.altKey) {
                if (isEditableTarget(e.target) || hasOpenModal()) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) useUIStore.getState().requestFolderCreation();
                else useUIStore.getState().openProcessCreation();
                return;
            }

            // Ctrl/Cmd + S -> Save immediately.
            if (e.key.toLowerCase() === 's' && modKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                try {
                    await usePortfolioStore.getState().savePortfolio();
                } catch (error) {
                    console.error('Manual save failed', error);
                }
                return;
            }

            // 1. Ctrl/Cmd + Alt + I -> Open DevTools in development builds only.
            if (import.meta.env.DEV && e.key.toLowerCase() === 'i' && modKey && e.altKey) {
                e.preventDefault();
                console.log("Shortcut triggered: Open DevTools");
                try {
                    await invoke('open_devtools');
                } catch (error) {
                    console.error("Failed to open devtools:", error);
                }
                return;
            }

            // 2. Ctrl/Cmd + J -> Journal Toggle / Quick Note
            if (e.key.toLowerCase() === 'j' && modKey) {
                if (isEditableTarget(e.target) || hasOpenModal()) return;
                // Block default 'Downloads' shortcut (Ctrl+J / Cmd+J)
                e.preventDefault();
                e.stopPropagation();

                // Check for Shift: Either explicit shiftKey OR capital 'J' (common in some remote environments)
                const isShift = e.shiftKey || e.key === 'J';

                if (isShift) {
                    // QUICK NOTE: Ctrl+Shift+J -> Create Note
                    console.log("Shortcut triggered: Quick Note", e);
                    useUIStore.getState().expandJournalPanel();

                    // Create Note (Small delay to ensure panel is open/rendered before creating logic runs)
                    setTimeout(() => {
                        useJournalStore.getState().createQuickNote();
                    }, 50);
                } else {
                    // RESUME NOTE: Ctrl+J -> Toggle Journal Panel
                    console.log("Shortcut triggered: Toggle Journal", e);
                    const { journalPanelExpanded, toggleJournalPanel, expandJournalPanel } = useUIStore.getState();

                    if (journalPanelExpanded) {
                        toggleJournalPanel();
                    } else {
                        expandJournalPanel();

                        // If no entry selected, select most recent
                        const journalStore = useJournalStore.getState();
                        if (!journalStore.selectedEntryId) {
                            journalStore.selectMostRecentEntry();
                        }
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);
}
