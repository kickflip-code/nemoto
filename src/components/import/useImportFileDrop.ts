import { useEffect, useLayoutEffect, useRef, type DragEvent } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';

/** Native drop coordinates are physical pixels; DOM bounds are CSS pixels. */
export function useImportFileDrop(options: {
    enabled: boolean;
    desktop: boolean;
    busy: boolean;
    onFile: (file: File) => Promise<void>;
    onPath: (path: string) => Promise<void>;
    onError: (error: unknown) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const current = useRef(options);
    const pending = useRef(false);
    useLayoutEffect(() => { current.current = options; });

    const accept = async (files: File[] | string[]) => {
        const state = current.current;
        if (!state.enabled || state.busy || pending.current || files.length === 0) return;
        if (files.length !== 1) {
            state.onError(new Error('Drop one file at a time.'));
            return;
        }
        pending.current = true;
        try {
            const file = files[0];
            await (typeof file === 'string' ? state.onPath(file) : state.onFile(file));
        } catch (error) {
            state.onError(error);
        } finally {
            pending.current = false;
        }
    };

    useEffect(() => {
        if (!options.enabled || !options.desktop) return;
        let disposed = false;
        let unlisten: (() => void) | undefined;
        void getCurrentWebview().onDragDropEvent(event => {
            if (disposed || event.payload.type !== 'drop') return;
            const bounds = ref.current?.getBoundingClientRect();
            if (!bounds) return;
            const scale = window.devicePixelRatio || 1;
            const x = event.payload.position.x / scale;
            const y = event.payload.position.y / scale;
            if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return;
            void accept(event.payload.paths);
        }).then(stop => {
            if (disposed) stop();
            else unlisten = stop;
        }).catch(error => {
            if (!disposed) current.current.onError(error);
        });
        return () => { disposed = true; unlisten?.(); };
    }, [options.enabled, options.desktop]);

    return {
        ref,
        onDragOver: (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = options.busy ? 'none' : 'copy';
        },
        onDrop: (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            // Tauri intercepts OS drops; do not process a second DOM event.
            if (!options.desktop) void accept(Array.from(event.dataTransfer.files));
        },
    };
}
