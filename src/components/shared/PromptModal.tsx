import { HelpCircle } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { NemotoButton, NemotoDialog, NemotoInput } from '../ui';

interface PromptModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (value: string) => void | boolean;
    title: string;
    message: string;
    defaultValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
}

export default function PromptModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    defaultValue = '',
    placeholder = 'Enter value...',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel'
}: PromptModalProps) {
    const [value, setValue] = useState(defaultValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) setValue(defaultValue);
    }, [isOpen, defaultValue]);

    if (!isOpen) return null;

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        const shouldClose = onConfirm(value);
        if (shouldClose !== false) onClose();
    };

    return (
        <NemotoDialog
            aria-describedby="prompt-dialog-message"
            aria-labelledby="prompt-dialog-title"
            initialFocusRef={inputRef}
            onClose={onClose}
            rootClassName="z-[10110]"
            panelClassName="w-full max-w-md flex flex-col overflow-hidden"
        >
                <form onSubmit={handleSubmit} className="p-8 flex flex-col items-center text-center">
                    <div className="nemoto-dialog-icon nemoto-dialog-icon-primary p-4 mb-6">
                        <HelpCircle size={32} />
                    </div>

                    <h3 id="prompt-dialog-title" className="text-xl font-bold text-text-main mb-3">{title}</h3>
                    <p id="prompt-dialog-message" className="text-sm text-text-muted max-w-xs mb-8 leading-relaxed">
                        {message}
                    </p>

                    <NemotoInput
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={placeholder}
                        className="nemoto-field w-full px-4 py-3 text-sm mb-8"
                    />

                    <div className="flex w-full gap-4">
                        <NemotoButton
                            type="button"
                            onClick={onClose}
                            className="flex-1 text-sm"
                        >
                            {cancelLabel}
                        </NemotoButton>
                        <NemotoButton
                            type="submit"
                            variant="primary"
                            className="flex-1 text-sm"
                        >
                            {confirmLabel}
                        </NemotoButton>
                    </div>
                </form>
        </NemotoDialog>
    );
}
