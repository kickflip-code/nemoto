import { ReactRenderer } from '@tiptap/react'
import tippy, { Instance, Props } from 'tippy.js'
import { Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare, Quote, Code, Minus, Image as ImageIcon } from 'lucide-react'
import SlashCommandList from './SlashCommandList'

export const JOURNAL_IMAGE_PROMPT_EVENT = 'axiom:journal-image-prompt'
export const JOURNAL_LOCAL_IMAGE_EVENT = 'axiom:journal-local-image'

export default {
    items: ({ query }: { query: string }) => {
        return [
            {
                title: 'Date',
                description: 'Insert today\'s date',
                icon: <Heading3 size={14} />, // Placeholder icon
                command: ({ editor, range }: any) => {
                    const date = new Date().toISOString().split('T')[0];
                    editor.chain().focus().deleteRange(range).insertContent(date).run();
                },
            },
            {
                title: 'Time',
                description: 'Insert current time',
                icon: <Heading3 size={14} />, // Placeholder icon
                command: ({ editor, range }: any) => {
                    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    editor.chain().focus().deleteRange(range).insertContent(time).run();
                },
            },
            {
                title: 'Link Process',
                description: 'Quick link to a process or resource',
                icon: <ImageIcon size={14} />, // Placeholder icon
                command: ({ editor, range }: any) => {
                    editor.chain().focus().deleteRange(range).insertContent('@').run();
                },
            },
            {
                title: 'Heading 1',
                description: 'Big section heading',
                icon: <Heading1 size={14} />,
                command: ({ editor, range }: any) => {
                    editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
                },
            },
            {
                title: 'Heading 2',
                description: 'Medium section heading',
                icon: <Heading2 size={14} />,
                command: ({ editor, range }: any) => {
                    editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
                },
            },
            {
                title: 'Heading 3',
                description: 'Small section heading',
                icon: <Heading3 size={14} />,
                command: ({ editor, range }: any) => {
                    editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
                },
            },
            {
                title: 'Bullet List',
                description: 'Create a simple list',
                icon: <List size={14} />,
                command: ({ editor, range }: any) => {
                    editor.chain().focus().deleteRange(range).toggleBulletList().run()
                },
            },
            {
                title: 'Numbered List',
                description: 'Create a list with numbering',
                icon: <ListOrdered size={14} />,
                command: ({ editor, range }: any) => {
                    editor.chain().focus().deleteRange(range).toggleOrderedList().run()
                },
            },
            {
                title: 'Task List',
                description: 'Track tasks with a todo list',
                icon: <CheckSquare size={14} />,
                command: ({ editor, range }: any) => {
                    editor.chain().focus().deleteRange(range).toggleTaskList().run()
                },
            },
            {
                title: 'Quote',
                description: 'Capture a quote',
                icon: <Quote size={14} />,
                command: ({ editor, range }: any) => {
                    editor.chain().focus().deleteRange(range).setBlockquote().run()
                },
            },
            {
                title: 'Code Block',
                description: 'Capture a code snippet',
                icon: <Code size={14} />,
                command: ({ editor, range }: any) => {
                    editor.chain().focus().deleteRange(range).setCodeBlock().run()
                },
            },
            {
                title: 'Divider',
                description: 'Visually divide content',
                icon: <Minus size={14} />,
                command: ({ editor, range }: any) => {
                    editor.chain().focus().deleteRange(range).setHorizontalRule().run()
                },
            },
            {
                title: 'Image',
                description: 'Choose an image from this computer',
                icon: <ImageIcon size={14} />,
                command: ({ editor, range }: any) => {
                    window.dispatchEvent(new CustomEvent(JOURNAL_LOCAL_IMAGE_EVENT, {
                        detail: { editor, range },
                    }))
                },
            },
            {
                title: 'Image from URL',
                description: 'Link to an external image',
                icon: <ImageIcon size={14} />,
                command: ({ editor, range }: any) => {
                    window.dispatchEvent(new CustomEvent(JOURNAL_IMAGE_PROMPT_EVENT, {
                        detail: { editor, range },
                    }))
                },
            },
        ].filter(item => item.title.toLowerCase().startsWith(query.toLowerCase())).slice(0, 10)
    },

    render: () => {
        let component: ReactRenderer | null = null
        let popup: Instance<Props>[] | null = null

        return {
            onStart: (props: any) => {
                component = new ReactRenderer(SlashCommandList, {
                    props,
                    editor: props.editor,
                })

                if (!props.clientRect) {
                    return
                }

                popup = tippy('body', {
                    getReferenceClientRect: props.clientRect,
                    appendTo: () => document.body,
                    content: component.element,
                    showOnCreate: true,
                    interactive: true,
                    trigger: 'manual',
                    placement: 'bottom-start',
                })
            },

            onUpdate(props: any) {
                component?.updateProps(props)

                if (!props.clientRect) {
                    return
                }

                popup?.[0].setProps({
                    getReferenceClientRect: props.clientRect,
                })
            },

            onKeyDown(props: any) {
                if (props.event.key === 'Escape') {
                    popup?.[0].hide()
                    return true
                }

                return (component as any)?.ref?.onKeyDown(props)
            },

            onExit() {
                popup?.[0].destroy()
                component?.destroy()
            },
        }
    },
}
