import { fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AxiomMenu, AxiomMenuDivider, AxiomMenuItem } from './AxiomMenu';
import { AxiomDialog } from './AxiomDialog';
import userEvent from '@testing-library/user-event';

describe('AxiomMenu', () => {
    it('keeps the selected theme as the initial item through StrictMode effect replay', () => {
        render(<StrictMode><AxiomMenu>
            <AxiomMenuItem role="menuitemradio" aria-checked={false}>Void</AxiomMenuItem>
            <AxiomMenuItem role="menuitemradio" aria-checked autoFocus>Polar</AxiomMenuItem>
        </AxiomMenu></StrictMode>);
        expect(screen.getByRole('menuitemradio', { name: 'Polar', checked: true })).toHaveFocus();
    });
    it('closes when Tab leaves the menu without pulling focus back', async () => {
        const user = userEvent.setup();
        function Harness() {
            const [open, setOpen] = useState(true);
            return <><button>Trigger</button>{open && <AxiomMenu onClose={() => setOpen(false)}><AxiomMenuItem>Last</AxiomMenuItem></AxiomMenu>}<button>Next control</button></>;
        }
        render(<StrictMode><Harness /></StrictMode>);
        await user.tab();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus();
    });
    it('focuses the first enabled action and respects an explicit initial choice', () => {
        const { unmount } = render(<AxiomMenu><AxiomMenuItem disabled>Unavailable</AxiomMenuItem><AxiomMenuItem>Available</AxiomMenuItem></AxiomMenu>);
        expect(screen.getByRole('menuitem', { name: 'Available' })).toHaveFocus();
        unmount();
        render(<AxiomMenu><AxiomMenuItem>First</AxiomMenuItem><AxiomMenuItem autoFocus>Current choice</AxiomMenuItem></AxiomMenu>);
        expect(screen.getByRole('menuitem', { name: 'Current choice' })).toHaveFocus();
    });

    it('closes only the menu with Escape and returns focus inside its dialog', async () => {
        const user = userEvent.setup();
        const closeDialog = vi.fn();
        function Harness() {
            const [open, setOpen] = useState(false);
            return <AxiomDialog aria-labelledby="menu-dialog-title" onClose={closeDialog}>
                <h2 id="menu-dialog-title">Settings</h2>
                <button onClick={() => setOpen(true)}>Choose theme</button>
                {open && <AxiomMenu onClose={() => setOpen(false)}><AxiomMenuItem>Void</AxiomMenuItem></AxiomMenu>}
            </AxiomDialog>;
        }
        render(<Harness />);
        await user.tab();
        await user.keyboard('{Enter}');
        expect(screen.getByRole('menuitem')).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choose theme' })).toHaveFocus();
        expect(closeDialog).not.toHaveBeenCalled();
        await user.keyboard('{Escape}');
        expect(closeDialog).toHaveBeenCalledOnce();
    });

    it('does not steal focus from a dialog opened by a menu action', async () => {
        const user = userEvent.setup();
        function Harness() {
            const [page, setPage] = useState('menu');
            return <><button>Trigger</button>{page === 'menu'
                ? <AxiomMenu><AxiomMenuItem onClick={() => setPage('dialog')}>Import</AxiomMenuItem></AxiomMenu>
                : <AxiomDialog aria-labelledby="import-title" onClose={() => {}}><h2 id="import-title">Import</h2><button>Browse</button></AxiomDialog>}</>;
        }
        render(<Harness />);
        await user.keyboard('{Enter}');
        expect(screen.getByRole('dialog')).toHaveFocus();
    });
    it('provides menu semantics and shared item variants', () => {
        render(
            <AxiomMenu aria-label="Actions">
                <AxiomMenuItem>Open</AxiomMenuItem>
                <AxiomMenuDivider />
                <AxiomMenuItem compact danger>Delete</AxiomMenuItem>
            </AxiomMenu>,
        );

        expect(screen.getByRole('menu', { name: 'Actions' })).toHaveClass('axiom-context-menu');
        expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveAttribute('type', 'button');
        expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveClass(
            'axiom-menu-item-compact',
            'axiom-menu-item-danger',
        );
        expect(screen.getByRole('separator')).toHaveClass('axiom-menu-divider');
    });

    it('navigates enabled items with arrow, Home and End keys', () => {
        render(
            <AxiomMenu aria-label="Actions">
                <AxiomMenuItem>First</AxiomMenuItem>
                <AxiomMenuItem disabled>Disabled</AxiomMenuItem>
                <AxiomMenuItem>Last</AxiomMenuItem>
            </AxiomMenu>,
        );

        const menu = screen.getByRole('menu', { name: 'Actions' });
        const first = screen.getByRole('menuitem', { name: 'First' });
        const last = screen.getByRole('menuitem', { name: 'Last' });

        first.focus();
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(last).toHaveFocus();

        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(first).toHaveFocus();

        fireEvent.keyDown(menu, { key: 'End' });
        expect(last).toHaveFocus();

        fireEvent.keyDown(menu, { key: 'Home' });
        expect(first).toHaveFocus();
    });

    it('closes with Escape', () => {
        const onClose = vi.fn();
        render(
            <AxiomMenu aria-label="Actions" onClose={onClose}>
                <AxiomMenuItem>Open</AxiomMenuItem>
            </AxiomMenu>,
        );

        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('returns focus to the menu trigger when it closes', () => {
        function Harness() {
            const [open, setOpen] = useState(false);

            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>Open menu</button>
                    {open && (
                        <AxiomMenu aria-label="Actions" onClose={() => setOpen(false)}>
                            <AxiomMenuItem>Open</AxiomMenuItem>
                        </AxiomMenu>
                    )}
                </>
            );
        }

        render(<Harness />);
        const trigger = screen.getByRole('button', { name: 'Open menu' });
        trigger.focus();
        fireEvent.click(trigger);
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

        expect(trigger).toHaveFocus();
    });
});
