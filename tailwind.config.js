/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // App Foundation
                app: {
                    bg: 'var(--color-app-bg)',
                    sidebar: 'var(--color-app-sidebar)',
                    surface: 'var(--color-app-surface)',
                    header: 'var(--color-app-header)',
                    border: 'var(--color-app-border)',
                    grid: 'var(--color-app-grid)',
                    input: 'var(--color-app-input)',
                    hover: 'var(--color-app-hover)',
                    active: 'var(--color-app-active)',
                },

                // Text
                text: {
                    main: 'var(--color-text-main)',
                    muted: 'var(--color-text-muted)',
                    faint: 'var(--color-text-faint)',
                },

                // Accents
                accent: {
                    primary: 'var(--color-accent-primary)',
                    primary_text: 'var(--color-accent-primary-text)',

                    success: 'var(--color-accent-success)',
                    success_text: 'var(--color-accent-success-text)',

                    warning: 'var(--color-accent-warning)',

                    danger: 'var(--color-accent-danger)',
                    danger_dim: 'var(--color-accent-danger-dim)',

                    purple: 'var(--color-accent-purple)',
                    purple_text: 'var(--color-accent-purple-text)',

                    neutral: 'var(--color-accent-neutral)',
                    neutral_text: 'var(--color-accent-neutral-text)',
                }
            },
            fontFamily: {
                sans: ['var(--font-family-ui)'], // Body and controls
                display: ['var(--font-family-display)'], // Headers
                mono: ['var(--font-family-mono)'], // Data
            },
            borderRadius: {
                sm: 'var(--app-radius-sm)',
                md: 'var(--app-radius-md)',
                lg: 'var(--app-radius-lg)',
                xl: 'calc(var(--app-radius-lg) * 1.5)',
            },
            boxShadow: {
                // Adaptive Standard Shadows
                'sm': 'var(--app-shadow-sm)',
                'md': 'var(--app-shadow-md)',
                'lg': 'var(--app-shadow-lg)',
                'xl': 'var(--app-shadow-xl)',

                // Functional Shadows
                'float': '0 20px 50px -10px rgba(0,0,0,0.8)',
                'node': 'var(--app-shadow-md)', // Adaptive shadow
                'panel': 'var(--app-shadow-lg)', // Adaptive shadow

                // Specific Glows (Void Theme mostly)
                'glow-primary': '0 0 25px -2px rgba(59, 130, 246, 0.3)',
                'glow-primary-subtle': '0 0 15px -5px rgba(59, 130, 246, 0.15)',
                'glow-success': '0 0 25px -2px rgba(16, 185, 129, 0.3)',
                'glow-success-subtle': '0 0 15px -5px rgba(16, 185, 129, 0.15)',
                'glow-purple': '0 0 25px -2px rgba(168, 85, 247, 0.3)',
                'glow-purple-subtle': '0 0 15px -5px rgba(168, 85, 247, 0.15)',
                'glow-danger': '0 0 30px -2px rgba(239, 68, 68, 0.4)',
            },
            backgroundImage: {
                'dot-grid': 'var(--dot-grid)',
            }
        },
    },
    plugins: [],
}
