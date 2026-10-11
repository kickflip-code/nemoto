import { icons, Box } from 'lucide-react';

export function getIconComponent(name: string | undefined | null) {
    if (!name) return Box;

    // Exact match (TitleCase)
    let Icon = (icons as any)[name];
    if (Icon) return Icon;

    // Try finding case-insensitively
    const lowerName = name.toLowerCase();
    const iconKeys = Object.keys(icons);
    const key = iconKeys.find((k) => k.toLowerCase() === lowerName);

    if (key) {
        return (icons as any)[key];
    }

    // Fallback
    return Box;
}
