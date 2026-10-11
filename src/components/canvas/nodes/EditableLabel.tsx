import { useState, useRef, useEffect, useLayoutEffect, forwardRef, useImperativeHandle } from 'react';
import clsx from 'clsx';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import { useUIStore } from '../../../stores/useUIStore';

// Interface for the exposed methods
export interface EditableLabelHandle {
    startEditing: () => void;
}

interface EditableLabelProps {
    id: string;
    label: string;
    color: string;
    className?: string;
    style?: React.CSSProperties;
    onEditStart?: () => void;
    onEditEnd?: () => void;
    multiline?: boolean;
}

export const EditableLabel = forwardRef<EditableLabelHandle, EditableLabelProps>(({ id, label, color, className, style, onEditStart, onEditEnd, multiline }, ref) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(label);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
    const { updateNode } = useCanvasStore.getState();
    const setEditingNodeId = useUIStore(state => state.setEditingNodeId);

    const clearEditingNode = () => {
        if (useUIStore.getState().editingNodeId === id) {
            setEditingNodeId(null);
        }
    };

    const startEditing = () => {
        if (isEditing) return;
        setEditingNodeId(id);
        setIsEditing(true);
        onEditStart?.();
    };

    // Expose startEditing to parent
    useImperativeHandle(ref, () => ({
        startEditing,
    }), [isEditing, onEditStart]);

    // Update local state when prop changes (unless editing)
    useEffect(() => {
        if (!isEditing) setValue(label);
    }, [label, isEditing]);

    useEffect(() => () => {
        clearEditingNode();
    }, [id, setEditingNodeId]);

    // Auto-focus alone leaves browser-dependent caret placement. Explicitly
    // place it after the label so a double-click continues from the text.
    useLayoutEffect(() => {
        if (!isEditing || !inputRef.current) return;

        const editor = inputRef.current;
        editor.focus({ preventScroll: true });
        const end = editor.value.length;
        editor.setSelectionRange(end, end);

        // React Flow attaches native drag listeners to the node wrapper. Stop
        // pointer events natively at the editor so browser text selection still
        // gets its default action, but the wrapper never receives the gesture.
        const stopAtEditor = (event: Event) => event.stopPropagation();
        const editorEvents = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'dblclick'] as const;
        editorEvents.forEach(eventName => editor.addEventListener(eventName, stopAtEditor));

        return () => {
            editorEvents.forEach(eventName => editor.removeEventListener(eventName, stopAtEditor));
        };
    }, [isEditing]);

    // Auto-resize textarea to fit content and prevent multiline notes/nodes from shrinking on edit
    useLayoutEffect(() => {
        if (!isEditing || !multiline || !inputRef.current) return;
        const textarea = inputRef.current as HTMLTextAreaElement;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.max(textarea.scrollHeight, 24)}px`;
    }, [isEditing, multiline, value]);

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation(); // Stop bubbling so parent doesn't also try to trigger
        startEditing();
    };

    const handleBlur = () => {
        clearEditingNode();
        setIsEditing(false);
        if (value !== label) {
            updateNode(id, { label: value });
        }
        if (onEditEnd) onEditEnd();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !multiline) {
            inputRef.current?.blur();
        }
        // For multiline, Enter adds newline. Ctrl+Enter or Escape to save/exit.
        if (e.key === 'Enter' && multiline && e.ctrlKey) {
            inputRef.current?.blur();
        }
        if (e.key === 'Escape') {
            clearEditingNode();
            setValue(label);
            setIsEditing(false);
            if (onEditEnd) onEditEnd();
        }
        // Stop propagation to prevent deleting node when pressing Backspace/Delete in input
        e.stopPropagation();
    };

    if (isEditing) {
        if (multiline) {
            return (
                <textarea
                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    draggable={false}
                    autoFocus
                    aria-label="Edit node label"
                    className={clsx(
                        "bg-transparent outline-none text-center min-w-[20px] w-full resize-none pointer-events-auto nodrag nopan overflow-hidden editable-label whitespace-pre-wrap select-text",
                        className
                    )}
                    style={{
                        ...style,
                        color: color,
                        caretColor: color,
                        userSelect: 'text',
                        fieldSizing: 'content' as any,
                    }}
                />
            );
        }
        return (
            <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                draggable={false}
                autoFocus
                aria-label="Edit node label"
                className={clsx("bg-transparent outline-none text-center min-w-[20px] w-full pointer-events-auto nodrag nopan editable-label select-text", className)}
                style={{ ...style, color: color, caretColor: color, userSelect: 'text' }}
            />
        );
    }

    return (
        <span
            onDoubleClick={handleDoubleClick}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            draggable={false}
            className={clsx(
                "cursor-text hover:opacity-80 transition-opacity pointer-events-auto whitespace-pre-wrap break-words editable-label nodrag nopan select-text",
                className
            )}
            style={{ ...style, color: color, userSelect: 'text' }}
            title="Double-click to edit"
        >
            {label}
        </span>
    );
});
EditableLabel.displayName = 'EditableLabel';
