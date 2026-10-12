import {
    forwardRef,
    type ButtonHTMLAttributes,
    type HTMLAttributes,
} from 'react';
import clsx from 'clsx';

export type NemotoToolbarSurface = 'canvas' | 'journal';

export interface NemotoToolbarProps extends HTMLAttributes<HTMLDivElement> {
    'aria-label': string;
    surface?: NemotoToolbarSurface;
}

export const NemotoToolbar = forwardRef<HTMLDivElement, NemotoToolbarProps>(function NemotoToolbar(
    { className, surface = 'canvas', ...props },
    ref,
) {
    return (
        <div
            ref={ref}
            role="toolbar"
            className={clsx(
                surface === 'canvas' ? 'nemoto-canvas-toolbar' : 'nemoto-journal-toolbar',
                className,
            )}
            {...props}
        />
    );
});

export interface NemotoToolbarGroupProps extends HTMLAttributes<HTMLDivElement> {
    'aria-label'?: string;
    surface?: NemotoToolbarSurface;
}

export function NemotoToolbarGroup({
    className,
    surface = 'canvas',
    ...props
}: NemotoToolbarGroupProps) {
    return (
        <div
            role="group"
            className={clsx(
                surface === 'canvas' ? 'nemoto-canvas-toolbar-group' : 'nemoto-journal-toolbar-group',
                className,
            )}
            {...props}
        />
    );
}

export interface NemotoToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean;
    danger?: boolean;
    label: string;
    surface?: 'standard' | 'journal';
}

export const NemotoToolbarButton = forwardRef<HTMLButtonElement, NemotoToolbarButtonProps>(
    function NemotoToolbarButton({
        active,
        className,
        danger = false,
        label,
        surface = 'standard',
        title = label,
        type = 'button',
        ...props
    }, ref) {
        return (
            <button
                ref={ref}
                aria-label={label}
                aria-pressed={active}
                data-state={active === undefined ? undefined : active ? 'on' : 'off'}
                title={title}
                type={type}
                className={clsx(
                    surface === 'journal' ? 'nemoto-journal-toolbar-button' : 'nemoto-toolbar-button',
                    danger && 'nemoto-toolbar-button-danger',
                    surface === 'journal' && 'p-1.5 rounded-sm nemoto-transition-interactive',
                    surface === 'journal' && active
                        ? 'bg-accent-primary/10 text-accent-primary shadow-[inset_0_0_8px_color-mix(in_srgb,var(--color-accent-warning)_10%,transparent)]'
                        : surface === 'journal' && 'text-text-faint hover:text-text-main hover:bg-app-hover',
                    className,
                )}
                {...props}
            />
        );
    },
);
