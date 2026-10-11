import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MentionList from './MentionList';
import SlashCommandList, { type SlashCommandListHandle } from './SlashCommandList';

describe('journal suggestion lists', () => {
    it('exposes entity suggestions as a selectable listbox', () => {
        const command = vi.fn();
        render(
            <MentionList
                items={[{
                    id: 'asset-1',
                    label: 'Service Desk',
                    type: 'asset',
                    entityType: 'asset',
                }]}
                command={command}
            />,
        );

        expect(screen.getByRole('listbox', { name: 'Entity suggestions' })).toBeInTheDocument();
        const option = screen.getByRole('option', { name: /Service Desk/ });
        expect(option).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(option);
        expect(command).toHaveBeenCalledWith(expect.objectContaining({ id: 'asset-1' }));
    });

    it('keeps the active editor command synchronized with arrow keys', () => {
        const ref = createRef<SlashCommandListHandle>();
        render(
            <SlashCommandList
                ref={ref}
                items={[
                    { title: 'Heading', description: 'Create a heading' },
                    { title: 'Quote', description: 'Create a quote' },
                ]}
                command={vi.fn()}
            />,
        );

        expect(screen.getByRole('option', { name: /Heading/ })).toHaveAttribute('aria-selected', 'true');
        act(() => {
            ref.current?.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'ArrowDown' }) });
        });
        expect(screen.getByRole('option', { name: /Quote/ })).toHaveAttribute('aria-selected', 'true');
    });
});
