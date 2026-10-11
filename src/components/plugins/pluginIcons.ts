import {
    ClipboardCheck,
    GraduationCap,
    Puzzle,
    ShieldCheck,
    type LucideIcon,
} from 'lucide-react';
import type { PluginViewContributionSchema } from '../../plugins/contributionSchemas';
import type { z } from 'zod';

type PluginViewIcon = z.infer<typeof PluginViewContributionSchema>['navigation']['icon'];

const PLUGIN_ICONS: Record<PluginViewIcon, LucideIcon> = {
    ClipboardCheck,
    GraduationCap,
    Puzzle,
    ShieldCheck,
};

export const getPluginIcon = (icon: PluginViewIcon): LucideIcon => PLUGIN_ICONS[icon];

