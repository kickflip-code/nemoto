import { describe, expect, it } from 'vitest';
import { emptyPortfolio } from '../stores/slices/coreSlice';
import type { Portfolio } from '../types';
import { CURRENT_PORTFOLIO_SCHEMA_VERSION } from './import/migrate';
import { decodePortfolioJson, decodePortfolioValue, serializePortfolioEnvelope } from './portfolioCodec';
import { listEntityCandidates } from './entityResolver';

const eventPortfolio = (): Portfolio => {
    const portfolio = structuredClone(emptyPortfolio);
    portfolio.schemaVersion = CURRENT_PORTFOLIO_SCHEMA_VERSION;
    portfolio.processes = [{
        id: 'process-events',
        title: 'Events',
        createdAt: '2026-09-05T12:00:00.000Z',
        updatedAt: '2026-09-05T12:00:00.000Z',
        mode: 'blank',
        graph: {
            nodes: [{
                id: 'event-1',
                type: 'event',
                label: 'Payment confirmed',
                position: { x: 64, y: 96 },
                data: { description: 'Coordinated release.' },
                event: {
                    kind: 'message',
                    behavior: 'observed',
                    timing: {
                        start: { kind: 'datetime', value: '2026-09-06T22:00:00Z', timeZone: 'Europe/Stockholm' },
                        end: { kind: 'datetime', value: '2026-09-07T00:00:00Z', timeZone: 'Europe/Stockholm' },
                        extensions: { 'org.example.timing': { confidence: 'exact' } },
                    },
                    metadata: { owner: 'operations' },
                    extensions: { 'org.example.process': { externalId: 'evt-42' } },
                    futureEventField: { kept: true },
                },
                extensions: { 'org.example.audit': { status: 'approved' } },
            }],
            edges: [],
            swimlanes: [],
        },
    }];
    return portfolio;
};

describe('Event portfolio lifecycle', () => {
    it('serializes and fully round-trips Event data and namespaced extensions', () => {
        const source = eventPortfolio();
        const decoded = decodePortfolioJson(serializePortfolioEnvelope(source));
        expect(decoded.portfolio.processes[0].graph.nodes[0]).toEqual(
            source.processes[0].graph.nodes[0],
        );
        expect(decoded.integrity.errors).toEqual([]);
    });

    it('migrates an older portfolio without Event nodes without manual action', () => {
        const legacy = eventPortfolio();
        legacy.schemaVersion = 2;
        legacy.processes[0].graph.nodes = [{
            id: 'action-1', type: 'action', label: 'Existing step', position: { x: 0, y: 0 },
        }];
        const decoded = decodePortfolioValue(legacy);
        expect(decoded.portfolio.schemaVersion).toBe(CURRENT_PORTFOLIO_SCHEMA_VERSION);
        expect(decoded.portfolio.processes[0].graph.nodes).toEqual(legacy.processes[0].graph.nodes);
    });

    it('moves the unfinished root timing fields into the optional timing facet', () => {
        const interim = structuredClone(eventPortfolio()) as any;
        interim.processes[0].graph.nodes[0].event = {
            start: { kind: 'date', precision: 'day', value: '2026-09-05' },
            allDay: true,
            metadata: { owner: 'operations' },
            extensions: { 'org.example.process': { kept: true } },
            futureEventField: { kept: true },
        };

        const decoded = decodePortfolioValue(interim);
        expect(decoded.portfolio.processes[0].graph.nodes[0].event).toEqual({
            kind: 'generic',
            behavior: 'neutral',
            timing: {
                start: { kind: 'date', precision: 'day', value: '2026-09-05' },
                allDay: true,
            },
            metadata: { owner: 'operations' },
            extensions: { 'org.example.process': { kept: true } },
            futureEventField: { kept: true },
        });
        expect(decoded.migration.changes).toContainEqual(expect.objectContaining({ code: 'event-contract' }));
    });

    it('exposes Event nodes to generic node search with a semantic icon', () => {
        expect(listEntityCandidates(eventPortfolio(), ['node'])).toContainEqual(expect.objectContaining({
            label: 'Payment confirmed',
            icon: 'CircleDot',
        }));
    });
});
