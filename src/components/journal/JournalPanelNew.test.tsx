import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useUIStore } from '../../stores/useUIStore';
import JournalPanelNew from './JournalPanelNew';
import { NemotoDialog } from '../ui/NemotoDialog';

describe('JournalPanelNew workspace behavior', () => {
    beforeEach(() => {
        useUIStore.setState({
            journalPanelExpanded: false,
            journalPanelMaximized: false,
            journalPanelHeight: 400,
            activeView: 'designer',
        });
        useSettingsStore.setState({
            journalDock: 'bottom',
            journalPanelWidth: 840,
        });
    });

    it('renders a compact vertical rail and owns focus when side-docked and collapsed', () => {
        render(<JournalPanelNew dock="left" sideDockAvailable />);

        const panel = screen.getByRole('region', { name: 'Journal' });
        expect(panel).toHaveClass('is-left-docked');
        expect(screen.getByRole('button', { name: 'Journal' })).toHaveAttribute('aria-expanded', 'false');

        fireEvent.pointerDown(panel);
        expect(panel).toHaveFocus();
    });

    it('persists a request to dock the expanded journal on the left', () => {
        useUIStore.setState({ journalPanelExpanded: true });
        render(<JournalPanelNew dock="bottom" sideDockAvailable />);

        fireEvent.click(screen.getByRole('button', { name: 'Dock journal on left' }));
        expect(useSettingsStore.getState().journalDock).toBe('left');
    });

    it('keeps the left-docked canvas divider below a dialog overlay', () => {
        useUIStore.setState({ journalPanelExpanded: true });
        render(<div style={{ transform: 'translateZ(0)' }}>
            <JournalPanelNew dock="left" sideDockAvailable />
            <NemotoDialog aria-labelledby="divider-dialog-title" onClose={() => {}}>
                <h2 id="divider-dialog-title">Dialog over Journal divider</h2>
            </NemotoDialog>
        </div>);

        const divider = screen.getByRole('separator', { name: 'Resize journal panel' });
        const panel = screen.getByRole('region', { name: 'Journal' });
        const overlay = screen.getByRole('dialog', { name: 'Dialog over Journal divider' }).parentElement!;
        expect(panel).toContainElement(divider);
        expect(divider).toHaveClass('z-50');
        expect(overlay.parentElement).toBe(document.body);
        expect(overlay).toHaveClass('z-[10100]');
    });

    it('disables side docking when the current window is too narrow', () => {
        useUIStore.setState({ journalPanelExpanded: true });
        render(<JournalPanelNew dock="bottom" sideDockAvailable={false} />);

        expect(screen.getByRole('button', { name: 'Dock journal on left' })).toBeDisabled();
    });
});
