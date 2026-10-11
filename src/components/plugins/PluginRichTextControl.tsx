import { useCallback, useEffect, useRef, useState } from 'react';
import { RecordRichTextSchema, type RecordRichText } from '../../plugins/contextualRecords';
import type { PluginComposedAction } from './PluginComposedView';
import RecordRichTextEditor from './RecordRichTextEditor';

export const PLUGIN_RICH_TEXT_DEBOUNCE_MS = 250;

export interface PluginDraftFlusherRegistry {
    readonly register: (controlKey: string, flush: () => boolean) => () => void;
}

interface PluginRichTextControlProps {
    readonly controlKey: string;
    readonly actionId: string;
    readonly label: string;
    readonly value: RecordRichText;
    readonly editable: boolean;
    readonly draftRevision: number;
    readonly flushers: PluginDraftFlusherRegistry;
    readonly onDraftChange?: (action: PluginComposedAction) => void;
    readonly onDispatch?: (action: PluginComposedAction) => boolean | void;
}

export default function PluginRichTextControl({
    controlKey,
    actionId,
    label,
    value,
    editable,
    draftRevision,
    flushers,
    onDraftChange,
    onDispatch,
}: PluginRichTextControlProps) {
    const [draft, setDraft] = useState(value);
    const draftRef = useRef(value);
    const revisionRef = useRef(draftRevision);
    const lastSentRevisionRef = useRef(draftRevision);
    const dirtyRef = useRef(false);
    const composingRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const flush = useCallback(() => {
        clearTimer();
        if (!dirtyRef.current || composingRef.current
            || revisionRef.current <= lastSentRevisionRef.current) return false;
        const action: PluginComposedAction = {
            controlKey,
            actionId,
            value: draftRef.current as unknown as PluginComposedAction['value'],
            draftRevision: revisionRef.current,
        };
        if (onDispatch?.(action) === false) return false;
        lastSentRevisionRef.current = revisionRef.current;
        return true;
    }, [actionId, clearTimer, controlKey, onDispatch]);

    const scheduleFlush = useCallback(() => {
        clearTimer();
        if (composingRef.current) return;
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            flush();
        }, PLUGIN_RICH_TEXT_DEBOUNCE_MS);
    }, [clearTimer, flush]);

    useEffect(() => flushers.register(controlKey, flush), [controlKey, flush, flushers]);
    useEffect(() => clearTimer, [clearTimer]);

    useEffect(() => {
        if (dirtyRef.current && draftRevision < revisionRef.current) return;
        draftRef.current = value;
        revisionRef.current = draftRevision;
        lastSentRevisionRef.current = draftRevision;
        dirtyRef.current = false;
        setDraft(value);
    }, [draftRevision, value]);

    const updateDraft = (candidate: RecordRichText) => {
        const parsed = RecordRichTextSchema.safeParse(candidate);
        if (!parsed.success) return;
        const nextRevision = revisionRef.current + 1;
        draftRef.current = parsed.data;
        revisionRef.current = nextRevision;
        dirtyRef.current = true;
        setDraft(parsed.data);
        onDraftChange?.({
            controlKey,
            actionId,
            value: parsed.data as unknown as PluginComposedAction['value'],
            draftRevision: nextRevision,
        });
        scheduleFlush();
    };

    return (
        <div
            className="plugin-composed-field"
            data-plugin-control-key={controlKey}
            onCompositionStartCapture={() => {
                composingRef.current = true;
                clearTimer();
            }}
            onCompositionEndCapture={() => {
                composingRef.current = false;
                queueMicrotask(scheduleFlush);
            }}
        >
            <span>{label}</span>
            <RecordRichTextEditor
                ariaLabel={label}
                editable={editable}
                value={draft}
                onChange={updateDraft}
            />
        </div>
    );
}
