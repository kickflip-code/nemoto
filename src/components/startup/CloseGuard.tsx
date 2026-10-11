import { useEffect, useMemo, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AlertTriangle } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { hasUnsavedPluginChanges } from '../../plugins/pluginViewLeaveGuard';
import { AxiomButton, AxiomDialog, AxiomDialogBody, AxiomDialogFooter, AxiomDialogHeader } from '../ui';

export default function CloseGuard() {
    const { isDirty, isSaving, saveError, savePortfolio } = usePortfolioStore(
        useShallow(state => ({
            isDirty: state.isDirty,
            isSaving: state.isSaving,
            saveError: state.saveError,
            savePortfolio: state.savePortfolio,
        })),
    );
    const appWindow = useMemo(() => isTauri() ? getCurrentWindow() : null, []);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [pluginDraft, setPluginDraft] = useState(false);

    useEffect(() => {
        if (!appWindow) return;

        let disposed = false;
        let unlisten: (() => void) | undefined;
        appWindow.onCloseRequested((event) => {
            event.preventDefault();

            if (usePortfolioStore.getState().isRestoring) return;

            const unsavedPlugin = hasUnsavedPluginChanges();
            setPluginDraft(unsavedPlugin);
            if (!usePortfolioStore.getState().isDirty && !unsavedPlugin) {
                void appWindow.destroy().catch((error) => {
                    setActionError(error instanceof Error ? error.message : 'Nemoto could not close the window.');
                    setDialogOpen(true);
                });
                return;
            }

            setActionError(null);
            setDialogOpen(true);
        }).then((stopListening) => {
            if (disposed) {
                stopListening();
            } else {
                unlisten = stopListening;
            }
        }).catch((error) => {
            console.error('Could not register the unsaved-changes close guard:', error);
        });

        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [appWindow]);

    useEffect(() => {
        if (appWindow) return;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            if (!usePortfolioStore.getState().isDirty && !usePortfolioStore.getState().isRestoring && !hasUnsavedPluginChanges()) return;
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [appWindow]);

    const closeApplication = async () => {
        if (!appWindow || usePortfolioStore.getState().isRestoring) return;

        try {
            await appWindow.destroy();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : 'Nemoto could not close the window.');
        }
    };

    const handleSaveAndClose = async () => {
        if (hasUnsavedPluginChanges()) {
            setPluginDraft(true);
            return;
        }
        setActionError(null);
        await savePortfolio();

        const latest = usePortfolioStore.getState();
        if (latest.isDirty) {
            setActionError(latest.saveError || 'Some newer changes are still unsaved. Please try saving again.');
            return;
        }

        await closeApplication();
    };

    if (!dialogOpen) return null;

    return (
        <AxiomDialog
            aria-describedby="close-guard-description"
            aria-labelledby="close-guard-title"
            closeOnBackdrop={false}
            onClose={() => setDialogOpen(false)}
            panelClassName="w-full max-w-lg overflow-hidden"
        >
            <AxiomDialogHeader className="flex items-center gap-3 border-b p-5">
                <div className="axiom-dialog-icon axiom-dialog-icon-warning flex h-10 w-10 items-center justify-center">
                    <AlertTriangle aria-hidden="true" size={20} />
                </div>
                <div>
                    <h2 id="close-guard-title" className="font-bold text-text-main">
                        {pluginDraft ? 'Unsaved plugin changes' : isDirty ? 'Save changes before closing?' : 'Nemoto could not close'}
                    </h2>
                    <p id="close-guard-description" className="mt-1 text-xs text-text-muted">
                        {pluginDraft ? 'Plugin edits are still held in the open view.' : isDirty
                            ? 'Nemoto has changes that have not been written to your portfolio file yet.'
                            : 'Your latest changes are saved. You can safely try closing the window again.'}
                    </p>
                </div>
            </AxiomDialogHeader>
            <AxiomDialogBody className="p-5">
                {pluginDraft && <p role="alert">Return to the plugin and save or discard its edits before saving and closing Nemoto. Saving the Portfolio does not save a plugin draft.</p>}
                {(actionError || saveError) && (
                    <p className="rounded border border-accent-danger/40 bg-accent-danger/10 p-3 text-sm text-accent-danger" role="alert">
                        {actionError || saveError}
                    </p>
                )}
                {!isDirty && !pluginDraft && (
                    <p className="text-sm text-text-muted" role="status">
                        The latest changes have now been saved. You can close Nemoto safely.
                    </p>
                )}
            </AxiomDialogBody>
            <AxiomDialogFooter className="flex flex-wrap justify-end gap-3 border-t p-4">
                <AxiomButton onClick={() => setDialogOpen(false)}>Cancel</AxiomButton>
                <AxiomButton onClick={() => { void closeApplication(); }} variant="danger">
                    Close without saving
                </AxiomButton>
                <AxiomButton
                    disabled={isSaving || pluginDraft}
                    onClick={() => { void handleSaveAndClose(); }}
                    variant="primary"
                >
                    {isSaving ? 'Saving...' : isDirty ? 'Save and close' : 'Close Nemoto'}
                </AxiomButton>
            </AxiomDialogFooter>
        </AxiomDialog>
    );
}
