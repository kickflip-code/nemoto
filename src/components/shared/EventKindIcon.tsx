import {
    CircleDot,
    Flag,
    Gauge,
    Mail,
    Radio,
    Timer,
    TriangleAlert,
    type LucideIcon,
} from 'lucide-react';
import type { EventKind } from '../../types';

const EVENT_KIND_ICONS: Record<EventKind, LucideIcon> = {
    generic: CircleDot,
    message: Mail,
    signal: Radio,
    condition: Gauge,
    timer: Timer,
    error: TriangleAlert,
    milestone: Flag,
};

export function EventKindIcon({
    kind,
    size = 12,
    className,
}: {
    kind: EventKind;
    size?: number;
    className?: string;
}) {
    const Icon = EVENT_KIND_ICONS[kind];
    return <Icon size={size} className={className} aria-hidden="true" />;
}
