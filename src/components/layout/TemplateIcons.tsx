import React from 'react';

export const HorizontalSwimlaneIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <rect x="2" y="4" width="20" height="16" rx="3" />
        {/* Lane dividers */}
        <line x1="2" y1="9.5" x2="22" y2="9.5" strokeOpacity="0.3" strokeWidth="1.5" />
        <line x1="2" y1="15" x2="22" y2="15" strokeOpacity="0.3" strokeWidth="1.5" />
        {/* Process nodes */}
        <rect x="5" y="6" width="4" height="2" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="11" y="11.5" width="4" height="2" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="15" y="17" width="4" height="2" rx="0.5" fill="currentColor" stroke="none" strokeOpacity="0.6" />
    </svg>
);

export const VerticalProcessIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <rect x="4" y="2" width="16" height="20" rx="3" />
        {/* Column dividers */}
        <line x1="9.5" y1="2" x2="9.5" y2="22" strokeOpacity="0.3" strokeWidth="1.5" />
        <line x1="15" y1="2" x2="15" y2="22" strokeOpacity="0.3" strokeWidth="1.5" />
        {/* Process nodes */}
        <rect x="6" y="5" width="2" height="4" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="11.5" y="11" width="2" height="4" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="17" y="15" width="2" height="4" rx="0.5" fill="currentColor" stroke="none" strokeOpacity="0.6" />
    </svg>
);

export const BlankCanvasIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
        {/* subtle grid points */}
        <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" opacity="0.3" />
        <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none" opacity="0.3" />
        <circle cx="17" cy="7" r="1.5" fill="currentColor" stroke="none" opacity="0.3" />

        <circle cx="7" cy="12" r="1.5" fill="currentColor" stroke="none" opacity="0.3" />
        <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" opacity="0.8" /> {/* Center emphasized */}
        <circle cx="17" cy="12" r="1.5" fill="currentColor" stroke="none" opacity="0.3" />

        <circle cx="7" cy="17" r="1.5" fill="currentColor" stroke="none" opacity="0.3" />
        <circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" opacity="0.3" />
        <circle cx="17" cy="17" r="1.5" fill="currentColor" stroke="none" opacity="0.3" />

        {/* subtle framing corners */}
        <path d="M4 8 V4 H8" strokeOpacity="0.5" />
        <path d="M16 4 H20 V8" strokeOpacity="0.5" />
        <path d="M4 16 V20 H8" strokeOpacity="0.5" />
        <path d="M16 20 H20 V16" strokeOpacity="0.5" />
    </svg>
);
