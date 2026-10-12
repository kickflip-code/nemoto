import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NemotoDialog, NemotoDialogBody, NemotoDialogFooter, NemotoDialogHeader } from './NemotoDialog';
import userEvent from '@testing-library/user-event';
import ContextMenu from '../shared/ContextMenu';

const renderDialog = (onClose = vi.fn()) => {
    const result = render(
        <>
            <button type="button">Outside</button>
            <NemotoDialog
                aria-describedby="test-dialog-description"
                aria-labelledby="test-dialog-title"
                onClose={onClose}
            >
                <h2 id="test-dialog-title">Test dialog</h2>
                <p id="test-dialog-description">Dialog description</p>
                <button type="button">First action</button>
                <button type="button">Last action</button>
            </NemotoDialog>
        </>,
    );

    return { ...result, onClose };
};

describe('NemotoDialog', () => {
    it('renders above page menus outside a transformed parent', () => {
        const { container } = render(
            <div style={{ transform: 'translateZ(0)' }}>
                <ContextMenu items={[{ label: 'Canvas action' }]} x={20} y={20} onClose={() => {}} />
                <NemotoDialog aria-labelledby="layer-title" onClose={() => {}}>
                    <h2 id="layer-title">Layer test</h2>
                </NemotoDialog>
            </div>,
        );
        const overlay = screen.getByRole('dialog', { name: 'Layer test' }).parentElement!;
        expect(overlay.parentElement).toBe(document.body);
        expect(overlay).toHaveClass('z-[10100]');
        expect(screen.getByRole('menu')).toHaveStyle({ zIndex: 9999 });
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('places a context menu opened inside a dialog above that dialog', () => {
        render(<NemotoDialog aria-labelledby="menu-layer-title" onClose={() => {}}>
            <h2 id="menu-layer-title">Menu layer</h2>
            <ContextMenu items={[{ label: 'Action', action: () => {} }]} x={20} y={20} onClose={() => {}} />
        </NemotoDialog>);
        expect(screen.getByRole('menu')).toHaveStyle({ zIndex: 10200 });
    });

    it('closes a nested confirmation first and restores its parent trigger', async () => {
        const user = userEvent.setup();
        const closeParent = vi.fn();
        function Harness() {
            const [confirm, setConfirm] = useState(false);
            return <NemotoDialog aria-labelledby="parent-title" onClose={closeParent}>
                <h2 id="parent-title">Settings</h2>
                <button onClick={() => setConfirm(true)}>Restore backup</button>
                {confirm && <NemotoDialog aria-labelledby="child-title" onClose={() => setConfirm(false)}>
                    <h2 id="child-title">Restore portfolio?</h2><button>Cancel</button><button>Restore</button>
                </NemotoDialog>}
            </NemotoDialog>;
        }
        render(<Harness />);
        await user.tab();
        await user.keyboard('{Enter}');
        const nestedDialog = screen.getByRole('dialog', { name: 'Restore portfolio?' });
        expect(nestedDialog).toHaveFocus();
        expect(nestedDialog.parentElement).toHaveStyle({ zIndex: 10300 });
        await user.tab({ shift: true });
        expect(screen.getByRole('button', { name: 'Restore' })).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(screen.getByRole('button', { name: 'Restore backup' })).toHaveFocus();
        expect(closeParent).not.toHaveBeenCalled();
    });
    it('skips hidden, untabbable and fieldset-disabled controls when wrapping focus', () => {
        render(<NemotoDialog aria-labelledby="filtered-title" onClose={() => {}}>
            <h2 id="filtered-title">Filtered</h2>
            <fieldset disabled><select aria-label="Locked theme"><option>Void</option></select></fieldset>
            <button tabIndex={-1}>Programmatic only</button>
            <button>Available</button>
            <div hidden><button>Hidden action</button></div>
            <div style={{ display: 'none' }}><button>Collapsed action</button></div>
        </NemotoDialog>);
        const available = screen.getByRole('button', { name: 'Available' });
        available.focus();
        fireEvent.keyDown(available, { key: 'Tab', shiftKey: true });
        expect(available).toHaveFocus();
        fireEvent.keyDown(available, { key: 'Tab' });
        expect(available).toHaveFocus();
    });

    it('keeps focus on the dialog when all controls are locked during restore', () => {
        render(<NemotoDialog aria-labelledby="locked-title" onClose={() => {}}>
            <h2 id="locked-title">Restoring</h2>
            <fieldset disabled><select aria-label="Locked theme"><option>Void</option></select></fieldset>
            <button disabled>Restoring…</button>
        </NemotoDialog>);
        const dialog = screen.getByRole('dialog');
        fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
        expect(dialog).toHaveFocus();
        fireEvent.keyDown(dialog, { key: 'Tab' });
        expect(dialog).toHaveFocus();
    });
    it('exposes dialog semantics and moves focus inside', () => {
        renderDialog();

        const dialog = screen.getByRole('dialog', { name: 'Test dialog' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleDescription('Dialog description');
        expect(dialog).toHaveFocus();
    });

    it('closes with Escape or the backdrop', () => {
        const { onClose } = renderDialog();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        fireEvent.click(document.body.querySelector('.nemoto-dialog-backdrop')!);

        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('keeps keyboard focus inside the dialog', () => {
        renderDialog();
        const first = screen.getByRole('button', { name: 'First action' });
        const last = screen.getByRole('button', { name: 'Last action' });

        last.focus();
        fireEvent.keyDown(last, { key: 'Tab' });
        expect(first).toHaveFocus();

        fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
        expect(last).toHaveFocus();
    });

    it('returns focus to the control that opened it', () => {
        function Harness() {
            const [open, setOpen] = useState(false);

            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
                    {open && (
                        <NemotoDialog aria-labelledby="return-focus-title" onClose={() => setOpen(false)}>
                            <h2 id="return-focus-title">Return focus</h2>
                            <button type="button">Action</button>
                        </NemotoDialog>
                    )}
                </>
            );
        }

        render(<Harness />);
        const trigger = screen.getByRole('button', { name: 'Open dialog' });
        trigger.focus();
        fireEvent.click(trigger);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

        expect(trigger).toHaveFocus();
    });

    it('honors an explicitly requested initial focus target', () => {
        function Harness() {
            const inputRef = useRef<HTMLInputElement>(null);

            return (
                <NemotoDialog
                    aria-labelledby="autofocus-title"
                    initialFocusRef={inputRef}
                    onClose={() => undefined}
                >
                    <h2 id="autofocus-title">Autofocus</h2>
                    <input ref={inputRef} aria-label="Theme name" />
                </NemotoDialog>
            );
        }

        render(<Harness />);

        expect(screen.getByRole('textbox', { name: 'Theme name' })).toHaveFocus();
    });

    it('provides consistent structural regions', () => {
        render(
            <NemotoDialog aria-labelledby="structured-title" onClose={() => undefined}>
                <NemotoDialogHeader><h2 id="structured-title">Structured</h2></NemotoDialogHeader>
                <NemotoDialogBody>Content</NemotoDialogBody>
                <NemotoDialogFooter>Actions</NemotoDialogFooter>
            </NemotoDialog>,
        );

        expect(screen.getByText('Structured').parentElement).toHaveClass('nemoto-dialog-header');
        expect(screen.getByText('Content')).toHaveClass('nemoto-dialog-body');
        expect(screen.getByText('Actions')).toHaveClass('nemoto-dialog-footer');
    });
});
