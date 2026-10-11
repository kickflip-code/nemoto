import {
    forwardRef,
    useEffect,
    useRef,
    type ButtonHTMLAttributes,
    type HTMLAttributes,
    type KeyboardEvent,
} from 'react';
import clsx from 'clsx';

export interface AxiomMenuProps extends HTMLAttributes<HTMLDivElement> {
    onClose?: () => void;
    surface?: 'file' | 'context';
}

const getEnabledItems = (menu: HTMLElement): HTMLElement[] => (
    Array.from(menu.querySelectorAll<HTMLElement>(
        '[role^="menuitem"]:not(:disabled):not([aria-disabled="true"])',
    ))
);

export const AxiomMenu = forwardRef<HTMLDivElement, AxiomMenuProps>(function AxiomMenu(
    {
        children,
        className,
        onClose,
        onKeyDown,
        surface = 'context',
        ...props
    },
    forwardedRef,
) {
    const localRef = useRef<HTMLDivElement | null>(null);
    const mountedRef = useRef(false);
    const previouslyFocusedRef = useRef<HTMLElement | null>(
        document.activeElement instanceof HTMLElement ? document.activeElement : null,
    );

    useEffect(() => {
        mountedRef.current = true;
        const menu = localRef.current;
        if (menu && !menu.contains(document.activeElement)) {
            const items = getEnabledItems(menu);
            // StrictMode can replay setup after restoring the trigger, after
            // React's one-time autoFocus has already run.
            (items.find(item => item.getAttribute('aria-checked') === 'true') ?? items[0] ?? menu).focus();
        }
        return () => {
            mountedRef.current = false;
            // Do not steal focus from an action's newly opened dialog or an
            // outside control. Restore it when focus still belongs to this menu.
            if (document.activeElement === document.body || menu?.contains(document.activeElement)) {
                previouslyFocusedRef.current?.focus();
            }
        };
    }, []);

    useEffect(() => {
        const closeWhenFocusLeaves = (event: FocusEvent) => {
            if (mountedRef.current && event.target instanceof Node && !localRef.current?.contains(event.target)) onClose?.();
        };
        document.addEventListener('focusin', closeWhenFocusLeaves);
        return () => document.removeEventListener('focusin', closeWhenFocusLeaves);
    }, [onClose]);

    const setRef = (element: HTMLDivElement | null) => {
        localRef.current = element;
        if (typeof forwardedRef === 'function') forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || !localRef.current) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose?.();
            return;
        }

        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

        const items = getEnabledItems(localRef.current);
        if (items.length === 0) return;

        event.preventDefault();
        const currentIndex = items.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.key === 'Home'
            ? 0
            : event.key === 'End'
                ? items.length - 1
                : event.key === 'ArrowUp'
                    ? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
                    : (currentIndex + 1) % items.length;

        items[nextIndex].focus();
    };

    return (
        <div
            ref={setRef}
            role="menu"
            tabIndex={-1}
            className={clsx(
                surface === 'file' ? 'axiom-file-menu' : 'axiom-context-menu',
                className,
            )}
            onKeyDown={handleKeyDown}
            {...props}
        >
            {children}
        </div>
    );
});

export interface AxiomMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    compact?: boolean;
    danger?: boolean;
}

export const AxiomMenuItem = forwardRef<HTMLButtonElement, AxiomMenuItemProps>(function AxiomMenuItem(
    {
        className,
        compact = false,
        danger = false,
        role = 'menuitem',
        type = 'button',
        ...props
    },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            role={role}
            className={clsx(
                'axiom-menu-item',
                compact && 'axiom-menu-item-compact',
                danger && 'axiom-menu-item-danger',
                className,
            )}
            {...props}
        />
    );
});

export function AxiomMenuDivider({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div role="separator" className={clsx('axiom-menu-divider', className)} {...props} />;
}
