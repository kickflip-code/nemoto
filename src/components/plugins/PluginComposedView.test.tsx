import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PluginComposedView from './PluginComposedView';
import wireFixture from '../../../fixtures/plugins/protocol/ui-wire-v1.json';

const text = (key: string, value: string) => ({
    key, type: 'text', text: value, role: 'body', tone: 'default',
});

describe('package-owned presentation', () => {
    it('preserves draft focus when a package-owned row is refreshed', () => {
        const tree = {
            key: 'root', type: 'stack', direction: 'vertical', gap: 'none', wrap: false,
            children: [{ type: 'presentation', key: 'opaque.row', presentation: { layout: 'row', gap: 'small', wrap: true }, children: [
                { type: 'text-input', key: 'opaque.entry', label: 'Entry', actionId: 'entry.change', value: '', required: false, disabled: false, maxLength: 100 },
                { type: 'button', key: 'opaque.submit', label: 'Apply', actionId: 'entry.apply', disabled: false, variant: 'primary' },
            ] }],
        };
        const { rerender } = render(<PluginComposedView tree={tree} />);
        const input = screen.getByRole('textbox', { name: 'Entry' });
        input.focus();
        fireEvent.change(input, { target: { value: 'Local draft' } });
        rerender(<PluginComposedView tree={structuredClone(tree)} />);
        expect(screen.getByRole('textbox', { name: 'Entry' })).toBe(input);
        expect(input).toHaveFocus();
        expect(input).toHaveValue('Local draft');
        expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    });

    it('uses tokens with arbitrary keys and preserves accessible action names and identity', async () => {
        const onAction = vi.fn();
        render(<PluginComposedView onAction={onAction} tree={{
            key: 'neutral.root', type: 'stack', direction: 'horizontal', gap: 'small', wrap: true,
            children: [{
                type: 'presentation', key: 'neutral.skin',
                presentation: { control: 'icon', icon: 'copy', selected: true },
                children: [{ type: 'button', key: 'opaque.42', label: 'Copy selection', actionId: 'opaque.action', disabled: false, variant: 'ghost' }],
            }, {
                type: 'presentation', key: 'neutral.search',
                presentation: { width: 'grow', label: 'hidden', placeholder: 'Find an entry', icon: 'search' },
                children: [{ type: 'text-input', key: 'opaque.43', label: 'Filter entries', actionId: 'opaque.filter', value: '', required: false, disabled: false, maxLength: 100 }],
            }],
        }} />);
        const action = screen.getByRole('button', { name: 'Copy selection', pressed: true });
        await userEvent.click(action);
        expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ controlKey: 'opaque.42', actionId: 'opaque.action', userGesture: true }));
        expect(screen.getByRole('textbox', { name: 'Filter entries' })).toHaveAttribute('placeholder', 'Find an entry');
        expect(action.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });

    it('keeps a matrix count separate from its contextual accessible name', () => {
        render(<PluginComposedView tree={{ key: 'root', type: 'stack', direction: 'vertical', gap: 'none', wrap: false, children: [{
            key: 'cell.style', type: 'presentation', presentation: { control: 'matrix', tone: 'warning', accessibleLabel: 'Probability 3, severity 4: 2 open risks', selected: false },
            children: [{ type: 'button', key: 'cell', label: '2', actionId: 'filter', disabled: false, variant: 'secondary' }],
        }] }} />);
        expect(screen.getByRole('button', { name: 'Probability 3, severity 4: 2 open risks', pressed: false })).toHaveTextContent('2');
    });
});

const stackTree = {
    key: 'root', type: 'stack', direction: 'vertical', gap: 'medium', wrap: false,
    children: [
        { key: 'title', type: 'text', text: 'Work queue', role: 'heading', tone: 'default' },
        { key: 'name', type: 'text-input', label: 'Item name', actionId: 'item:name', value: 'Review', required: true, disabled: false, maxLength: 100 },
        { key: 'due', type: 'date-input', label: 'Due date', actionId: 'item:due', value: '2026-09-12', required: false, disabled: false },
        { key: 'done', type: 'checkbox', label: 'Complete', actionId: 'item:done', checked: false, disabled: false },
        { key: 'status', type: 'select', label: 'Status', actionId: 'item:status', value: 'open', disabled: false, options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
        { key: 'save', type: 'button', label: 'Save item', actionId: 'item:save', disabled: false, variant: 'primary' },
    ],
};

// A package is allowed to rename its opaque keys or extend/reorder children
// without asking Core to ship a matching renderer.
describe('package-independent composition', () => {
    it.each(['neutral', 'tasks.quick', 'task.0', 'risks.toolbar', 'capture.dialog'])('preserves all children and their order for key %s', key => {
        const tree = { ...stackTree, key, children: [text('extra', 'New package field'), text('first', 'First'), text('last', 'Last')] };
        const { container } = render(<PluginComposedView tree={tree} />);
        expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['New package field', 'First', 'Last']);
    });

    it.each(['neutral', 'capture.dialog', 'risks.dialog'])('preserves a package-defined grid inside dialog %s', async key => {
        const { baseElement } = render(<PluginComposedView tree={{ ...stackTree, children: [{
            key, type: 'dialog', label: 'Package editor', closeActionId: 'editor.close', dirty: false,
            children: [{ key: 'capture.fields', type: 'grid', gap: 'medium', columns: { compact: 1, wide: 2 },
                children: [text('capture.heading', 'Package heading'), text('new-field', 'Additional field')] }],
        }] }} />);
        await waitFor(() => expect(screen.getByText('Package heading')).toBeVisible());
        expect(screen.getByText('Additional field')).toBeVisible();
        expect(baseElement.querySelector('.plugin-composed-grid')).toHaveClass('plugin-composed-grid-wide-2');
    });

    it.each(['neutral', 'risks.matrix-cell.5.5', 'tasks.copy'])('honors button label and disabled state for key %s', key => {
        const onAction = vi.fn();
        render(<PluginComposedView onAction={onAction} tree={{ ...stackTree, children: [{
            key, type: 'button', label: 'Package action', actionId: 'action', disabled: true, variant: 'secondary',
        }] }} />);
        const button = screen.getByRole('button', { name: 'Package action' });
        expect(button).toBeDisabled();
        expect(button).toHaveTextContent('Package action');
        fireEvent.click(button);
        expect(onAction).not.toHaveBeenCalled();
    });
});

describe('generic composed plugin view', () => {
    it('submits only an explicitly declared form on Enter, excluding IME composition', () => {
        const onAction = vi.fn();
        render(<PluginComposedView tree={{ ...stackTree, children: [{ key: 'form', type: 'form', label: 'Quick entry', actionId: 'form.submit', dirty: true, disabled: false, children: [stackTree.children[1]] }] }} onAction={onAction} />);
        const input = screen.getByRole('textbox', { name: 'Item name' });
        fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
        expect(onAction).not.toHaveBeenCalled();
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onAction).toHaveBeenCalledWith({ controlKey: 'form', actionId: 'form.submit', value: null, draftRevision: null, userGesture: true });
    });
    it('keeps fast typing intact while older Wasm responses arrive and suppresses IME intermediates', async () => {
        const onAction = vi.fn();
        const user = userEvent.setup();
        const withValue = (value: string) => ({ ...stackTree, children: stackTree.children.map(node => node.key === 'name' ? { ...node, value } : node) });
        const { rerender } = render(<PluginComposedView tree={withValue('')} onAction={onAction} />);
        const input = screen.getByRole('textbox', { name: 'Item name' });
        await user.type(input, 'abc');
        expect(input).toHaveValue('abc');
        rerender(<PluginComposedView tree={withValue('a')} onAction={onAction} />);
        expect(input).toHaveValue('abc');
        rerender(<PluginComposedView tree={withValue('abc')} onAction={onAction} />);
        expect(input).toHaveValue('abc');
        onAction.mockClear();
        fireEvent.compositionStart(input);
        fireEvent.change(input, { target: { value: 'あ' } });
        expect(onAction).not.toHaveBeenCalled();
        fireEvent.compositionEnd(input);
        expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ value: 'あ' }));
    });
    it('renders a package-owned stack with accessible controls and serializable actions', async () => {
        const onAction = vi.fn();
        const user = userEvent.setup();
        render(<PluginComposedView tree={stackTree} onAction={onAction} />);

        expect(screen.getByRole('heading', { name: 'Work queue' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Item name' })).toBeRequired();
        expect(screen.getByLabelText('Due date')).toHaveAttribute('type', 'date');

        fireEvent.change(screen.getByRole('textbox', { name: 'Item name' }), { target: { value: 'Plan' } });
        await user.click(screen.getByRole('checkbox', { name: 'Complete' }));
        await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'closed');
        await user.click(screen.getByRole('button', { name: 'Save item' }));

        expect(onAction).toHaveBeenCalledWith({ controlKey: 'name', actionId: 'item:name', value: 'Plan', draftRevision: null });
        expect(onAction).toHaveBeenCalledWith({ controlKey: 'done', actionId: 'item:done', value: true, draftRevision: null });
        expect(onAction).toHaveBeenCalledWith({ controlKey: 'status', actionId: 'item:status', value: 'closed', draftRevision: null });
        expect(onAction).toHaveBeenLastCalledWith({
            controlKey: 'save', actionId: 'item:save', value: null, draftRevision: null, userGesture: true,
        });
    });

    it('renders a distinct responsive grid and host-token tone without domain branches', () => {
        render(<PluginComposedView tree={{
            key: 'root', type: 'grid', columns: { compact: 1, wide: 3 }, gap: 'large',
            children: [
                text('first', 'First'),
                { key: 'second', type: 'text', text: 'Needs attention', role: 'status', tone: 'danger' },
                { key: 'items', type: 'list', label: 'Recent records', children: [text('third', 'Third')] },
            ],
        }} />);

        const root = screen.getByTestId('plugin-composed-view').firstElementChild;
        expect(root).toHaveClass('plugin-composed-grid-compact-1', 'plugin-composed-grid-wide-3');
        expect(screen.getByRole('status')).toHaveClass('plugin-composed-tone-danger');
        expect(screen.getByRole('list', { name: 'Recent records' })).toBeInTheDocument();
    });

    it('keeps focus on a stable keyed control when a validated tree is refreshed', () => {
        const { rerender } = render(<PluginComposedView tree={stackTree} />);
        const input = screen.getByRole('textbox', { name: 'Item name' });
        input.focus();

        rerender(<PluginComposedView tree={{ ...stackTree, children: stackTree.children.map(node => (
            node.key === 'name' ? { ...node, value: 'Updated' } : node
        )) }} />);

        expect(screen.getByRole('textbox', { name: 'Item name' })).toBe(input);
        expect(input).toHaveFocus();
        expect(input).toHaveValue('Updated');
    });

    it('uses the host dialog semantics and emits the declared close action', () => {
        const onAction = vi.fn();
        render(<PluginComposedView onAction={onAction} tree={{
            key: 'root', type: 'stack', direction: 'vertical', gap: 'none', wrap: false,
            children: [{ key: 'edit', type: 'dialog', label: 'Edit record', closeActionId: 'record:close', dirty: false, children: [text('body', 'Details')] }],
        }} />);

        const dialog = screen.getByRole('dialog', { name: 'Edit record' });
        expect(dialog.parentElement).toBe(document.body.lastElementChild);
        expect(dialog.closest('[data-testid="plugin-composed-view"]')).toBeNull();

        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(onAction).toHaveBeenCalledWith({ controlKey: 'edit', actionId: 'record:close', value: null, draftRevision: null });
    });

    it('renders every admitted v1 primitive through host-owned components', () => {
        render(<PluginComposedView tree={{
            key: 'sample-root', type: 'stack', direction: 'vertical', gap: 'small', wrap: false,
            children: wireFixture.nodeSamples,
        }} />);

        expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
        expect(screen.getByLabelText('Due')).toHaveAttribute('type', 'date');
        expect(screen.getByRole('checkbox', { name: 'Done' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument();
    });

    it('requires explicit discard before forwarding a dirty dialog close', async () => {
        const user = userEvent.setup();
        const onAction = vi.fn();
        render(<PluginComposedView onAction={onAction} tree={{ ...stackTree, children: [
            { key: 'edit', type: 'dialog', label: 'Edit record', closeActionId: 'record:close', dirty: true, children: [text('body', 'Draft')] },
        ] }} />);
        fireEvent.keyDown(screen.getByRole('dialog', { name: 'Edit record' }), { key: 'Escape' });
        expect(onAction).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Keep editing' }));
        expect(onAction).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByRole('dialog', { name: 'Edit record' }), { key: 'Escape' });
        await user.click(screen.getByRole('button', { name: 'Discard changes' }));
        expect(onAction).toHaveBeenCalledWith({ controlKey: 'edit', actionId: 'record:close', value: null, draftRevision: null });
    });

    it('fails closed for unsupported or malformed nodes', () => {
        render(<PluginComposedView tree={{
            key: 'root', type: 'stack', direction: 'vertical', gap: 'none', wrap: false,
            children: [{ key: 'escape', type: 'html', html: '<button>Unsafe</button>' }],
        }} />);

        expect(screen.getByRole('alert')).toHaveTextContent('unsupported layout');
        expect(screen.queryByRole('button', { name: 'Unsafe' })).not.toBeInTheDocument();
    });
});
