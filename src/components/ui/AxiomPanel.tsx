import {
    forwardRef,
    type ButtonHTMLAttributes,
    type HTMLAttributes,
} from 'react';
import clsx from 'clsx';

type AxiomPanelElement = 'aside' | 'div' | 'section';

export interface AxiomPanelProps extends HTMLAttributes<HTMLElement> {
    as?: AxiomPanelElement;
}

export function AxiomPanel({ as: Component = 'div', className, ...props }: AxiomPanelProps) {
    return <Component className={clsx('axiom-panel', className)} {...props} />;
}

export const AxiomPanelHeader = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
    function AxiomPanelHeader({ className, ...props }, ref) {
        return <header ref={ref} className={clsx('axiom-panel-header', className)} {...props} />;
    },
);

export const AxiomPanelBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
    function AxiomPanelBody({ className, ...props }, ref) {
        return <div ref={ref} className={clsx('axiom-panel-body', className)} {...props} />;
    },
);

export const AxiomPanelCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
    function AxiomPanelCard({ className, ...props }, ref) {
        return <div ref={ref} className={clsx('axiom-panel-card', className)} {...props} />;
    },
);

export interface AxiomPanelDividerProps extends HTMLAttributes<HTMLDivElement> {
    orientation?: 'horizontal' | 'vertical';
}

export function AxiomPanelDivider({
    className,
    orientation = 'horizontal',
    ...props
}: AxiomPanelDividerProps) {
    return (
        <div
            aria-orientation={orientation}
            role="separator"
            className={clsx(
                'axiom-panel-divider',
                orientation === 'horizontal' ? 'h-px' : 'w-px',
                className,
            )}
            {...props}
        />
    );
}

export interface AxiomPanelIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    'aria-label': string;
    danger?: boolean;
    size?: 'default' | 'sm';
}

export const AxiomPanelIconButton = forwardRef<HTMLButtonElement, AxiomPanelIconButtonProps>(
    function AxiomPanelIconButton({
        className,
        danger = false,
        size = 'default',
        type = 'button',
        ...props
    }, ref) {
        return (
            <button
                ref={ref}
                type={type}
                className={clsx(
                    'axiom-panel-icon-button',
                    size === 'sm' && 'axiom-icon-button-sm',
                    danger && 'axiom-panel-icon-button-danger',
                    className,
                )}
                {...props}
            />
        );
    },
);

export interface AxiomPanelRowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean;
    selected?: boolean;
}

export const AxiomPanelRowButton = forwardRef<HTMLButtonElement, AxiomPanelRowButtonProps>(
    function AxiomPanelRowButton({ active = false, className, selected = false, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                type={type}
                className={clsx(
                    'axiom-panel-row',
                    active && 'axiom-panel-row-active',
                    selected && 'axiom-panel-row-selected',
                    className,
                )}
                {...props}
            />
        );
    },
);
