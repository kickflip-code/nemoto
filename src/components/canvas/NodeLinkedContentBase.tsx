import { memo, type ComponentType } from 'react';
import { Box, FileText } from 'lucide-react';
import type { NodeProps } from 'reactflow';
import type { Asset, CanvasNode } from '../../types';
import type { JournalEntry } from '../../types/journal';
import { getResourceReferenceAssetId } from '../../lib/resourceReferences';
import { getPluginIcon } from '../plugins/pluginIcons';
import type { CanvasRecordIndicator } from './contextualRecordState';

type LinkedContent = { resources: boolean; journal: boolean; indicators?: readonly CanvasRecordIndicator[] };

/** Index once per graph projection, not once per rendered node. */
export function buildNodeLinkedContent(nodes: CanvasNode[], assets: Asset[], entries: JournalEntry[], processId: string | null, visible: boolean, indicators?: ReadonlyMap<string, readonly CanvasRecordIndicator[]>) {
    const result = new Map<string, LinkedContent>();
    if (!visible) return result;
    const assetIds = new Set(assets.map(asset => asset.id));
    const journalNodes = new Set<string>();
    for (const entry of entries) {
        for (const ref of entry.linkedContext ?? []) {
            if (ref.type === 'node' && (!ref.processId || ref.processId === processId)) journalNodes.add(ref.id);
        }
    }
    for (const node of nodes) {
        const resourceId = getResourceReferenceAssetId(node);
        const resources = (node.assetIds ?? []).some(id => assetIds.has(id)) || !!(resourceId && assetIds.has(resourceId));
        const journal = journalNodes.has(node.id);
        if (resources || journal) result.set(node.id, { resources, journal });
        if (indicators?.get(node.id)?.length) result.set(node.id, { resources, journal, indicators: indicators.get(node.id) });
    }
    return result;
}

export function NodeLinkedContent({ content, diamond = false }: { content?: LinkedContent | null; diamond?: boolean }) {
    if (!content || (!content.resources && !content.journal && !content.indicators?.length)) return null;
    return <div className={`absolute ${diamond ? "bottom-8 right-6" : "-bottom-2 right-2"} z-30 flex gap-1 rounded border border-app-border bg-app-surface px-1 py-0.5 text-text-main pointer-events-none select-none`}>
        {content.indicators?.map(indicator => {
            const Icon = getPluginIcon(indicator.icon);
            const label = `${indicator.count} ${indicator.count === 1 ? indicator.singularLabel : indicator.pluralLabel}`;
            return <span key={indicator.key} className="pointer-events-auto flex items-center gap-1 text-[10px]" role="img" aria-label={label} title={label}><Icon size={12} aria-hidden="true" />{indicator.count}</span>;
        })}
        {content.resources && <span className="pointer-events-auto" role="img" aria-label="Linked resources" title="Linked resources"><Box size={12} aria-hidden="true" /></span>}
        {content.journal && <span className="pointer-events-auto" role="img" aria-label="Linked Journal notes" title="Linked Journal notes"><FileText size={12} aria-hidden="true" /></span>}
    </div>;
}

export function withLinkedContent(Node: ComponentType<NodeProps>) {
    return memo(function LinkedContentNode(props: NodeProps) {
        return <div className="node-linked-wrapper relative w-fit"><Node {...props} /><NodeLinkedContent content={props.data.linkedContent} diamond={props.type === 'decision'} /></div>;
    });
}

