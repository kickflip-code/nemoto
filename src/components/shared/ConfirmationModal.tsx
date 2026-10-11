import { AlertTriangle, Info, Trash2 } from 'lucide-react';
import { AxiomButton, AxiomDialog, type AxiomButtonVariant } from '../ui';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'primary';
    hideCancel?: boolean;
}

type ConfirmationDialogSurfaceProps = Omit<ConfirmationModalProps, 'isOpen'>;

function ConfirmationDialogContent({
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'primary',
    hideCancel = false,
}: ConfirmationDialogSurfaceProps) {
    const confirmVariant: Record<NonNullable<ConfirmationModalProps['variant']>, AxiomButtonVariant> = {
        primary: 'primary',
        warning: 'warning',
        danger: 'danger',
    };

    const Icon = variant === 'danger' ? Trash2 : variant === 'warning' ? AlertTriangle : Info;
    const iconVariantClass = {
        primary: 'axiom-dialog-icon-primary',
        warning: 'axiom-dialog-icon-warning',
        danger: 'axiom-dialog-icon-danger',
    }[variant];

    return (
        <div className="p-8 flex flex-col items-center text-center">
                <div className={`axiom-dialog-icon ${iconVariantClass} p-4 mb-6`}>
                    <Icon size={32} />
                </div>

                <h3 id="confirmation-dialog-title" className="text-xl font-bold text-text-main mb-3">{title}</h3>
                <p id="confirmation-dialog-message" className="text-sm text-text-muted max-w-xs leading-relaxed whitespace-pre-line">
                    {message}
                </p>

                <div className="flex w-full gap-4 mt-10">
                    {!hideCancel && (
                        <AxiomButton
                            onClick={onClose}
                            className="flex-1 text-sm"
                        >
                            {cancelLabel}
                        </AxiomButton>
                    )}
                    <AxiomButton
                        onClick={() => { onConfirm(); onClose(); }}
                        variant={confirmVariant[variant]}
                        className={`flex-1 text-sm ${hideCancel ? 'max-w-[200px] mx-auto' : ''}`}
                    >
                        {confirmLabel}
                    </AxiomButton>
                </div>
        </div>
    );
}

export function ConfirmationDialogSurface(props: ConfirmationDialogSurfaceProps) {
    return (
        <div className="axiom-dialog-panel relative w-full max-w-md flex flex-col overflow-hidden axiom-motion-dialog">
            <ConfirmationDialogContent {...props} />
        </div>
    );
}

export default function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'primary',
    hideCancel = false
}: ConfirmationModalProps) {
    if (!isOpen) return null;

    return (
        <AxiomDialog
            aria-describedby="confirmation-dialog-message"
            aria-labelledby="confirmation-dialog-title"
            onClose={onClose}
            panelClassName="w-full max-w-md flex flex-col overflow-hidden"
        >
            <ConfirmationDialogContent
                onClose={onClose}
                onConfirm={onConfirm}
                title={title}
                message={message}
                confirmLabel={confirmLabel}
                cancelLabel={cancelLabel}
                variant={variant}
                hideCancel={hideCancel}
            />
        </AxiomDialog>
    );
}
