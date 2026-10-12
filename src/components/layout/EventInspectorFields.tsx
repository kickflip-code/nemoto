import { useEffect, useMemo, useState } from 'react';
import {
    EVENT_BEHAVIORS,
    EVENT_BEHAVIOR_LABELS,
    EVENT_KINDS,
    EVENT_KIND_LABELS,
    createDefaultEventData,
    eventDateTimeFromInput,
    eventDateTimeToInput,
    getEventTimingValidationMessage,
    getLocalTimeZone,
} from '../../lib/events';
import type {
    CanvasNode,
    EventBehavior,
    EventData,
    EventDatePrecision,
    EventKind,
    EventTemporalValue,
    EventTiming,
} from '../../types';

type EditingPrecision = EventDatePrecision | 'datetime';

const temporalPrecision = (timing: EventTiming | null | undefined): EditingPrecision => {
    const value = timing?.start || timing?.end;
    return value?.kind === 'datetime' ? 'datetime' : value?.precision || 'day';
};

const temporalInputValue = (value: EventTemporalValue | null | undefined): string => {
    if (!value) return '';
    return value.kind === 'datetime' ? eventDateTimeToInput(value) : value.value;
};

const temporalFromInput = (
    input: string,
    precision: EditingPrecision,
    previous: EventTemporalValue | null | undefined,
    timeZone: string,
): EventTemporalValue | null | 'invalid' => {
    if (!input) return null;
    if (precision === 'datetime') {
        const converted = eventDateTimeFromInput(input, timeZone);
        if (!converted) return 'invalid';
        return previous?.kind === 'datetime' ? { ...previous, ...converted } : converted;
    }
    return previous?.kind === 'date'
        ? { ...previous, kind: 'date', precision, value: input }
        : { kind: 'date', precision, value: input };
};

const withoutTemporalFields = (timing: EventTiming): Record<string, unknown> => {
    const preserved = { ...timing };
    delete preserved.start;
    delete preserved.end;
    delete preserved.allDay;
    return preserved;
};

export function EventInspectorFields({
    node,
    onChange,
}: {
    node: CanvasNode;
    onChange: (event: EventData) => void;
}) {
    const event: EventData = { ...createDefaultEventData(), ...(node.event || {}) };
    const timing = event.timing || undefined;
    const [timingExpanded, setTimingExpanded] = useState(() => !!timing);
    const [precision, setPrecision] = useState<EditingPrecision>(() => temporalPrecision(timing));
    const [startDraft, setStartDraft] = useState(() => temporalInputValue(timing?.start));
    const [endDraft, setEndDraft] = useState(() => temporalInputValue(timing?.end));
    const [feedback, setFeedback] = useState<string | null>(null);
    const timeZone = useMemo(() => {
        const exact = [timing?.start, timing?.end].find(value => value?.kind === 'datetime');
        return exact?.kind === 'datetime' && exact.timeZone ? exact.timeZone : getLocalTimeZone();
    }, [timing?.end, timing?.start]);

    useEffect(() => {
        setTimingExpanded(!!node.event?.timing);
    }, [node.id]);

    useEffect(() => {
        const nextTiming = node.event?.timing;
        if (nextTiming) setTimingExpanded(true);
        setPrecision(temporalPrecision(nextTiming));
        setStartDraft(temporalInputValue(nextTiming?.start));
        setEndDraft(temporalInputValue(nextTiming?.end));
        setFeedback(null);
    }, [node.id, node.event?.timing]);

    const commitTiming = (nextStart = startDraft, nextEnd = endDraft, nextAllDay = !!timing?.allDay) => {
        const start = temporalFromInput(nextStart, precision, timing?.start, timeZone);
        const end = temporalFromInput(nextEnd, precision, timing?.end, timeZone);
        if (start === 'invalid' || end === 'invalid') {
            setFeedback('That local time does not exist in the selected time zone.');
            return;
        }

        const nextTiming: EventTiming = {
            ...(timing || {}),
            start,
            end,
            allDay: precision === 'day' ? nextAllDay : false,
        };
        const validationMessage = getEventTimingValidationMessage(nextTiming);
        setFeedback(validationMessage);
        if (validationMessage) return;

        const hasPreservedFields = Object.keys(withoutTemporalFields(nextTiming)).length > 0;
        onChange({
            ...event,
            timing: start || end || nextTiming.allDay || hasPreservedFields ? nextTiming : null,
        });
    };

    const changePrecision = (nextPrecision: EditingPrecision) => {
        setPrecision(nextPrecision);
        setStartDraft('');
        setEndDraft('');
        setFeedback(null);

        if (timing) {
            const preserved = withoutTemporalFields(timing);
            onChange({
                ...event,
                timing: Object.keys(preserved).length > 0 ? preserved as EventTiming : null,
            });
        }
    };

    const inputType = precision === 'datetime'
        ? 'datetime-local'
        : precision === 'year'
            ? 'number'
            : precision;

    return (
        <section aria-labelledby="event-details-title" className="space-y-3">
            <label id="event-details-title" className="text-[10px] font-bold uppercase text-text-faint tracking-wider block">
                Event Details
            </label>

            <div className="space-y-1">
                <label htmlFor={`event-kind-${node.id}`} className="text-[10px] text-text-faint">Event Kind</label>
                <select
                    id={`event-kind-${node.id}`}
                    aria-label="Event kind"
                    className="nemoto-field nemoto-field-sm w-full appearance-none"
                    value={event.kind}
                    onChange={change => onChange({ ...event, kind: change.target.value as EventKind })}
                >
                    {EVENT_KINDS.map(kind => <option key={kind} value={kind}>{EVENT_KIND_LABELS[kind]}</option>)}
                </select>
            </div>

            <div className="space-y-1">
                <label htmlFor={`event-behavior-${node.id}`} className="text-[10px] text-text-faint">Behavior</label>
                <select
                    id={`event-behavior-${node.id}`}
                    aria-label="Event behavior"
                    className="nemoto-field nemoto-field-sm w-full appearance-none"
                    value={event.behavior || 'neutral'}
                    onChange={change => onChange({ ...event, behavior: change.target.value as EventBehavior })}
                >
                    {EVENT_BEHAVIORS.map(behavior => (
                        <option key={behavior} value={behavior}>{EVENT_BEHAVIOR_LABELS[behavior]}</option>
                    ))}
                </select>
            </div>

            <button
                type="button"
                className="nemoto-button nemoto-button-sm nemoto-button-ghost flex w-full items-center justify-between"
                aria-expanded={timingExpanded}
                aria-controls={`event-timing-${node.id}`}
                onClick={() => setTimingExpanded(expanded => !expanded)}
            >
                <span>Timing</span>
                <span className="text-[9px] text-text-faint">{timing ? 'Configured' : 'Optional'}</span>
            </button>

            {timingExpanded && (
                <div id={`event-timing-${node.id}`} className="space-y-3 border-l border-app-border pl-3">
                    <div className="space-y-1">
                        <label htmlFor={`event-precision-${node.id}`} className="text-[10px] text-text-faint">Precision</label>
                        <select
                            id={`event-precision-${node.id}`}
                            aria-label="Event date precision"
                            className="nemoto-field nemoto-field-sm w-full appearance-none"
                            value={precision}
                            onChange={change => changePrecision(change.target.value as EditingPrecision)}
                        >
                            <option value="year">Year</option>
                            <option value="month">Month</option>
                            <option value="day">Day</option>
                            <option value="datetime">Exact time</option>
                        </select>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                        <label className="space-y-1 text-[10px] text-text-faint">
                            <span>Start (optional)</span>
                            <input
                                aria-label="Event start"
                                type={inputType}
                                className="nemoto-field nemoto-field-sm w-full"
                                value={startDraft}
                                onChange={change => setStartDraft(change.target.value)}
                                onBlur={() => commitTiming()}
                            />
                        </label>
                        <label className="space-y-1 text-[10px] text-text-faint">
                            <span>End (optional)</span>
                            <input
                                aria-label="Event end"
                                type={inputType}
                                className="nemoto-field nemoto-field-sm w-full"
                                value={endDraft}
                                min={startDraft || undefined}
                                onChange={change => setEndDraft(change.target.value)}
                                onBlur={() => commitTiming()}
                            />
                        </label>
                    </div>
                    {precision === 'day' && (
                        <label className="flex items-center gap-2 text-[10px] text-text-muted">
                            <input
                                aria-label="All-day event"
                                type="checkbox"
                                checked={!!timing?.allDay}
                                onChange={change => commitTiming(startDraft, endDraft, change.target.checked)}
                            />
                            All-day event
                        </label>
                    )}
                    {precision === 'datetime' && (
                        <p className="text-[9px] leading-relaxed text-text-faint">Time zone: {timeZone}</p>
                    )}
                    {feedback && <p role="alert" className="text-[10px] leading-relaxed text-accent-danger">{feedback}</p>}
                    <button
                        type="button"
                        className="text-[10px] font-semibold text-text-faint hover:text-accent-primary"
                        onClick={() => {
                            setStartDraft('');
                            setEndDraft('');
                            setFeedback(null);
                            onChange({ ...event, timing: null });
                        }}
                    >
                        Remove timing
                    </button>
                    <p className="text-[9px] leading-relaxed text-text-faint">
                        Timing is optional and does not define the Event. Leave End empty for a point in time.
                    </p>
                </div>
            )}
        </section>
    );
}
