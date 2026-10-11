import {
    forwardRef,
    type ButtonHTMLAttributes,
    type HTMLAttributes,
} from 'react';
import clsx from 'clsx';

export type AxiomToolbarSurface = 'canvas' | 'journal';

export interface AxiomToolbarProps extends HTMLAttributes<HTMLDivElement> {
    'aria-label': string;
    surface?: AxiomToolbarSurface;
}

export const AxiomToolbar = forwardRef<HTMLDivElement, AxiomToolbarProps>(function AxiomToolbar(
    { className, surface = 'canvas', ...props },
    ref,
) {
    return (
        <div
            ref={ref}
            role="toolbar"
            className={clsx(
                surface === 'canvas' ? 'axiom-canvas-toolbar' : 'axiom-journal-toolbar',
                className,
            )}
            {...props}
        />
    );
});

export interface AxiomToolbarGroupProps extends HTMLAttributes<HTMLDivElement> {
    'aria-label'?: string;
    surface?: AxiomToolbarSurface;
}

export function AxiomToolbarGroup({
    className,
    surface = 'canvas',
    ...props
}: AxiomToolbarGroupProps) {
    return (
        <div
            role="group"
            className={clsx(
                surface === 'canvas' ? 'axiom-canvas-toolbar-group' : 'axiom-journal-toolbar-group',
                className,
            )}
            {...props}
        />
    );
}

export interface AxiomToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean;
    danger?: boolean;
    label: string;
    surface?: 'standard' | 'journal';
}

export const AxiomToolbarButton = forwardRef<HTMLButtonElement, AxiomToolbarButtonProps>(
    function AxiomToolbarButton({
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
                    surface === 'journal' ? 'axiom-journal-toolbar-button' : 'axiom-toolbar-button',
                    danger && 'axiom-toolbar-button-danger',
                    surface === 'journal' && 'p-1.5 rounded-sm axiom-transition-interactive',
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
