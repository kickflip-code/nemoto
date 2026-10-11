import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ViewerSidebar } from './ViewerSidebar';

describe('export viewer detail sidebar', () => {
    it('shows direct dependency context for a selected entity', () => {
        render(
            <ViewerSidebar
                selectedElement={{
                    id: 'asset-1',
                    label: 'Incident system',
                    type: 'asset',
                    dependencyRelations: [{
                        id: 'relation-1',
                        label: 'Used by step',
                        count: 3,
                        other: {
                            id: 'step-1',
                            label: 'Register incident',
                            type: 'node',
                            subtitle: 'Step',
                        },
                    }],
                }}
                assets={[]}
                categories={[]}
                journalEntries={[]}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Direct Relationships (1)' })).toBeInTheDocument();
        expect(screen.getByText('Used by step')).toBeInTheDocument();
        expect(screen.getByText('Register incident')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('shows Event kind, behavior, and optional timing in the details panel', () => {
        render(
            <ViewerSidebar
                selectedElement={{
                    id: 'event-1',
                    label: 'SLA expires',
                    type: 'event',
                    event: {
                        kind: 'timer',
                        behavior: 'observed',
                        timing: {
                            start: { kind: 'date', precision: 'day', value: '2026-09-05' },
                            allDay: true,
                        },
                    },
                }}
                assets={[]}
                categories={[]}
                journalEntries={[]}
            />,
        );

        expect(screen.getByText('Event Kind')).toBeInTheDocument();
        expect(screen.getByText('Timer')).toBeInTheDocument();
        expect(screen.getByText('Behavior')).toBeInTheDocument();
        expect(screen.getByText('Observed')).toBeInTheDocument();
        expect(screen.getByText('Timing')).toBeInTheDocument();
        expect(screen.getByText(/All day/)).toBeInTheDocument();
    });

    it('does not invent timing for an Event without the optional facet', () => {
        render(
            <ViewerSidebar
                selectedElement={{
                    id: 'event-2',
                    label: 'Fraud alert published',
                    type: 'event',
                    event: { kind: 'signal', behavior: 'emitted' },
                }}
                assets={[]}
                categories={[]}
                journalEntries={[]}
            />,
        );

        expect(screen.getByText('Signal')).toBeInTheDocument();
        expect(screen.getByText('Emitted')).toBeInTheDocument();
        expect(screen.queryByText('Timing')).not.toBeInTheDocument();
    });
});
