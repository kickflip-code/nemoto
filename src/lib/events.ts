import type {
    EventData,
    EventBehavior,
    EventDatePrecision,
    EventDateTimeValue,
    EventKind,
    EventTiming,
    EventTemporalValue,
} from '../types';

const YEAR_PATTERN = /^(\d{4})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const pad = (value: number): string => String(value).padStart(2, '0');

export const EVENT_KINDS: EventKind[] = [
    'generic', 'message', 'signal', 'condition', 'timer', 'error', 'milestone',
];
export const EVENT_BEHAVIORS: EventBehavior[] = ['observed', 'emitted', 'neutral'];

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
    generic: 'Generic',
    message: 'Message',
    signal: 'Signal',
    condition: 'Condition',
    timer: 'Timer',
    error: 'Error',
    milestone: 'Milestone',
};

export const EVENT_BEHAVIOR_LABELS: Record<EventBehavior, string> = {
    observed: 'Observed',
    emitted: 'Emitted',
    neutral: 'Neutral',
};

export const isEventKind = (value: unknown): value is EventKind => EVENT_KINDS.includes(value as EventKind);
export const isEventBehavior = (value: unknown): value is EventBehavior => EVENT_BEHAVIORS.includes(value as EventBehavior);
export const resolveEventKind = (event: EventData | null | undefined): EventKind => isEventKind(event?.kind) ? event.kind : 'generic';
export const resolveEventBehavior = (event: EventData | null | undefined): EventBehavior => isEventBehavior(event?.behavior) ? event.behavior : 'neutral';

export function isValidIanaTimeZone(value: string): boolean {
    try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
        return true;
    } catch {
        return false;
    }
}

export function isValidEventDateValue(value: string, precision: EventDatePrecision): boolean {
    if (precision === 'year') return YEAR_PATTERN.test(value) && value !== '0000';
    if (precision === 'month') {
        const match = MONTH_PATTERN.exec(value);
        return !!match && match[1] !== '0000' && Number(match[2]) >= 1 && Number(match[2]) <= 12;
    }

    const match = DAY_PATTERN.exec(value);
    if (!match || match[1] === '0000') return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1) return false;
    return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidEventDateTimeValue(value: string): boolean {
    return RFC3339_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function compareTemporalValues(start: EventTemporalValue, end: EventTemporalValue): number | null {
    if (start.kind !== end.kind) return null;
    if (start.kind === 'date' && end.kind === 'date') {
        if (start.precision !== end.precision) return null;
        return start.value.localeCompare(end.value);
    }
    if (start.kind === 'datetime' && end.kind === 'datetime') {
        return Date.parse(start.value) - Date.parse(end.value);
    }
    return null;
}

export function getEventTimingValidationMessage(timing: EventTiming): string | null {
    const values = [timing.start, timing.end].filter((value): value is EventTemporalValue => !!value);

    for (const value of values) {
        if (value.kind === 'date') {
            if (!isValidEventDateValue(value.value, value.precision)) {
                return `Event ${value.precision} value is not a valid calendar date.`;
            }
        } else if (value.kind === 'datetime') {
            if (!isValidEventDateTimeValue(value.value)) {
                return 'Exact event times must be RFC 3339 values with an explicit offset or Z.';
            }
            if (value.timeZone && !isValidIanaTimeZone(value.timeZone)) {
                return `Event time zone "${value.timeZone}" is not a valid IANA time zone.`;
            }
        } else {
            return 'Event temporal values must be date or datetime values.';
        }
    }

    if (timing.allDay && (values.length === 0 || values.some(value => value.kind !== 'date' || value.precision !== 'day'))) {
        return 'All-day events require day-precision date values.';
    }

    if (timing.start && timing.end) {
        const comparison = compareTemporalValues(timing.start, timing.end);
        if (comparison === null) {
            return 'Event start and end must use the same temporal kind and precision.';
        }
        if (comparison > 0) return 'Event end cannot be earlier than its start.';
    }

    return null;
}

export function getEventValidationMessage(event: EventData): string | null {
    return event.timing ? getEventTimingValidationMessage(event.timing) : null;
}

export function getLocalTimeZone(): string {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved && isValidIanaTimeZone(resolved) ? resolved : 'UTC';
}

export function createDefaultEventData(): EventData {
    return {
        kind: 'generic',
        behavior: 'neutral',
    };
}

const dateForLexicalValue = (value: string): Date => {
    const [year, month = 1, day = 1] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
};

export function formatEventTemporalValue(
    temporal: EventTemporalValue,
    locale?: string,
): string {
    if (temporal.kind === 'date') {
        if (!isValidEventDateValue(temporal.value, temporal.precision)) return 'Invalid date';
        if (temporal.precision === 'year') return temporal.value;
        const date = dateForLexicalValue(temporal.value);
        return new Intl.DateTimeFormat(locale, temporal.precision === 'month'
            ? { year: 'numeric', month: 'short', timeZone: 'UTC' }
            : { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
    }

    if (!isValidEventDateTimeValue(temporal.value)) return 'Invalid time';
    const timeZone = temporal.timeZone && isValidIanaTimeZone(temporal.timeZone)
        ? temporal.timeZone
        : undefined;
    return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        ...(timeZone ? { timeZone } : {}),
    }).format(new Date(temporal.value));
}

export function hasEventTiming(timing: EventTiming | null | undefined): boolean {
    return !!(timing?.start || timing?.end);
}

export function formatEventTiming(timing: EventTiming | null | undefined, locale?: string): string {
    if (!hasEventTiming(timing)) return 'No timing';
    const prefix = timing?.allDay ? 'All day · ' : '';
    if (timing?.start && !timing.end) return `${prefix}${formatEventTemporalValue(timing.start, locale)}`;
    if (!timing?.start && timing?.end) return `${prefix}Until ${formatEventTemporalValue(timing.end, locale)}`;
    return `${prefix}${formatEventTemporalValue(timing!.start!, locale)} – ${formatEventTemporalValue(timing!.end!, locale)}`;
}

function partsInTimeZone(date: Date, timeZone: string): Record<string, number> {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    return Object.fromEntries(parts
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)]));
}

export function eventDateTimeToInput(value: EventDateTimeValue): string {
    if (!isValidEventDateTimeValue(value.value)) return '';
    const timeZone = value.timeZone && isValidIanaTimeZone(value.timeZone) ? value.timeZone : getLocalTimeZone();
    const parts = partsInTimeZone(new Date(value.value), timeZone);
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Converts a wall-clock input in an IANA zone to one stable RFC 3339 UTC instant. */
export function eventDateTimeFromInput(input: string, timeZone = getLocalTimeZone()): EventDateTimeValue | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input);
    if (!match || !isValidIanaTimeZone(timeZone)) return null;
    const desired = {
        year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
        hour: Number(match[4]), minute: Number(match[5]), second: 0,
    };
    if (!isValidEventDateValue(`${match[1]}-${match[2]}-${match[3]}`, 'day') || desired.hour > 23 || desired.minute > 59) {
        return null;
    }

    const wallUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute);
    const candidates = new Set<number>();
    // IANA offsets are not always whole hours (for example, Asia/Kathmandu is
    // UTC+05:45), so search at quarter-hour granularity.
    for (let offsetMinutes = -18 * 60; offsetMinutes <= 18 * 60; offsetMinutes += 15) {
        candidates.add(wallUtc + offsetMinutes * 60 * 1000);
    }
    const matching = [...candidates].filter(candidate => {
        const parts = partsInTimeZone(new Date(candidate), timeZone);
        return parts.year === desired.year && parts.month === desired.month && parts.day === desired.day
            && parts.hour === desired.hour && parts.minute === desired.minute;
    }).sort((a, b) => a - b);

    // A daylight-saving overlap resolves deterministically to the earlier instant;
    // a skipped local time returns null and is rejected by the editor.
    return matching.length > 0
        ? { kind: 'datetime', value: new Date(matching[0]).toISOString(), timeZone }
        : null;
}
