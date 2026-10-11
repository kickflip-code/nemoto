import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';

export interface Column<T> {
    key: string;
    header: string;
    width?: string;
    render?: (item: T) => React.ReactNode;
    sortable?: boolean;
}

interface PowerTableProps<T> {
    data: T[];
    columns: Column<T>[];
    selectedIds: Set<string>;
    onSelectionChange: (ids: Set<string>) => void;
    idKey?: string; // Default to 'id'
    getItemLabel?: (item: T) => string;
    emptyState?: {
        icon?: React.ReactNode;
        title: string;
        message: string;
    };
}

export default function PowerTable<T extends Record<string, any>>({
    data,
    columns,
    selectedIds,
    onSelectionChange,
    idKey = 'id',
    getItemLabel,
    emptyState
}: PowerTableProps<T>) {
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

    // Sorting Logic
    const sortedData = useMemo(() => {
        if (!sortConfig) return data;
        return [...data].sort((a, b) => {
            const aVal = a[sortConfig.key];
            const bVal = b[sortConfig.key];

            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [data, sortConfig]);

    // Selection Logic
    const toggleSelectAll = () => {
        if (selectedIds.size === data.length) {
            onSelectionChange(new Set());
        } else {
            onSelectionChange(new Set(data.map(item => item[idKey])));
        }
    };

    const toggleRow = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        onSelectionChange(newSet);
    };

    const handleHeaderClick = (column: Column<T>) => {
        if (!column.sortable) return;
        setSortConfig(current => {
            if (current?.key === column.key) {
                return { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key: column.key, direction: 'asc' };
        });
    };

    return (
        <div className="w-full h-full overflow-auto custom-scrollbar">
            <table className="w-full text-left text-sm border-collapse">
                <thead className="bg-app-sidebar sticky top-0 z-10 shadow-sm border-b border-app-border">
                    <tr>
                        {/* Checkbox Header */}
                        <th className="w-12 px-4 py-3 text-center border-r border-app-border">
                            <input
                                type="checkbox"
                                aria-label="Select all visible items"
                                className="accent-accent-primary cursor-pointer w-4 h-4 bg-app-hover border-none rounded"
                                checked={data.length > 0 && selectedIds.size === data.length}
                                onChange={toggleSelectAll}
                            />
                        </th>

                        {/* Columns */}
                        {columns.map(col => (
                            <th
                                key={col.key}
                                className={`px-4 py-3 font-semibold text-text-muted uppercase tracking-wider text-[11px] select-none ${col.sortable ? 'cursor-pointer hover:text-text-main hover:bg-app-hover transition-colors' : ''}`}
                                style={{ width: col.width }}
                                onClick={() => handleHeaderClick(col)}
                            >
                                <div className="flex items-center gap-2">
                                    {col.header}
                                    {col.sortable && (
                                        <div className="text-text-faint">
                                            {sortConfig?.key === col.key ? (
                                                sortConfig.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                                            ) : (
                                                <ChevronsUpDown size={12} className="opacity-0 group-hover:opacity-50" />
                                            )}
                                        </div>
                                    )}
                                </div>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                    {sortedData.map((item) => {
                        const id = item[idKey];
                        const isSelected = selectedIds.has(id);

                        return (
                            <tr
                                key={id}
                                className={`group transition-colors h-10 ${isSelected ? 'bg-accent-primary/10 hover:bg-accent-primary/20' : 'hover:bg-app-hover'}`}
                                onClick={() => toggleRow(id)}
                            >
                                {/* Checkbox Cell */}
                                <td className="px-4 text-center border-r border-app-border" onClick={e => e.stopPropagation()}>
                                    <input
                                        type="checkbox"
                                        aria-label={`Select ${getItemLabel?.(item) || id}`}
                                        className="accent-accent-primary cursor-pointer w-4 h-4 bg-app-hover border-none rounded whitespace-nowrap"
                                        checked={isSelected}
                                        onChange={() => toggleRow(id)}
                                    />
                                </td>

                                {/* Data Cells */}
                                {columns.map(col => (
                                    <td key={col.key} className="px-4 py-1 text-text-main truncate">
                                        {col.render ? col.render(item) : item[col.key]}
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {data.length === 0 && (
                <div className="flex flex-col items-center justify-center h-64 text-center px-6 text-text-faint">
                    {emptyState?.icon && (
                        <div className="mb-3 text-text-muted">
                            {emptyState.icon}
                        </div>
                    )}
                    <p className="text-sm font-semibold text-text-muted">{emptyState?.title || 'No items found'}</p>
                    {emptyState?.message && (
                        <p className="mt-1 max-w-sm text-xs leading-relaxed">{emptyState.message}</p>
                    )}
                </div>
            )}
        </div>
    );
}
