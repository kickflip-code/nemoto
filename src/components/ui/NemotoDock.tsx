import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react';
import clsx from 'clsx';

export interface NemotoDockProps extends HTMLAttributes<HTMLDivElement> {
    'aria-label': string;
}

export const NemotoDock = forwardRef<HTMLDivElement, NemotoDockProps>(function NemotoDock(
    { className, ...props },
    ref,
) {
    return (
        <div
            ref={ref}
            role="toolbar"
            className={clsx('floating-dock-shell', className)}
            {...props}
        />
    );
});

export interface NemotoDockButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean;
    label: string;
}

export const NemotoDockButton = forwardRef<HTMLButtonElement, NemotoDockButtonProps>(
    function NemotoDockButton({ active, className, label, title = label, type = 'button', ...props }, ref) {
        return (
            <button
                ref={ref}
                type={type}
                aria-label={label}
                aria-pressed={active}
                title={title}
                className={clsx('dock-button', active && 'dock-button-active', className)}
                {...props}
            />
        );
    },
);

export function NemotoDockDivider({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            role="separator"
            aria-orientation="vertical"
            className={clsx('dock-divider', className)}
            {...props}
        />
    );
}
