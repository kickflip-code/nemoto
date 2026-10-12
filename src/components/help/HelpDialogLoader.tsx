import { useEffect, useRef, useState, type ComponentType } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import {
    NemotoButton,
    NemotoDialog,
    NemotoDialogBody,
    NemotoDialogHeader,
} from '../ui';

interface LoadedHelpDialogProps {
    onClose: () => void;
}

export interface HelpDialogModule {
    default: ComponentType<LoadedHelpDialogProps>;
}

interface HelpDialogLoaderProps {
    loadDialog?: () => Promise<HelpDialogModule>;
    onClose: () => void;
}

const loadDefaultDialog = () => import('./HelpDialog');

export default function HelpDialogLoader({
    loadDialog = loadDefaultDialog,
    onClose,
}: HelpDialogLoaderProps) {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const [attempt, setAttempt] = useState(0);
    const [loadedDialog, setLoadedDialog] = useState<ComponentType<LoadedHelpDialogProps> | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);

    useEffect(() => {
        let active = true;
        setLoadedDialog(null);
        setLoadFailed(false);

        void loadDialog().then(module => {
            if (active) setLoadedDialog(() => module.default);
        }).catch(error => {
            console.error('Nemoto Help could not be loaded:', error);
            if (active) setLoadFailed(true);
        });

        return () => {
            active = false;
        };
    }, [attempt, loadDialog]);

    if (loadedDialog) {
        const LoadedHelpDialog = loadedDialog;
        return <LoadedHelpDialog onClose={onClose} />;
    }

    return (
        <NemotoDialog
            aria-describedby="help-loader-description"
            aria-labelledby="help-loader-title"
            initialFocusRef={loadFailed ? closeButtonRef : undefined}
            onClose={onClose}
            panelClassName="w-full max-w-md overflow-hidden"
            rootClassName="z-[10150]"
        >
            <NemotoDialogHeader className="flex items-center justify-between border-b px-5 py-4">
                <h2 id="help-loader-title" className="flex items-center gap-2 text-sm font-bold text-text-main">
                    {loadFailed ? <AlertTriangle aria-hidden="true" className="text-accent-warning" size={17} /> : <Loader2 aria-hidden="true" className="animate-spin text-accent-primary" size={17} />}
                    {loadFailed ? 'Help could not be loaded' : 'Loading Help...'}
                </h2>
                <NemotoButton
                    ref={closeButtonRef}
                    aria-label="Close Help"
                    icon
                    onClick={onClose}
                    size="sm"
                    title="Close Help"
                    variant="ghost"
                >
                    <X size={16} />
                </NemotoButton>
            </NemotoDialogHeader>
            <NemotoDialogBody className="p-5">
                <p id="help-loader-description" className="text-sm leading-6 text-text-muted" role={loadFailed ? 'alert' : 'status'}>
                    {loadFailed
                        ? 'The Help files are unavailable. The rest of Nemoto is unaffected; close this message and continue working, or try loading Help again.'
                        : 'Opening Help.'}
                </p>
                {loadFailed && (
                    <div className="mt-5 flex justify-end gap-2">
                        <NemotoButton onClick={onClose} size="sm">Close</NemotoButton>
                        <NemotoButton onClick={() => setAttempt(current => current + 1)} size="sm" variant="primary">Try again</NemotoButton>
                    </div>
                )}
            </NemotoDialogBody>
        </NemotoDialog>
    );
}
