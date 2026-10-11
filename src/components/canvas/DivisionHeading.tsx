import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export function DivisionHeading({ label, kind, style, className, onSelect, onRename }: {
    label: string; kind: string; style: CSSProperties; className: string;
    onSelect: () => void; onRename?: (name: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(label);
    const button = useRef<HTMLButtonElement>(null);
    const cancelled = useRef(false);
    const restoreFocus = useRef(false);
    useLayoutEffect(() => {
        if (!editing && restoreFocus.current) { button.current?.focus(); restoreFocus.current = false; }
    }, [editing]);
    const start = () => { if (onRename) { cancelled.current = false; setDraft(label); setEditing(true); } };
    const finish = () => {
        if (!cancelled.current && draft.trim() && draft.trim() !== label) onRename?.(draft.trim());
        setEditing(false);
    };
    return editing ? <input autoFocus aria-label={`Name of ${kind}`} value={draft}
        style={style} className={`${className} axiom-division-name`}
        onFocus={e => e.target.select()} onClick={e => e.stopPropagation()}
        onChange={e => setDraft(e.target.value)} onBlur={finish}
        onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault(); cancelled.current = e.key === 'Escape'; restoreFocus.current = true; finish();
            }
        }} /> : <button ref={button} type="button" style={style} className={className}
        aria-label={`Edit ${kind}: ${label}`} title="Double-click or press F2 to rename"
        onClick={e => { e.stopPropagation(); onSelect(); }}
        onDoubleClick={e => { e.stopPropagation(); start(); }}
        onKeyDown={e => { if (e.key === 'F2' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); start(); } }}>
        <span className="axiom-division-accent" aria-hidden="true" /><span className="axiom-division-label">{label}</span>
    </button>;
}
