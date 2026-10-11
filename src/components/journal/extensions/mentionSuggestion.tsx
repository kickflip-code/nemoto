import { ReactRenderer } from '@tiptap/react';
import tippy, { Instance, Props } from 'tippy.js';
import MentionList from './MentionList';

import { usePortfolioStore } from '../../../stores/usePortfolioStore';
import { listEntityCandidates } from '../../../lib/entityResolver';

export default {
    items: ({ query }: { query: string }) => {
        const portfolio = usePortfolioStore.getState().portfolio;
        const candidates = listEntityCandidates(portfolio, ['asset', 'process', 'node'])
            .map(candidate => ({
                id: candidate.reference.id,
                label: candidate.label,
                context: candidate.context,
                type: candidate.reference.type,
                entityType: candidate.reference.type,
                processId: candidate.reference.processId,
                path: candidate.reference.path,
            }));

        // Filter by query (fuzzy-ish search against label ONLY to avoid noise, remove context matching)
        const lowerQuery = query.toLowerCase().trim();

        // If query is empty, maybe show nothing or just top items? Let's show top items.
        // But we must filter if query exists.

        return candidates
            .filter(item => !lowerQuery
                || item.label.toLowerCase().includes(lowerQuery)
                || item.context.toLowerCase().includes(lowerQuery))
            .slice(0, 12); // Limit to 12 results
    },

    command: ({ editor, range, props }: any) => {
        // Increase range.to to include the full query if needed? 
        // TipTap suggestion usually passes the correct range for the query.
        // However, if we have issues, we can try to force a space after.

        editor
            .chain()
            .focus()
            .insertContentAt(range, [
                {
                    type: 'mention',
                    attrs: {
                        id: props.id,
                        label: props.label,
                        entityType: props.entityType,
                        processId: props.processId,
                        path: props.path,
                    },
                },
                {
                    type: 'text',
                    text: ' ',
                },
            ])
            .run();

        window.getSelection()?.collapseToEnd();
    },

    render: () => {
        let component: ReactRenderer | null = null;
        let popup: Instance<Props>[] | null = null;

        return {
            onStart: (props: any) => {
                component = new ReactRenderer(MentionList, {
                    props,
                    editor: props.editor,
                });

                if (!props.clientRect) {
                    return;
                }

                popup = tippy('body', {
                    getReferenceClientRect: props.clientRect,
                    appendTo: () => document.body,
                    content: component.element,
                    showOnCreate: true,
                    interactive: true,
                    trigger: 'manual',
                    placement: 'bottom-start',
                });
            },

            onUpdate(props: any) {
                component?.updateProps(props);

                if (!props.clientRect) {
                    return;
                }

                popup?.[0]?.setProps({
                    getReferenceClientRect: props.clientRect,
                });
            },

            onKeyDown(props: any) {
                if (props.event.key === 'Escape') {
                    popup?.[0]?.hide();
                    return true;
                }

                return (component?.ref as any)?.onKeyDown(props);
            },

            onExit() {
                popup?.[0]?.destroy();
                component?.destroy();
            },
        };
    },
};
