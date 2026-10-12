import { useContext, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LucideIcon } from 'lucide-react';
import { NemotoMenu, NemotoMenuDivider, NemotoMenuItem } from '../ui';
import { NemotoDialogContext } from '../ui/NemotoDialog';

export interface ContextMenuItem {
    label?: string;
    icon?: LucideIcon;
    action?: () => void;
    disabled?: boolean;
    danger?: boolean;
    separator?: boolean;
    shortcut?: string;
    submenu?: ContextMenuItem[];
}

interface ContextMenuProps {
    items: ContextMenuItem[];
    x: number;
    y: number;
    onClose: () => void;
}

export default function ContextMenu({ items, x, y, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const dialogDepth = useContext(NemotoDialogContext);

    // Escape is handled by NemotoMenu, without reaching a containing dialog.
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    // Position adjustment to stay within viewport
    // simple implementation - for production maybe use something like floating-ui
    const adjustedX = Math.max(8, Math.min(x, window.innerWidth - 220));
    const adjustedY = Math.max(8, Math.min(y, window.innerHeight - (items.length * 36 + 20)));

    return createPortal(
        <NemotoMenu
            ref={menuRef}
            aria-label="Context actions"
            className="fixed min-w-[200px] max-h-[calc(100vh-16px)] overflow-y-auto nemoto-motion-popover"
            onClose={onClose}
            style={{ top: adjustedY, left: adjustedX, zIndex: dialogDepth ? 10200 + 200 * (dialogDepth - 1) : 9999 }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {items.map((item, index) => {
                if (item.separator) {
                    return <NemotoMenuDivider key={index} />;
                }

                const Icon = item.icon;

                return (
                    <NemotoMenuItem
                        key={index}
                        onClick={() => {
                            if (item.action && !item.disabled) {
                                item.action();
                                onClose();
                            }
                        }}
                        disabled={item.disabled}
                        danger={item.danger}
                    >
                        {Icon && <Icon size={14} />}
                        <span className="flex-1">{item.label}</span>
                        {item.shortcut && <span className="text-xs text-text-faint">{item.shortcut}</span>}
                    </NemotoMenuItem>
                );
            })}
        </NemotoMenu>,
        document.body
    );
}
