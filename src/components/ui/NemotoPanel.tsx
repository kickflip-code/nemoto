import {
    forwardRef,
    type ButtonHTMLAttributes,
    type HTMLAttributes,
} from 'react';
import clsx from 'clsx';

type NemotoPanelElement = 'aside' | 'div' | 'section';

export interface NemotoPanelProps extends HTMLAttributes<HTMLElement> {
    as?: NemotoPanelElement;
}

export function NemotoPanel({ as: Component = 'div', className, ...props }: NemotoPanelProps) {
    return <Component className={clsx('nemoto-panel', className)} {...props} />;
}

export const NemotoPanelHeader = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
    function NemotoPanelHeader({ className, ...props }, ref) {
        return <header ref={ref} className={clsx('nemoto-panel-header', className)} {...props} />;
    },
);

export const NemotoPanelBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
    function NemotoPanelBody({ className, ...props }, ref) {
        return <div ref={ref} className={clsx('nemoto-panel-body', className)} {...props} />;
    },
);

export const NemotoPanelCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
    function NemotoPanelCard({ className, ...props }, ref) {
        return <div ref={ref} className={clsx('nemoto-panel-card', className)} {...props} />;
    },
);

export interface NemotoPanelDividerProps extends HTMLAttributes<HTMLDivElement> {
    orientation?: 'horizontal' | 'vertical';
}

export function NemotoPanelDivider({
    className,
    orientation = 'horizontal',
    ...props
}: NemotoPanelDividerProps) {
    return (
        <div
            aria-orientation={orientation}
            role="separator"
            className={clsx(
                'nemoto-panel-divider',
                orientation === 'horizontal' ? 'h-px' : 'w-px',
                className,
            )}
            {...props}
        />
    );
}

export interface NemotoPanelIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    'aria-label': string;
    danger?: boolean;
    size?: 'default' | 'sm';
}

export const NemotoPanelIconButton = forwardRef<HTMLButtonElement, NemotoPanelIconButtonProps>(
    function NemotoPanelIconButton({
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
                    'nemoto-panel-icon-button',
                    size === 'sm' && 'nemoto-icon-button-sm',
                    danger && 'nemoto-panel-icon-button-danger',
                    className,
                )}
                {...props}
            />
        );
    },
);

export interface NemotoPanelRowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean;
    selected?: boolean;
}

export const NemotoPanelRowButton = forwardRef<HTMLButtonElement, NemotoPanelRowButtonProps>(
    function NemotoPanelRowButton({ active = false, className, selected = false, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                type={type}
                className={clsx(
                    'nemoto-panel-row',
                    active && 'nemoto-panel-row-active',
                    selected && 'nemoto-panel-row-selected',
                    className,
                )}
                {...props}
            />
        );
    },
);
