export interface PaletteColor {
    id: string;
    label: string;
    hex: string;
    twText: string;
}

export const PALETTE: PaletteColor[] = [
    { id: 'gray', label: 'Gray', hex: 'var(--palette-gray, #52525b)', twText: 'text-white' },
    { id: 'white', label: 'White', hex: 'var(--palette-white, #e4e4e7)', twText: 'text-[#18181b]' },
    { id: 'blue', label: 'Blue', hex: 'var(--palette-blue, #3b82f6)', twText: 'text-white' },
    { id: 'green', label: 'Green', hex: 'var(--palette-green, #22c55e)', twText: 'text-white' },
    { id: 'purple', label: 'Purple', hex: 'var(--palette-purple, #a855f7)', twText: 'text-white' },
    { id: 'orange', label: 'Orange', hex: 'var(--palette-orange, #f97316)', twText: 'text-white' },
    { id: 'red', label: 'Red', hex: 'var(--palette-red, #ef4444)', twText: 'text-white' },
    { id: 'amber', label: 'Amber', hex: 'var(--palette-amber, #f59e0b)', twText: 'text-white' },
];

export const getPaletteColor = (idOrHex: string | undefined): string => {
    if (!idOrHex) return 'var(--palette-gray, #52525b)';
    const p = PALETTE.find(c => c.id === idOrHex);
    return p ? p.hex : idOrHex;
};
