import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Search, Copy, Download, ExternalLink, Trash2, Plus, Link, Unlink } from 'lucide-react';
import { createPortal } from 'react-dom';
import { PluginUiTreeSchema, type PluginUiNode, type PluginUiPresentation } from '../../plugins/pluginUiContracts';
import type { JsonValue } from '../../plugins/semanticData';
import { AxiomButton, AxiomDialog, AxiomInput, AxiomSelect } from '../ui';
import PluginRichTextControl, { type PluginDraftFlusherRegistry } from './PluginRichTextControl';
import '../../styles/features/plugin-composed-view.css';

export interface PluginComposedAction {
    controlKey: string;
    actionId: string;
    value: JsonValue;
    draftRevision: number | null;
    /** Host-only provenance. This property is never serialized to the guest. */
    userGesture?: boolean;
}

interface PluginComposedViewProps {
    tree: unknown;
    onAction?: (action: PluginComposedAction) => boolean | void;
    onDraftChange?: (action: PluginComposedAction) => void;
}

type NodeShape = PluginUiNode & Record<string, unknown>;

const presentationIcons = { search: Search, copy: Copy, download: Download, 'external-link': ExternalLink, trash: Trash2, plus: Plus, link: Link, unlink: Unlink };

const childrenOf = (node: NodeShape): NodeShape[] => (node.children ?? []) as NodeShape[];
const stringOf = (node: NodeShape, field: string): string => node[field] as string;
const booleanOf = (node: NodeShape, field: string): boolean => node[field] as boolean;

const gapClass = (gap: unknown): string => `plugin-composed-gap-${String(gap)}`;
const buttonVariant = (variant: unknown): 'primary' | 'default' | 'ghost' => (
    variant === 'primary' ? 'primary' : variant === 'ghost' ? 'ghost' : 'default'
);

function FieldLabel({ children, label, hidden = false }: { children: ReactNode; label: string; hidden?: boolean }) {
    return (
        <label className="plugin-composed-field">
            <span className={hidden ? 'sr-only' : undefined}>{label}</span>
            {children}
        </label>
    );
}

function DraftTextInput({ node, emit, stage, className }: { node: NodeShape; emit: (value: string) => unknown; stage: (value: string) => void; className?: string }) {
    const incoming = stringOf(node, 'value');
    const [value, setValue] = useState(incoming);
    const pending = useRef<string[]>([]);
    const composing = useRef(false);
    useEffect(() => {
        const acknowledged = pending.current.lastIndexOf(incoming);
        if (acknowledged >= 0) pending.current.splice(0, acknowledged + 1);
        if (!pending.current.length && !composing.current) setValue(incoming);
    }, [incoming]);
    const send = (next: string) => {
        // The session independently bounds dispatch. Keep only bounded local
        // acknowledgement history while preserving the latest visible draft.
        pending.current.push(next);
        if (pending.current.length > 32) pending.current.shift();
        emit(next);
    };
    return <AxiomInput data-plugin-control-key={node.key}
        aria-label={stringOf(node, 'label')}
        placeholder={node.placeholder as string | undefined}
        title={node.title as string | undefined}
        disabled={booleanOf(node, 'disabled')} maxLength={node.maxLength as number}
        required={booleanOf(node, 'required')} value={value}
        className={clsx('w-full', className)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={event => { composing.current = false; send(event.currentTarget.value); }}
        onChange={event => {
            const next = event.currentTarget.value;
            setValue(next);
            stage(next);
            if (!composing.current) send(next);
        }} />;
}

function ComposedNode({ node, onAction, onDraftDispatch, onDraftChange, flushers, presentation = {} }: {
    node: NodeShape;
    onAction?: (action: PluginComposedAction) => boolean | void;
    onDraftDispatch?: (action: PluginComposedAction) => boolean | void;
    onDraftChange?: (action: PluginComposedAction) => void;
    flushers: PluginDraftFlusherRegistry;
    presentation?: PluginUiPresentation;
}) {
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const emit = (value: JsonValue, draftRevision: number | null = null, userGesture = false) => onAction?.({
        controlKey: node.key,
        actionId: stringOf(node, 'actionId'),
        value,
        draftRevision,
        ...(userGesture ? { userGesture: true } : {}),
    });

    const Icon = presentation.icon ? presentationIcons[presentation.icon] : null;
    switch (node.type) {
        case 'presentation': {
            const tokens = node.presentation as PluginUiPresentation;
            const attributes = Object.fromEntries(Object.entries(tokens)
                .filter(([key]) => key !== 'placeholder' && key !== 'accessibleLabel')
                .map(([key, value]) => [`data-ui-${key.toLowerCase()}`, String(value)]));
            const child: NodeShape = tokens.layout ? {
                type: 'stack', key: `${node.key}.layout`, direction: tokens.layout === 'row' ? 'horizontal' : 'vertical',
                gap: tokens.gap ?? 'small', wrap: tokens.wrap ?? false, children: childrenOf(node),
            } : childrenOf(node)[0];
            return <div className="plugin-presentation" {...attributes} data-plugin-control-key={node.key}>
                <ComposedNode node={child} presentation={tokens} onAction={onAction}
                    onDraftDispatch={onDraftDispatch} onDraftChange={onDraftChange} flushers={flushers} />
            </div>;
        }
        case 'form': {
            return <div role="form" aria-label={stringOf(node, 'label')} data-plugin-control-key={node.key}
                className="plugin-composed-stack plugin-composed-stack-vertical plugin-composed-gap-small"
                onKeyDown={event => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229
                        || booleanOf(node, 'disabled') || !(event.target instanceof HTMLInputElement)
                        || !['text', 'date'].includes(event.target.type)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    emit(null, null, true);
                }}>
                {childrenOf(node).map(child => <ComposedNode key={child.key} node={child} onAction={onAction} onDraftDispatch={onDraftDispatch} onDraftChange={onDraftChange} flushers={flushers} />)}
            </div>;
        }
        case 'stack': {
            return (
                <div
                    data-plugin-control-key={node.key}
                    className={`plugin-composed-stack plugin-composed-stack-${stringOf(node, 'direction')} ${gapClass(node.gap)}`}
                    data-wrap={booleanOf(node, 'wrap')}
                >
                    {childrenOf(node).map(child => <ComposedNode key={child.key} node={child} onAction={onAction} onDraftDispatch={onDraftDispatch} onDraftChange={onDraftChange} flushers={flushers} />)}
                </div>
            );
        }
        case 'grid': {
            const columns = node.columns as { compact: number; wide: number };
            return (
                <div
                    data-plugin-control-key={node.key}
                    className={`plugin-composed-grid plugin-composed-grid-compact-${columns.compact} plugin-composed-grid-wide-${columns.wide} ${gapClass(node.gap)}`}
                >
                    {childrenOf(node).map(child => <ComposedNode key={child.key} node={child} onAction={onAction} onDraftDispatch={onDraftDispatch} onDraftChange={onDraftChange} flushers={flushers} />)}
                </div>
            );
        }
        case 'text': {
            const className = `plugin-composed-text plugin-composed-text-${stringOf(node, 'role')} plugin-composed-tone-${stringOf(node, 'tone')}`;
            if (node.role === 'heading') return <h2 data-plugin-control-key={node.key} className={className}>{stringOf(node, 'text')}</h2>;
            if (node.role === 'status') return <p data-plugin-control-key={node.key} className={className} role="status">{stringOf(node, 'text')}</p>;
            return <p data-plugin-control-key={node.key} className={className}>{stringOf(node, 'text')}</p>;
        }
        case 'button': {
            return (
                <AxiomButton
                    data-plugin-control-key={node.key}
                    disabled={booleanOf(node, 'disabled')}
                    icon={presentation.control === 'icon'}
                    size={presentation.control === 'segment' || presentation.control === 'icon' ? 'sm' : 'default'}
                    variant={buttonVariant(node.variant)}
                    aria-label={presentation.accessibleLabel ?? stringOf(node, 'label')}
                    title={presentation.control === 'icon' ? stringOf(node, 'label') : undefined}
                    aria-pressed={presentation.selected}
                    onClick={() => emit(null, null, true)}
                >
                    {Icon && <Icon size={16} aria-hidden="true" />}
                    <span className={presentation.control === 'icon' ? 'sr-only' : undefined}>{stringOf(node, 'label')}</span>
                </AxiomButton>
            );
        }
        case 'text-input': {
            return (
                <FieldLabel label={stringOf(node, 'label')} hidden={presentation.label === 'hidden'}>
                    {Icon && <Icon size={16} className="plugin-field-icon" aria-hidden="true" />}
                    <DraftTextInput node={{ ...node, placeholder: presentation.placeholder }} emit={emit} stage={value => onDraftChange?.({
                        controlKey: node.key, actionId: stringOf(node, 'actionId'), value, draftRevision: null,
                    })} />
                </FieldLabel>
            );
        }
        case 'date-input': {
            return (
                <FieldLabel label={stringOf(node, 'label')} hidden={presentation.label === 'hidden'}>
                    <AxiomInput
                        data-plugin-control-key={node.key}
                        disabled={booleanOf(node, 'disabled')}
                        required={booleanOf(node, 'required')}
                        type="date"
                        value={stringOf(node, 'value')}
                        onChange={event => emit(event.currentTarget.value)}
                    />
                </FieldLabel>
            );
        }
        case 'checkbox': {
            return (
                <label className="plugin-composed-checkbox">
                    <input
                        checked={booleanOf(node, 'checked')}
                        data-plugin-control-key={node.key}
                        disabled={booleanOf(node, 'disabled')}
                        type="checkbox"
                        onChange={event => emit(event.currentTarget.checked)}
                    />
                    <span className={presentation.label === 'hidden' ? 'sr-only' : undefined}>{stringOf(node, 'label')}</span>
                </label>
            );
        }
        case 'select': {
            const select = (
                <AxiomSelect
                    aria-label={presentation.accessibleLabel ?? stringOf(node, 'label')}
                    data-plugin-control-key={node.key}
                    disabled={booleanOf(node, 'disabled')}
                    value={stringOf(node, 'value')}
                    onChange={event => emit(event.currentTarget.value)}
                >
                    {(node.options as Array<{ value: string; label: string }>).map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </AxiomSelect>
            );
            return (
                <FieldLabel label={stringOf(node, 'label')} hidden={presentation.label === 'hidden'}>
                    {select}
                </FieldLabel>
            );
        }
        case 'list':
            return (
                <div aria-label={stringOf(node, 'label')} data-plugin-control-key={node.key} className="plugin-composed-list" role="list">
                    {childrenOf(node).map(child => (
                        <div key={child.key} className="plugin-composed-list-item" role="listitem">
                            <ComposedNode node={child} onAction={onAction} onDraftDispatch={onDraftDispatch} onDraftChange={onDraftChange} flushers={flushers} />
                        </div>
                    ))}
                </div>
            );
        case 'dialog': {
            const titleId = `plugin-composed-dialog-${node.key}`;
            const close = () => onAction?.({ controlKey: node.key,
                actionId: stringOf(node, 'closeActionId'), value: null, draftRevision: null });
            return createPortal(
                <>
                <AxiomDialog
                    aria-labelledby={titleId}
                    closeOnBackdrop={!booleanOf(node, 'dirty')}
                    onClose={() => booleanOf(node, 'dirty') ? setConfirmDiscard(true) : close()}
                    panelClassName="plugin-composed-dialog"
                >
                    <h2 id={titleId} className="plugin-composed-dialog-title">{stringOf(node, 'label')}</h2>
                    <div className="plugin-composed-dialog-body">
                        {childrenOf(node)
                            .map(child => <ComposedNode key={child.key} node={child} onAction={onAction} onDraftDispatch={onDraftDispatch} onDraftChange={onDraftChange} flushers={flushers} />)}
                    </div>
                </AxiomDialog>
                {confirmDiscard && <AxiomDialog aria-labelledby="plugin-discard-title"
                    closeOnBackdrop={false} onClose={() => setConfirmDiscard(false)}>
                    <h2 id="plugin-discard-title">Discard unsaved changes?</h2>
                    <p>The unsaved changes in this dialog will be lost.</p>
                    <AxiomButton onClick={() => setConfirmDiscard(false)}>Keep editing</AxiomButton>
                    <AxiomButton variant="danger" onClick={() => { setConfirmDiscard(false); close(); }}>Discard changes</AxiomButton>
                </AxiomDialog>}
                </>,
                document.body,
            );
        }
        case 'rich-text':
            return (
                <PluginRichTextControl
                    actionId={stringOf(node, 'actionId')}
                    controlKey={node.key}
                    draftRevision={node.draftRevision as number}
                    editable={booleanOf(node, 'editable')}
                    flushers={flushers}
                    label={stringOf(node, 'label')}
                    onDispatch={onDraftDispatch}
                    onDraftChange={onDraftChange}
                    value={node.value as Parameters<typeof PluginRichTextControl>[0]['value']}
                />
            );
        default:
            return null;
    }
}

/** Renders only the closed, host-owned P02 vocabulary. No effects are applied here. */
export default function PluginComposedView({ tree, onAction, onDraftChange }: PluginComposedViewProps) {
    const draftFlushers = useRef(new Map<string, () => boolean>());
    const flushers = useMemo<PluginDraftFlusherRegistry>(() => ({
        register: (controlKey, flush) => {
            draftFlushers.current.set(controlKey, flush);
            return () => {
                if (draftFlushers.current.get(controlKey) === flush) draftFlushers.current.delete(controlKey);
            };
        },
    }), []);
    const dispatch = useCallback((action: PluginComposedAction) => {
        draftFlushers.current.forEach(flush => flush());
        return onAction?.(action);
    }, [onAction]);
    const parsed = PluginUiTreeSchema.safeParse(tree);
    if (!parsed.success) {
        return (
            <div className="plugin-composed-error" role="alert">
                Plugin view returned an unsupported layout.
            </div>
        );
    }

    const isOverlayOnly = (parsed.data.children ?? []).length > 0 && (parsed.data.children ?? []).every(c => c.type === 'dialog');
    if (isOverlayOnly) {
        return (
            <ComposedNode node={parsed.data as NodeShape} onAction={dispatch} onDraftDispatch={onAction} onDraftChange={onDraftChange} flushers={flushers} />
        );
    }

    return (
        <div className="plugin-composed-view" data-testid="plugin-composed-view">
            <ComposedNode node={parsed.data as NodeShape} onAction={dispatch} onDraftDispatch={onAction} onDraftChange={onDraftChange} flushers={flushers} />
        </div>
    );
}
