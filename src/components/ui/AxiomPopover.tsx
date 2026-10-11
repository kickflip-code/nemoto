import { forwardRef, type HTMLAttributes } from 'react';
import clsx from 'clsx';

export type AxiomPopoverProps = HTMLAttributes<HTMLDivElement>;

export const AxiomPopover = forwardRef<HTMLDivElement, AxiomPopoverProps>(function AxiomPopover(
    { className, role = 'dialog', ...props },
    ref,
) {
    return (
        <div
            ref={ref}
            role={role}
            className={clsx('axiom-popover', className)}
            {...props}
        />
    );
});
