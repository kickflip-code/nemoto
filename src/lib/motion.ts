import type { MotionProps, Transition } from 'framer-motion';

type MotionLifecycleProps = Pick<MotionProps, 'initial' | 'animate' | 'exit'>;

export const motionDuration = {
    instant: 0.08,
    fast: 0.12,
    base: 0.18,
    slow: 0.24,
} as const;

export const motionDurationMs = {
    instant: 80,
    fast: 120,
    base: 180,
    slow: 240,
    camera: 360,
} as const;

export const prefersReducedMotion = (): boolean => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

export const getMotionDurationMs = (duration: number): number => (
    prefersReducedMotion() ? 0 : duration
);

export const motionEase = {
    standard: [0.2, 0, 0, 1] as [number, number, number, number],
    enter: [0.16, 1, 0.3, 1] as [number, number, number, number],
    exit: [0.4, 0, 1, 1] as [number, number, number, number],
};

export const panelTransition: Transition = {
    duration: motionDuration.slow,
    ease: motionEase.enter,
};

const createHorizontalPanelMotion = (offset: number): MotionLifecycleProps => ({
    initial: { width: 0, opacity: 0, x: offset },
    animate: {
        width: 'auto',
        opacity: 1,
        x: 0,
        transition: panelTransition,
    },
    exit: {
        width: 0,
        opacity: 0,
        x: offset * 0.65,
        transition: {
            duration: motionDuration.base,
            ease: motionEase.exit,
        },
    },
});

export const leftPanelMotion = createHorizontalPanelMotion(-12);
export const rightPanelMotion = createHorizontalPanelMotion(12);

export const dialogOverlayMotion: MotionLifecycleProps = {
    initial: { opacity: 0 },
    animate: {
        opacity: 1,
        transition: {
            duration: motionDuration.base,
            ease: motionEase.standard,
        },
    },
    exit: {
        opacity: 0,
        transition: {
            duration: motionDuration.fast,
            ease: motionEase.exit,
        },
    },
};

export const dialogPanelMotion: MotionLifecycleProps = {
    initial: { opacity: 0, y: 8, scale: 0.975 },
    animate: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
            duration: motionDuration.slow,
            ease: motionEase.enter,
        },
    },
    exit: {
        opacity: 0,
        y: 4,
        scale: 0.985,
        transition: {
            duration: motionDuration.fast,
            ease: motionEase.exit,
        },
    },
};

export const popoverMotion: MotionLifecycleProps = {
    initial: { opacity: 0, y: -4, scale: 0.985 },
    animate: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
            duration: motionDuration.fast,
            ease: motionEase.enter,
        },
    },
    exit: {
        opacity: 0,
        y: -2,
        scale: 0.99,
        transition: {
            duration: motionDuration.instant,
            ease: motionEase.exit,
        },
    },
};
