import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motion } from 'framer-motion';
import { dialogOverlayMotion, dialogPanelMotion } from '../../lib/motion';
import { NemotoDialogContext } from '../ui/NemotoDialog';

interface PowerViewModalProps {
    title: string;
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    actions?: React.ReactNode;
}

export default function PowerViewModal({ title, isOpen, onClose, children, actions }: PowerViewModalProps) {
    if (!isOpen) return null;

    return createPortal(
        <NemotoDialogContext.Provider value={1}>
        <motion.div
            {...dialogOverlayMotion}
            className="fixed inset-0 z-[10100] flex items-center justify-center"
        >
            <div className="nemoto-dialog-backdrop absolute inset-0" onClick={onClose} />
            <motion.div
                {...dialogPanelMotion}
                className="nemoto-dialog-panel relative w-[90vw] h-[85vh] flex flex-col overflow-hidden"
            >
                {/* Header */}
                <div className="nemoto-dialog-header h-16 px-6 border-b flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        <h2 className="text-xl font-bold tracking-tight text-text-main">{title}</h2>
                        {actions && <div className="h-6 w-px bg-app-border mx-2" />}
                        {actions}
                    </div>
                    <button
                        aria-label={`Close ${title}`}
                        onClick={onClose}
                        className="nemoto-icon-button nemoto-icon-button-ghost"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="nemoto-dialog-body flex-1 overflow-hidden relative">
                    {children}
                </div>
            </motion.div>
        </motion.div>
        </NemotoDialogContext.Provider>,
        document.body,
    );
}
