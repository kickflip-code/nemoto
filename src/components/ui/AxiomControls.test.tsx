import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AxiomButton, AxiomInput, AxiomRange, AxiomSelect, AxiomTextarea } from './AxiomControls';

describe('Nemoto controls', () => {
    it('provides safe button defaults and semantic variants', () => {
        render(
            <>
                <AxiomButton variant="primary">Save</AxiomButton>
                <AxiomButton aria-label="Warning" icon size="sm" variant="warning" />
            </>,
        );

        const saveButton = screen.getByRole('button', { name: 'Save' });
        expect(saveButton).toHaveAttribute('type', 'button');
        expect(saveButton).toHaveClass('axiom-button', 'axiom-button-primary');

        expect(screen.getByRole('button', { name: 'Warning' })).toHaveClass(
            'axiom-icon-button',
            'axiom-icon-button-sm',
            'axiom-icon-button-warning',
        );
    });

    it('uses the shared field contract for each native field type', () => {
        render(
            <>
                <AxiomInput aria-label="Name" controlSize="sm" />
                <AxiomSelect aria-label="Theme" controlSize="xs"><option>Void</option></AxiomSelect>
                <AxiomTextarea aria-label="Description" />
                <AxiomRange aria-label="Reach" min={1} max={3} />
            </>,
        );

        expect(screen.getByRole('textbox', { name: 'Name' })).toHaveClass('axiom-field', 'axiom-field-sm');
        expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveClass('axiom-field', 'axiom-field-xs');
        expect(screen.getByRole('textbox', { name: 'Description' })).toHaveClass('axiom-field', 'axiom-field-textarea');
        expect(screen.getByRole('slider', { name: 'Reach' })).toHaveClass('axiom-range');
    });

    it('triggers date picker when clicking a date input', () => {
        const showPicker = vi.fn();
        HTMLInputElement.prototype.showPicker = showPicker;
        const customClick = vi.fn();

        render(<AxiomInput type="date" aria-label="Due date" onClick={customClick} />);
        const input = screen.getByLabelText('Due date');
        input.click();

        expect(customClick).toHaveBeenCalledTimes(1);
        expect(showPicker).toHaveBeenCalledTimes(1);
    });
});
