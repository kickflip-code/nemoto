import type { Editor } from '@tiptap/core';
import PromptModal from '../shared/PromptModal';
import JournalLinkPopover from './JournalLinkPopover';
import JournalMentionContextMenu, {
    type JournalMentionMenuState,
} from './JournalMentionContextMenu';

export interface JournalLinkPopoverState {
    x: number;
    y: number;
    href: string;
}

export interface JournalLinkPromptState {
    isOpen: boolean;
    defaultValue: string;
}

export interface JournalImagePromptState {
    isOpen: boolean;
    range: { from: number; to: number } | null;
}

interface JournalEditorDialogsProps {
    editor: Editor;
    mentionMenu: JournalMentionMenuState | null;
    linkPopover: JournalLinkPopoverState | null;
    linkPrompt: JournalLinkPromptState;
    imagePrompt: JournalImagePromptState;
    onMentionMenuClose: () => void;
    onLinkApply: (value: string) => void;
    onLinkOpen: (value: string) => void;
    onLinkPopoverClose: () => void;
    onLinkPromptClose: () => void;
    onLinkPromptConfirm: (value: string) => boolean;
    onImagePromptClose: () => void;
    onImagePromptConfirm: (value: string) => boolean;
}

export default function JournalEditorDialogs({
    editor,
    mentionMenu,
    linkPopover,
    linkPrompt,
    imagePrompt,
    onMentionMenuClose,
    onLinkApply,
    onLinkOpen,
    onLinkPopoverClose,
    onLinkPromptClose,
    onLinkPromptConfirm,
    onImagePromptClose,
    onImagePromptConfirm,
}: JournalEditorDialogsProps) {
    return (
        <>
            {mentionMenu && (
                <JournalMentionContextMenu state={mentionMenu} onClose={onMentionMenuClose} />
            )}

            {linkPopover && (
                <JournalLinkPopover
                    x={linkPopover.x}
                    y={linkPopover.y}
                    href={linkPopover.href}
                    onApply={onLinkApply}
                    onOpen={onLinkOpen}
                    onRemove={() => {
                        editor.chain().focus().extendMarkRange('link').unsetLink().run();
                        onLinkPopoverClose();
                    }}
                    onClose={onLinkPopoverClose}
                />
            )}

            <PromptModal
                isOpen={linkPrompt.isOpen}
                onClose={onLinkPromptClose}
                onConfirm={onLinkPromptConfirm}
                title="Edit Link"
                message="Enter the URL for this link."
                defaultValue={linkPrompt.defaultValue}
                placeholder="https://..."
            />

            <PromptModal
                isOpen={imagePrompt.isOpen}
                onClose={onImagePromptClose}
                onConfirm={onImagePromptConfirm}
                title="Insert Image"
                message="Enter the image URL to insert into this note."
                placeholder="https://..."
                confirmLabel="Insert"
            />
        </>
    );
}
