import React from 'react';

interface AxiomIconProps {
    className?: string;
    size?: number | string;
    showBackground?: boolean;
}

/**
 * AxiomIcon - The official "Connected Node" branding icon for AXIOM (V2).
 * Uses solid graph geometry for maximum readability and scalability.
 */
export const AxiomIcon: React.FC<AxiomIconProps> = ({
    className = "",
    size = 512,
    showBackground = true
}) => {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 512 512"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            {showBackground && (
                <rect width="512" height="512" rx="120" fill="var(--color-app-bg, #0A0A0A)" />
            )}

            <defs>
                <filter id="axiom-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="12" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </defs>

            <g transform="translate(0, 10)">
                {/* Edges (Lines) */}
                <path
                    d="M256 100 L120 400 M256 100 L392 400 M165 300 L347 300"
                    stroke="var(--color-accent-primary, #FBBF24)"
                    strokeWidth="48"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {/* Vertices (Nodes) */}
                <circle cx="256" cy="100" r="48" fill="var(--color-accent-primary, #FBBF24)" filter="url(#axiom-glow)" />
                <circle cx="120" cy="400" r="48" fill="var(--color-accent-primary, #FBBF24)" filter="url(#axiom-glow)" />
                <circle cx="392" cy="400" r="48" fill="var(--color-accent-primary, #FBBF24)" filter="url(#axiom-glow)" />

                {/* Central Hub Node */}
                <circle cx="256" cy="300" r="32" fill="var(--color-app-bg, #0A0A0A)" stroke="var(--color-accent-primary, #FBBF24)" strokeWidth="16" />
            </g>
        </svg>
    );
};
