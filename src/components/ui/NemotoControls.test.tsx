import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NemotoButton, NemotoInput, NemotoRange, NemotoSelect, NemotoTextarea } from './NemotoControls';

describe('Nemoto controls', () => {
    it('provides safe button defaults and semantic variants', () => {
        render(
            <>
                <NemotoButton variant="primary">Save</NemotoButton>
                <NemotoButton aria-label="Warning" icon size="sm" variant="warning" />
            </>,
        );

        const saveButton = screen.getByRole('button', { name: 'Save' });
        expect(saveButton).toHaveAttribute('type', 'button');
        expect(saveButton).toHaveClass('nemoto-button', 'nemoto-button-primary');

        expect(screen.getByRole('button', { name: 'Warning' })).toHaveClass(
            'nemoto-icon-button',
            'nemoto-icon-button-sm',
            'nemoto-icon-button-warning',
        );
    });

    it('uses the shared field contract for each native field type', () => {
        render(
            <>
                <NemotoInput aria-label="Name" controlSize="sm" />
                <NemotoSelect aria-label="Theme" controlSize="xs"><option>Void</option></NemotoSelect>
                <NemotoTextarea aria-label="Description" />
                <NemotoRange aria-label="Reach" min={1} max={3} />
            </>,
        );

        expect(screen.getByRole('textbox', { name: 'Name' })).toHaveClass('nemoto-field', 'nemoto-field-sm');
        expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveClass('nemoto-field', 'nemoto-field-xs');
        expect(screen.getByRole('textbox', { name: 'Description' })).toHaveClass('nemoto-field', 'nemoto-field-textarea');
        expect(screen.getByRole('slider', { name: 'Reach' })).toHaveClass('nemoto-range');
    });

    it('triggers date picker when clicking a date input', () => {
        const showPicker = vi.fn();
        HTMLInputElement.prototype.showPicker = showPicker;
        const customClick = vi.fn();

        render(<NemotoInput type="date" aria-label="Due date" onClick={customClick} />);
        const input = screen.getByLabelText('Due date');
        input.click();

        expect(customClick).toHaveBeenCalledTimes(1);
        expect(showPicker).toHaveBeenCalledTimes(1);
    });
});
