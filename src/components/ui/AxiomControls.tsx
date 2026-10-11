import {
    forwardRef,
    type ButtonHTMLAttributes,
    type InputHTMLAttributes,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from 'react';
import clsx from 'clsx';

export type AxiomControlSize = 'default' | 'sm' | 'xs';
export type AxiomButtonVariant = 'default' | 'primary' | 'danger' | 'warning' | 'ghost';

export interface AxiomButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    icon?: boolean;
    size?: Exclude<AxiomControlSize, 'xs'>;
    variant?: AxiomButtonVariant;
}

const BUTTON_VARIANT_CLASSES: Record<AxiomButtonVariant, string | undefined> = {
    default: undefined,
    primary: 'axiom-button-primary',
    danger: 'axiom-button-danger',
    warning: 'axiom-button-warning',
    ghost: 'axiom-button-ghost',
};

export const AxiomButton = forwardRef<HTMLButtonElement, AxiomButtonProps>(function AxiomButton(
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
                icon ? 'axiom-icon-button' : 'axiom-button',
                size === 'sm' && (icon ? 'axiom-icon-button-sm' : 'axiom-button-sm'),
                icon && variant === 'warning'
                    ? 'axiom-icon-button-warning'
                    : icon && variant === 'ghost'
                        ? 'axiom-icon-button-ghost'
                        : BUTTON_VARIANT_CLASSES[variant],
                className,
            )}
            {...props}
        />
    );
});

interface AxiomFieldProps {
    controlSize?: AxiomControlSize;
}

const getFieldClassName = (
    size: AxiomControlSize,
    className: string | undefined,
    textarea = false,
): string => clsx(
    'axiom-field',
    size === 'sm' && 'axiom-field-sm',
    size === 'xs' && 'axiom-field-xs',
    textarea && 'axiom-field-textarea',
    className,
);

export const AxiomInput = forwardRef<
    HTMLInputElement,
    InputHTMLAttributes<HTMLInputElement> & AxiomFieldProps
>(function AxiomInput({ className, controlSize = 'default', onClick, ...props }, ref) {
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

export const AxiomSelect = forwardRef<
    HTMLSelectElement,
    SelectHTMLAttributes<HTMLSelectElement> & AxiomFieldProps
>(function AxiomSelect({ className, controlSize = 'default', ...props }, ref) {
    return <select ref={ref} className={getFieldClassName(controlSize, className)} {...props} />;
});

export const AxiomTextarea = forwardRef<
    HTMLTextAreaElement,
    TextareaHTMLAttributes<HTMLTextAreaElement> & AxiomFieldProps
>(function AxiomTextarea({ className, controlSize = 'default', ...props }, ref) {
    return <textarea ref={ref} className={getFieldClassName(controlSize, className, true)} {...props} />;
});

export const AxiomRange = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
    function AxiomRange({ className, type = 'range', ...props }, ref) {
        return <input ref={ref} type={type} className={clsx('axiom-range', className)} {...props} />;
    },
);
