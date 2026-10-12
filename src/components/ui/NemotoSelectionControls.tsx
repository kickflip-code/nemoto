import {
    forwardRef,
    type ButtonHTMLAttributes,
    type HTMLAttributes,
} from 'react';
import clsx from 'clsx';

export interface NemotoSegmentedProps extends HTMLAttributes<HTMLDivElement> {
    'aria-label': string;
}

export function NemotoSegmented({ className, ...props }: NemotoSegmentedProps) {
    return <div role="group" className={clsx('nemoto-segmented', className)} {...props} />;
}

export interface NemotoSegmentedOptionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    active: boolean;
}

export const NemotoSegmentedOption = forwardRef<HTMLButtonElement, NemotoSegmentedOptionProps>(
    function NemotoSegmentedOption({ active, className, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                aria-pressed={active}
                data-state={active ? 'on' : 'off'}
                type={type}
                className={clsx('nemoto-segmented-option', active && 'nemoto-segmented-option-active', className)}
                {...props}
            />
        );
    },
);

export interface NemotoSwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
    checked: boolean;
    label: string;
    onCheckedChange: (checked: boolean) => void;
}

export const NemotoSwitch = forwardRef<HTMLButtonElement, NemotoSwitchProps>(function NemotoSwitch(
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
            className={clsx('nemoto-toggle', checked && 'nemoto-toggle-active', className)}
            onClick={event => {
                onClick?.(event);
                if (!event.defaultPrevented && !disabled) onCheckedChange(!checked);
            }}
            {...props}
        >
            <span aria-hidden="true" className="nemoto-toggle-knob" />
        </button>
    );
});

export interface NemotoChoiceCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    selected: boolean;
}

export const NemotoChoiceCard = forwardRef<HTMLButtonElement, NemotoChoiceCardProps>(
    function NemotoChoiceCard({ className, selected, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                aria-pressed={selected}
                data-state={selected ? 'selected' : 'unselected'}
                type={type}
                className={clsx('nemoto-dialog-row', selected && 'nemoto-dialog-row-selected', className)}
                {...props}
            />
        );
    },
);

export interface NemotoToggleCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    active: boolean;
}

export const NemotoToggleCard = forwardRef<HTMLButtonElement, NemotoToggleCardProps>(
    function NemotoToggleCard({ active, className, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                aria-pressed={active}
                data-state={active ? 'on' : 'off'}
                type={type}
                className={clsx('nemoto-toggle-card', active && 'nemoto-toggle-card-active', className)}
                {...props}
            />
        );
    },
);

export interface NemotoColorSwatchProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    'aria-label': string;
    selected: boolean;
}

export const NemotoColorSwatch = forwardRef<HTMLButtonElement, NemotoColorSwatchProps>(
    function NemotoColorSwatch({ className, selected, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                aria-pressed={selected}
                type={type}
                className={clsx('nemoto-color-swatch', selected && 'nemoto-color-swatch-active', className)}
                {...props}
            />
        );
    },
);

export interface NemotoIconTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    'aria-label': string;
    selected: boolean;
}

export const NemotoIconTile = forwardRef<HTMLButtonElement, NemotoIconTileProps>(
    function NemotoIconTile({ className, selected, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                aria-pressed={selected}
                type={type}
                className={clsx('nemoto-icon-tile', selected && 'nemoto-icon-tile-active', className)}
                {...props}
            />
        );
    },
);
