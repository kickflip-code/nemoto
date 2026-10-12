import { forwardRef, type HTMLAttributes } from 'react';
import clsx from 'clsx';

export type NemotoPopoverProps = HTMLAttributes<HTMLDivElement>;

export const NemotoPopover = forwardRef<HTMLDivElement, NemotoPopoverProps>(function NemotoPopover(
    { className, role = 'dialog', ...props },
    ref,
) {
    return (
        <div
            ref={ref}
            role={role}
            className={clsx('nemoto-popover', className)}
            {...props}
        />
    );
});
