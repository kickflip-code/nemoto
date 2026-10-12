import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from 'react'
import { NemotoMenuItem, NemotoPopover } from '../../ui'

interface SlashCommandItem {
    title: string;
    description?: string;
    icon?: ReactNode;
}

interface SlashCommandListProps {
    items: SlashCommandItem[];
    command: (item: SlashCommandItem) => void;
}

export interface SlashCommandListHandle {
    onKeyDown: ({ event }: { event: KeyboardEvent }) => boolean;
}

const SlashCommandList = forwardRef<SlashCommandListHandle, SlashCommandListProps>((props, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    const selectItem = (index: number) => {
        const item = props.items[index]

        if (item) {
            props.command(item)
        }
    }

    const upHandler = () => {
        setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length)
    }

    const downHandler = () => {
        setSelectedIndex((selectedIndex + 1) % props.items.length)
    }

    const enterHandler = () => {
        selectItem(selectedIndex)
    }

    useEffect(() => setSelectedIndex(0), [props.items])

    useImperativeHandle(ref, () => ({
        onKeyDown: ({ event }: { event: KeyboardEvent }) => {
            if (event.key === 'ArrowUp') {
                upHandler()
                return true
            }

            if (event.key === 'ArrowDown') {
                downHandler()
                return true
            }

            if (event.key === 'Enter') {
                enterHandler()
                return true
            }

            return false
        },
    }))

    if (!props.items.length) {
        return null;
    }

    return (
        <NemotoPopover
            role="listbox"
            aria-label="Editor commands"
            className="py-1 min-w-[200px] max-h-[300px] overflow-y-auto custom-scrollbar nemoto-motion-popover"
        >
            {props.items.map((item, index) => (
                <NemotoMenuItem
                    className="nemoto-suggestion-item min-h-[2.25rem] gap-2 text-sm"
                    key={`${item.title}-${index}`}
                    role="option"
                    aria-selected={index === selectedIndex}
                    onClick={() => selectItem(index)}
                >
                    {item.icon}
                    <div className="flex flex-col">
                        <span className="font-medium">{item.title}</span>
                        {item.description && <span className="text-[10px] text-text-faint">{item.description}</span>}
                    </div>
                </NemotoMenuItem>
            ))}
        </NemotoPopover>
    )
})

SlashCommandList.displayName = 'SlashCommandList'

export default SlashCommandList
