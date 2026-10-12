import {
    forwardRef,
    type ButtonHTMLAttributes,
    type InputHTMLAttributes,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from 'react';
import clsx from 'clsx';

export type NemotoControlSize = 'default' | 'sm' | 'xs';
export type NemotoButtonVariant = 'default' | 'primary' | 'danger' | 'warning' | 'ghost';

export interface NemotoButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    icon?: boolean;
    size?: Exclude<NemotoControlSize, 'xs'>;
    variant?: NemotoButtonVariant;
}

const BUTTON_VARIANT_CLASSES: Record<NemotoButtonVariant, string | undefined> = {
    default: undefined,
    primary: 'nemoto-button-primary',
    danger: 'nemoto-button-danger',
    warning: 'nemoto-button-warning',
    ghost: 'nemoto-button-ghost',
};

export const NemotoButton = forwardRef<HTMLButtonElement, NemotoButtonProps>(function NemotoButton(
    {
        className,
        icon = false,
        size = 'default',
        type = 'button',
        variant = 'default',
        ...props
    },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            className={clsx(
                icon ? 'nemoto-icon-button' : 'nemoto-button',
                size === 'sm' && (icon ? 'nemoto-icon-button-sm' : 'nemoto-button-sm'),
                icon && variant === 'warning'
                    ? 'nemoto-icon-button-warning'
                    : icon && variant === 'ghost'
                        ? 'nemoto-icon-button-ghost'
                        : BUTTON_VARIANT_CLASSES[variant],
                className,
            )}
            {...props}
        />
    );
});

interface NemotoFieldProps {
    controlSize?: NemotoControlSize;
}

const getFieldClassName = (
    size: NemotoControlSize,
    className: string | undefined,
    textarea = false,
): string => clsx(
    'nemoto-field',
    size === 'sm' && 'nemoto-field-sm',
    size === 'xs' && 'nemoto-field-xs',
    textarea && 'nemoto-field-textarea',
    className,
);

export const NemotoInput = forwardRef<
    HTMLInputElement,
    InputHTMLAttributes<HTMLInputElement> & NemotoFieldProps
>(function NemotoInput({ className, controlSize = 'default', onClick, ...props }, ref) {
    return (
        <input
            ref={ref}
            className={getFieldClassName(controlSize, className)}
            onClick={(event) => {
                onClick?.(event);
                if (props.type === 'date') {
                    try {
                        event.currentTarget.showPicker?.();
                    } catch {
                        // Safe fallback in environments without showPicker or when picker is already open
                    }
                }
            }}
            {...props}
        />
    );
});

export const NemotoSelect = forwardRef<
    HTMLSelectElement,
    SelectHTMLAttributes<HTMLSelectElement> & NemotoFieldProps
>(function NemotoSelect({ className, controlSize = 'default', ...props }, ref) {
    return <select ref={ref} className={getFieldClassName(controlSize, className)} {...props} />;
});

export const NemotoTextarea = forwardRef<
    HTMLTextAreaElement,
    TextareaHTMLAttributes<HTMLTextAreaElement> & NemotoFieldProps
>(function NemotoTextarea({ className, controlSize = 'default', ...props }, ref) {
    return <textarea ref={ref} className={getFieldClassName(controlSize, className, true)} {...props} />;
});

export const NemotoRange = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
    function NemotoRange({ className, type = 'range', ...props }, ref) {
        return <input ref={ref} type={type} className={clsx('nemoto-range', className)} {...props} />;
    },
);
