import React, { useEffect, useRef } from 'react';
import tippy, { Instance, Props } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/shift-away.css';

interface NodeTooltipProps {
    children: React.ReactElement;
    content: string | null | undefined;
    delay?: number;
}

export const NodeTooltip = ({ children, content, delay = 2000 }: NodeTooltipProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const tippyInstance = useRef<Instance<Props> | null>(null);

    useEffect(() => {
        // If content is empty or container is missing, destroy instance
        if (!containerRef.current || !content || content.trim() === '') {
            if (tippyInstance.current) {
                tippyInstance.current.destroy();
                tippyInstance.current = null;
            }
            return;
        }

        if (tippyInstance.current) {
            tippyInstance.current.setContent(content);
        } else {
            const instances = tippy(containerRef.current, {
                content,
                delay: [delay, 0], // delay on show, no delay on hide
                placement: 'top',
                animation: 'shift-away',
                theme: 'axiom',
                arrow: true,
                interactive: true,
                appendTo: () => document.body,
                maxWidth: 400, // Increased for better readability of descriptions
            });
            tippyInstance.current = Array.isArray(instances) ? instances[0] : instances;
        }

        return () => {
            if (tippyInstance.current) {
                tippyInstance.current.destroy();
                tippyInstance.current = null;
            }
        };
    }, [content, delay]);

    return (
        <div ref={containerRef} className="h-full w-full flex items-center justify-center">
            {children}
        </div>
    );
};
