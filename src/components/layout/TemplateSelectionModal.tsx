import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Workflow, X } from 'lucide-react';
import type { CanvasMode } from '../../types';
import { NemotoButton, NemotoDialog } from '../ui';
interface Props {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (name: string, mode: CanvasMode) => void;
    folderName?: string | null;
}
export default function TemplateSelectionModal({ isOpen, onClose, onCreate, folderName }: Props) {
    const [name, setName] = useState('');
    const nameInputRef = useRef<HTMLInputElement>(null);
    if (!isOpen) return null;
    const create = () => { if (name.trim()) { onCreate(name.trim(), 'blank'); setName(''); } };
    return createPortal(<NemotoDialog aria-labelledby="new-process-title" initialFocusRef={nameInputRef} onClose={onClose}
        panelClassName="bg-app-surface text-text-main border border-app-border rounded-2xl w-[480px] max-w-[95vw] overflow-hidden shadow-soft-down">
        <div className="flex items-start gap-4 px-6 pt-6 pb-4">
            <div className="rounded-xl bg-accent-primary/10 text-accent-primary p-3 shrink-0"><Workflow size={24} /></div>
            <div className="flex-1 min-w-0">
                <h2 id="new-process-title" className="text-xl font-bold leading-tight mb-1.5">New Process</h2>
                <p className="text-xs text-text-muted leading-relaxed">{folderName ? `Create in folder ${folderName}.` : 'Start with a name and build your workflow.'}</p>
            </div>
            <NemotoButton icon size="sm" variant="ghost" aria-label="Close new process dialog" onClick={onClose}><X size={16} /></NemotoButton>
        </div>
        <div className="px-6 pb-6 pt-2">
            <label htmlFor="new-process-name" className="block text-xs font-semibold text-text-muted mb-2">Process Name</label>
            <input id="new-process-name" ref={nameInputRef} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Order Fulfillment"
                className="nemoto-field w-full" onKeyDown={e => { if (e.key === 'Enter') create(); }} />
            <p className="text-xs text-text-muted leading-relaxed mt-4">Start with a blank canvas. Enable rows and columns using the icons in the floating toolbar whenever you need them.</p>
        </div>
        <div className="flex flex-wrap gap-3 justify-end items-center px-6 py-4 border-t border-app-border bg-app-sidebar/30">
            <NemotoButton variant="ghost" onClick={onClose}>Cancel</NemotoButton>
            <NemotoButton variant="primary" disabled={!name.trim()} onClick={create}><Plus size={16} /><span>Create Process</span></NemotoButton>
        </div>
    </NemotoDialog>, document.body);
}
