import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Box, LayoutGrid, Server } from 'lucide-react';
import { NemotoMenuItem, NemotoPopover } from '../../ui';

interface MentionItem {
    id: string;
    label: string;
    context?: string;
    type: 'asset' | 'process' | 'node';
    entityType: 'asset' | 'process' | 'node';
    processId?: string;
    path?: string[];
}

interface MentionListProps {
    items: MentionItem[];
    command: (item: MentionItem) => void;
}

const MentionList = forwardRef((props: MentionListProps, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const selectItem = (index: number) => {
        const item = props.items[index];
        if (item) {
            props.command(item);
        }
    };

    const upHandler = () => {
        setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
    };

    const downHandler = () => {
        setSelectedIndex((selectedIndex + 1) % props.items.length);
    };

    const enterHandler = () => {
        selectItem(selectedIndex);
    };

    useEffect(() => setSelectedIndex(0), [props.items]);

    useImperativeHandle(ref, () => ({
        onKeyDown: ({ event }: { event: KeyboardEvent }) => {
            if (event.key === 'ArrowUp') {
                upHandler();
                return true;
            }
            if (event.key === 'ArrowDown') {
                downHandler();
                return true;
            }
            if (event.key === 'Enter') {
                enterHandler();
                return true;
            }
            return false;
        },
    }));

    if (props.items.length === 0) {
        return (
            <NemotoPopover role="status" className="p-3 text-text-faint text-xs">
                No resources found
            </NemotoPopover>
        );
    }

    return (
        <NemotoPopover
            role="listbox"
            aria-label="Entity suggestions"
            className="py-1 overflow-hidden min-w-[200px] max-h-[300px] overflow-y-auto custom-scrollbar"
        >
            {props.items.map((item, index) => (
                <NemotoMenuItem
                    key={item.id}
                    role="option"
                    aria-selected={index === selectedIndex}
                    onClick={() => selectItem(index)}
                    className="nemoto-suggestion-item min-h-[2.25rem] gap-2.5 text-sm"
                >
                    {item.type === 'asset' ? (
                        <Box size={14} className="text-accent-primary shrink-0 mt-0.5" />
                    ) : item.type === 'node' ? (
                        <Server size={14} className="text-accent-purple shrink-0 mt-0.5" />
                    ) : (
                        <LayoutGrid size={14} className="text-accent-primary shrink-0 mt-0.5" />
                    )}
                    <div className="flex flex-col min-w-0 flex-1 text-left">
                        <span className="truncate font-medium text-text-main">{item.label}</span>
                        {item.context && (
                            <span className="truncate text-[10px] text-text-muted mt-0.5 w-full block" title={item.context}>
                                <span className="opacity-50 mr-1">in</span>{item.context}
                            </span>
                        )}
                    </div>
                </NemotoMenuItem>
            ))}
        </NemotoPopover>
    );
});

MentionList.displayName = 'MentionList';

export default MentionList;
