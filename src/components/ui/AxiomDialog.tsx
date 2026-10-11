import {
    createContext,
    forwardRef,
    useContext,
    useEffect,
    useRef,
    type HTMLAttributes,
    type KeyboardEvent,
    type RefObject,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { dialogOverlayMotion, dialogPanelMotion } from '../../lib/motion';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Modal depth follows the React tree even when a dialog uses a portal. */
export const AxiomDialogContext = createContext(0);

export interface AxiomDialogProps {
    'aria-describedby'?: string;
    'aria-labelledby': string;
    children: ReactNode;
    closeOnBackdrop?: boolean;
    initialFocusRef?: RefObject<HTMLElement | null>;
    /** For self-contained dialogs whose controls do not open external portals. */
    isolateBackground?: boolean;
    onClose: () => void;
    panelClassName?: string;
    rootClassName?: string;
}

const getFocusableElements = (container: HTMLElement): HTMLElement[] => (
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(element => {
            if (element.tabIndex < 0 || element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return false;
            for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
                if (ancestor.hidden || ancestor.hasAttribute('inert')) return false;
                const style = getComputedStyle(ancestor);
                if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
                if (ancestor === container) break;
            }
            return true;
        })
);

export function AxiomDialog({
    'aria-describedby': ariaDescribedBy,
    'aria-labelledby': ariaLabelledBy,
    children,
    closeOnBackdrop = true,
    initialFocusRef,
    isolateBackground = false,
    onClose,
    panelClassName,
    rootClassName = 'z-[10100]',
}: AxiomDialogProps) {
    const dialogDepth = useContext(AxiomDialogContext) + 1;
    const panelRef = useRef<HTMLDivElement>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(
        document.activeElement instanceof HTMLElement ? document.activeElement : null,
    );

    useEffect(() => {
        const panel = panelRef.current;
        if (panel) {
            const requestedInitialFocus = initialFocusRef?.current;
            if (requestedInitialFocus) {
                requestedInitialFocus.focus();
            } else if (!panel.contains(document.activeElement)) {
                panel.focus();
            }
        }

        // aria-modal alone does not consistently constrain screen-reader browse
        // navigation. Hide sibling branches too, without hiding the dialog's ancestors.
        const background = new Map<Element, { inert: string | null; hidden: string | null }>();
        const isolate = () => {
            if (!panel?.isConnected) return;
            let branch: Element = panel.parentElement!;
            while (branch.parentElement) {
                for (const sibling of Array.from(branch.parentElement.children)) {
                    if (sibling === branch || background.has(sibling)) continue;
                    background.set(sibling, { inert: sibling.getAttribute('inert'), hidden: sibling.getAttribute('aria-hidden') });
                    sibling.setAttribute('inert', '');
                    sibling.setAttribute('aria-hidden', 'true');
                }
                branch = branch.parentElement;
                if (branch === document.body) break;
            }
        };
        const observer = isolateBackground ? new MutationObserver(isolate) : null;
        if (isolateBackground) {
            isolate();
            observer?.observe(document.body, { childList: true, subtree: true });
        }

        return () => {
            observer?.disconnect();
            for (const [element, original] of background) {
                if (original.inert === null) element.removeAttribute('inert');
                else element.setAttribute('inert', original.inert);
                if (original.hidden === null) element.removeAttribute('aria-hidden');
                else element.setAttribute('aria-hidden', original.hidden);
            }
            previouslyFocusedRef.current?.focus();
        };
    }, [initialFocusRef, isolateBackground]);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
        }

        if (event.key !== 'Tab' || !panelRef.current) return;
        event.stopPropagation();

        const focusable = getFocusableElements(panelRef.current);
        if (focusable.length === 0) {
            event.preventDefault();
            panelRef.current.focus();
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && (active === first || active === panelRef.current || !panelRef.current.contains(active))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };

    return createPortal(
        <AxiomDialogContext.Provider value={dialogDepth}>
        <motion.div
            {...dialogOverlayMotion}
            style={dialogDepth > 1 ? { zIndex: 10100 + 200 * (dialogDepth - 1) } : undefined}
            className={clsx(
                'fixed inset-0 flex items-center justify-center p-4',
                rootClassName,
            )}
            onKeyDown={handleKeyDown}
        >
            <div
                aria-hidden="true"
                className="axiom-dialog-backdrop absolute inset-0"
                onClick={closeOnBackdrop ? onClose : undefined}
            />
            <motion.div
                {...dialogPanelMotion}
                ref={panelRef}
                aria-describedby={ariaDescribedBy}
                aria-labelledby={ariaLabelledBy}
                aria-modal="true"
                className={clsx('axiom-dialog-panel relative', panelClassName)}
                role="dialog"
                tabIndex={-1}
            >
                {children}
            </motion.div>
        </motion.div>
        </AxiomDialogContext.Provider>,
        document.body,
    );
}

export const AxiomDialogHeader = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
    function AxiomDialogHeader({ className, ...props }, ref) {
        return <header ref={ref} className={clsx('axiom-dialog-header', className)} {...props} />;
    },
);

export const AxiomDialogBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
    function AxiomDialogBody({ className, ...props }, ref) {
        return <div ref={ref} className={clsx('axiom-dialog-body', className)} {...props} />;
    },
);

export const AxiomDialogFooter = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
    function AxiomDialogFooter({ className, ...props }, ref) {
        return <footer ref={ref} className={clsx('axiom-dialog-footer', className)} {...props} />;
    },
);
