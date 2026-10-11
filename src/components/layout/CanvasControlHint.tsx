import { useEffect, useRef, type ReactNode } from 'react';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';

/** Portalled hints remain visible outside the dock's horizontal scroll area. */
export default function CanvasControlHint({ text, placement = 'top', children }: {
    text: string; placement?: 'top' | 'bottom'; children: ReactNode;
}) {
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const button = ref.current?.querySelector('button');
        if (!button) return;
        const hint = tippy(button, { content: text, placement, appendTo: () => document.body,
            trigger: 'mouseenter focus', delay: [300, 0], duration: 0 });
        return () => hint.destroy();
    }, [text, placement]);
    return <span ref={ref} className="inline-flex"
        onKeyDown={event => { if (event.key === ' ') event.stopPropagation(); }}
        onKeyUp={event => { if (event.key === ' ') event.stopPropagation(); }}
    >{children}</span>;
}
