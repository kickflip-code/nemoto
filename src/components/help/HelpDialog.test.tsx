import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '../../lib/appVersion';
import HelpDialog from './HelpDialog';

describe('HelpDialog', () => {
    it('shows the core topics and the current application version', () => {
        render(<HelpDialog onClose={() => undefined} />);

        const expectedSections = [
            'Getting started',
            'Everyday workflows',
            'Processes, resources, and Journal',
            'Saving, backups, and recovery',
            'Import and export',
            'Plugins and safety',
            'Keyboard shortcuts',
            'Troubleshooting and safe mode',
            'About Nemoto',
        ];

        for (const section of expectedSections) {
            expect(screen.getByRole('heading', { name: section })).toBeInTheDocument();
        }

        const dialog = screen.getByRole('dialog', { name: 'Help' });
        expect(screen.getByRole('navigation', { name: 'Help topics' })).toBeInTheDocument();
        expect(dialog).toHaveTextContent(`Nemoto version: ${APP_VERSION}`);
        expect(dialog).toHaveTextContent('Division');
        expect(screen.getByRole('navigation', { name: 'Help topics' })).toHaveTextContent('Everyday workflows');
        expect(dialog).toHaveTextContent('Kickflip Code');
        expect(dialog).toHaveTextContent('Mozilla Public License 2.0 (MPL-2.0)');
        expect(dialog).toHaveTextContent('Included with Nemoto');
    });

    it('uses the shared focus, Escape, and focus-return behavior', () => {
        const closeSpy = vi.fn();

        function Harness() {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>Open Help</button>
                    {open && (
                        <HelpDialog
                            onClose={() => {
                                closeSpy();
                                setOpen(false);
                            }}
                        />
                    )}
                </>
            );
        }

        render(<Harness />);
        const trigger = screen.getByRole('button', { name: 'Open Help' });
        trigger.focus();
        fireEvent.click(trigger);

        expect(screen.getByRole('button', { name: 'Close Help' })).toHaveFocus();
        fireEvent.keyDown(screen.getByRole('dialog', { name: 'Help' }), { key: 'Escape' });

        expect(closeSpy).toHaveBeenCalledOnce();
        expect(trigger).toHaveFocus();
    });
});
