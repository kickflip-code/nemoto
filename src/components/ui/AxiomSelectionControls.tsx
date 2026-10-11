import {
    forwardRef,
    type ButtonHTMLAttributes,
    type HTMLAttributes,
} from 'react';
import clsx from 'clsx';

export interface AxiomSegmentedProps extends HTMLAttributes<HTMLDivElement> {
    'aria-label': string;
}

export function AxiomSegmented({ className, ...props }: AxiomSegmentedProps) {
    return <div role="group" className={clsx('axiom-segmented', className)} {...props} />;
}

export interface AxiomSegmentedOptionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    active: boolean;
}

export const AxiomSegmentedOption = forwardRef<HTMLButtonElement, AxiomSegmentedOptionProps>(
    function AxiomSegmentedOption({ active, className, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                aria-pressed={active}
                data-state={active ? 'on' : 'off'}
                type={type}
                className={clsx('axiom-segmented-option', active && 'axiom-segmented-option-active', className)}
                {...props}
            />
        );
    },
);

export interface AxiomSwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
    checked: boolean;
    label: string;
    onCheckedChange: (checked: boolean) => void;
}

export const AxiomSwitch = forwardRef<HTMLButtonElement, AxiomSwitchProps>(function AxiomSwitch(
    {
        checked,
        className,
        disabled,
        label,
        onCheckedChange,
        onClick,
        type = 'button',
        ...props
    },
    ref,
) {
    return (
        <button
            ref={ref}
            aria-checked={checked}
            aria-label={label}
            data-state={checked ? 'checked' : 'unchecked'}
            disabled={disabled}
            role="switch"
            type={type}
            className={clsx('axiom-toggle', checked && 'axiom-toggle-active', className)}
            onClick={event => {
                onClick?.(event);
                if (!event.defaultPrevented && !disabled) onCheckedChange(!checked);
            }}
            {...props}
        >
            <span aria-hidden="true" className="axiom-toggle-knob" />
        </button>
    );
});

export interface AxiomChoiceCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    selected: boolean;
}

export const AxiomChoiceCard = forwardRef<HTMLButtonElement, AxiomChoiceCardProps>(
    function AxiomChoiceCard({ className, selected, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                aria-pressed={selected}
                data-state={selected ? 'selected' : 'unselected'}
                type={type}
                className={clsx('axiom-dialog-row', selected && 'axiom-dialog-row-selected', className)}
                {...props}
            />
        );
    },
);

export interface AxiomToggleCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    active: boolean;
}

export const AxiomToggleCard = forwardRef<HTMLButtonElement, AxiomToggleCardProps>(
    function AxiomToggleCard({ active, className, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                aria-pressed={active}
                data-state={active ? 'on' : 'off'}
                type={type}
                className={clsx('axiom-toggle-card', active && 'axiom-toggle-card-active', className)}
                {...props}
            />
        );
    },
);

export interface AxiomColorSwatchProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    'aria-label': string;
    selected: boolean;
}

export const AxiomColorSwatch = forwardRef<HTMLButtonElement, AxiomColorSwatchProps>(
    function AxiomColorSwatch({ className, selected, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                aria-pressed={selected}
                type={type}
                className={clsx('axiom-color-swatch', selected && 'axiom-color-swatch-active', className)}
                {...props}
            />
        );
    },
);

export interface AxiomIconTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    'aria-label': string;
    selected: boolean;
}

export const AxiomIconTile = forwardRef<HTMLButtonElement, AxiomIconTileProps>(
    function AxiomIconTile({ className, selected, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                aria-pressed={selected}
                type={type}
                className={clsx('axiom-icon-tile', selected && 'axiom-icon-tile-active', className)}
                {...props}
            />
        );
    },
);
