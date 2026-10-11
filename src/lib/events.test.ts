import { describe, expect, it } from 'vitest';
import { CanvasNodeSchema, EventDataSchema, EventTimingSchema } from './schemas';
import {
    EVENT_BEHAVIORS,
    EVENT_KINDS,
    createDefaultEventData,
    eventDateTimeFromInput,
    eventDateTimeToInput,
    formatEventTiming,
    getEventTimingValidationMessage,
    hasEventTiming,
} from './events';

describe('Event process contract', () => {
    it.each(EVENT_KINDS)('accepts the %s kind', kind => {
        expect(EventDataSchema.parse({ kind, behavior: 'neutral' })).toMatchObject({ kind, behavior: 'neutral' });
    });

    it.each(EVENT_BEHAVIORS)('accepts the %s behavior', behavior => {
        expect(EventDataSchema.parse({ kind: 'generic', behavior })).toMatchObject({ kind: 'generic', behavior });
    });

    it('creates a generic neutral Event without timing', () => {
        expect(createDefaultEventData()).toEqual({ kind: 'generic', behavior: 'neutral' });
        expect(EventDataSchema.parse({})).toMatchObject({ kind: 'generic', behavior: 'neutral' });
        expect(hasEventTiming(createDefaultEventData().timing)).toBe(false);
    });

    it('keeps process semantics separate from optional timing and extensions', () => {
        const parsed = EventDataSchema.parse({
            kind: 'condition',
            behavior: 'observed',
            timing: null,
            metadata: { threshold: 80 },
            extensions: { 'org.example.sensor': { unit: 'celsius' } },
            futureEventField: { kept: true },
        });
        expect(parsed).toMatchObject({
            kind: 'condition',
            behavior: 'observed',
            timing: null,
            metadata: { threshold: 80 },
            extensions: { 'org.example.sensor': { unit: 'celsius' } },
            futureEventField: { kept: true },
        });
    });

    it('safely degrades an Event node whose payload is missing', () => {
        expect(CanvasNodeSchema.parse({
            id: 'event-missing-payload',
            type: 'event',
            label: 'Known details later',
            position: { x: 0, y: 0 },
        })).toMatchObject({ type: 'event' });
        expect(formatEventTiming(undefined)).toBe('No timing');
    });
});

describe('Event timing facet', () => {
    it.each([
        [{ start: { kind: 'date', precision: 'year', value: '2026' } }, 'point year'],
        [{ start: { kind: 'date', precision: 'month', value: '2026-09' } }, 'point month'],
        [{ start: { kind: 'date', precision: 'day', value: '2026-09-05' } }, 'point day'],
        [{ start: { kind: 'date', precision: 'day', value: '2026-09-05' }, allDay: true }, 'all day'],
        [{
            start: { kind: 'datetime', value: '2026-09-05T08:00:00+02:00', timeZone: 'Europe/Stockholm' },
            end: { kind: 'datetime', value: '2026-09-05T09:00:00+02:00', timeZone: 'Europe/Stockholm' },
        }, 'exact interval'],
        [{ end: { kind: 'date', precision: 'day', value: '2026-09-05' } }, 'incomplete end-only timing'],
        [{}, 'empty timing facet'],
    ])('accepts %s', (timing, _label) => {
        expect(EventTimingSchema.safeParse(timing).success).toBe(true);
        expect(EventDataSchema.safeParse({ kind: 'timer', behavior: 'observed', timing }).success).toBe(true);
    });

    it.each([
        [{ start: { kind: 'date', precision: 'day', value: '2026-02-30' } }, 'invalid calendar date'],
        [{ start: { kind: 'datetime', value: '2026-09-05T08:00:00' } }, 'exact time without offset'],
        [{ start: { kind: 'datetime', value: '2026-09-05T08:00:00Z', timeZone: 'Mars/Olympus' } }, 'unknown time zone'],
        [{ allDay: true }, 'all-day timing without a calendar date'],
        [{ start: { kind: 'date', precision: 'month', value: '2026-09' }, allDay: true }, 'all-day month'],
        [{
            start: { kind: 'date', precision: 'day', value: '2026-09-06' },
            end: { kind: 'date', precision: 'day', value: '2026-09-05' },
        }, 'backwards date interval'],
        [{
            start: { kind: 'datetime', value: '2026-09-05T10:00:00Z' },
            end: { kind: 'datetime', value: '2026-09-05T09:00:00Z' },
        }, 'backwards exact interval'],
        [{
            start: { kind: 'date', precision: 'day', value: '2026-09-05' },
            end: { kind: 'datetime', value: '2026-09-05T09:00:00Z' },
        }, 'mixed interval'],
    ])('rejects %s', (timing, _label) => {
        expect(EventTimingSchema.safeParse(timing).success).toBe(false);
        expect(EventDataSchema.safeParse({ kind: 'generic', timing }).success).toBe(false);
        expect(getEventTimingValidationMessage(timing as never)).toBeTruthy();
    });

    it('keeps date-only rendering on the authored calendar day', () => {
        expect(formatEventTiming({
            start: { kind: 'date', precision: 'day', value: '2026-01-01' },
        }, 'en-CA')).toContain('Jan');
        expect(formatEventTiming({
            start: { kind: 'date', precision: 'day', value: '2026-01-01' },
        }, 'en-CA')).toContain('1');
    });

    it('round-trips exact local times across an international date boundary', () => {
        const temporal = {
            kind: 'datetime' as const,
            value: '2025-12-31T10:30:00Z',
            timeZone: 'Pacific/Kiritimati',
        };
        expect(eventDateTimeToInput(temporal)).toBe('2026-01-01T00:30');
        expect(eventDateTimeFromInput('2026-01-01T00:30', 'Pacific/Kiritimati')).toEqual({
            kind: 'datetime',
            value: '2025-12-31T10:30:00.000Z',
            timeZone: 'Pacific/Kiritimati',
        });
    });

    it('round-trips a non-whole-hour IANA offset', () => {
        expect(eventDateTimeFromInput('2026-09-05T12:15', 'Asia/Kathmandu')).toEqual({
            kind: 'datetime',
            value: '2026-09-05T06:30:00.000Z',
            timeZone: 'Asia/Kathmandu',
        });
    });

    it('rejects a skipped DST wall time and resolves an overlap deterministically', () => {
        expect(eventDateTimeFromInput('2026-03-29T02:30', 'Europe/Stockholm')).toBeNull();
        expect(eventDateTimeFromInput('2026-10-25T02:30', 'Europe/Stockholm')?.value)
            .toBe('2026-10-25T00:30:00.000Z');
    });
});
