import { useCanvasStore } from '../../stores/useCanvasStore';
import { useUIStore } from '../../stores/useUIStore';
import { duplicateCanvasSelection } from './duplicateCanvasSelection';
import ContextMenu, { ContextMenuItem } from '../shared/ContextMenu';
import { Copy, Trash2, Layers, CopyPlus } from 'lucide-react';
import { toast } from 'sonner';
import { canOpenNodeDrilldown, openOrCreateNodeDrilldown } from '../../lib/drilldown';
import { createCanvasPluginCapture, useCanvasPluginActions, useRecordCapture } from './contextualRecordState';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { usePluginStore } from '../../stores/usePluginStore';

interface CanvasContextMenuProps {
    nodeId: string;
    x: number;
    y: number;
    onClose: () => void;
}

export default function CanvasContextMenu({ nodeId, x, y, onClose }: CanvasContextMenuProps) {
    const graph = useCanvasStore(state => state.graph);
    const pluginActions = useCanvasPluginActions();
    const processId = useProcessSessionStore(state => state.activeProcessId);
    const breadcrumbStack = useProcessSessionStore(state => state.breadcrumbStack);

    const node = graph.nodes.find(n => n.id === nodeId);

    if (!node) return null;

    const canOpenDrilldown = canOpenNodeDrilldown(node);

    const handleDuplicate = () => {
        duplicateCanvasSelection(nodeId);
    };

    const handleDelete = () => {
        const canvas = useCanvasStore.getState();
        const wasInspected = canvas.selectedNodeIds.includes(nodeId);
        canvas.removeElements([nodeId], []);
        if (wasInspected) useUIStore.getState().clearCanvasInspection();
        toast.success('Deleted node');
    };

    const handleCopyLink = () => {
        const link = `axiom://node/${nodeId}`;
        navigator.clipboard.writeText(link);
        toast.success('Copied link to clipboard');
    };

    const handleDrillDown = () => {
        openOrCreateNodeDrilldown(nodeId, graph);
        onClose();
    };

    const pluginItems: ContextMenuItem[] = pluginActions.filter(entry => processId
            && usePluginStore.getState().hasGrant(entry.pluginId, 'portfolio.read-scoped')
            && usePluginStore.getState().hasGrant(entry.pluginId, 'plugin-data.write')).map(entry => ({
            label: entry.label,
            action: () => useRecordCapture.setState({
                capture: createCanvasPluginCapture(entry, nodeId, processId!, breadcrumbStack),
            }),
        }));

    const items: ContextMenuItem[] = [
        {
            label: 'Open Drilldown',
            icon: Layers,
            action: handleDrillDown,
            disabled: !canOpenDrilldown
        },
        { separator: true },
        {
            label: 'Duplicate',
            icon: CopyPlus,
            action: handleDuplicate,
            shortcut: 'Ctrl+D'
        },
        {
            label: 'Copy Link',
            icon: Copy,
            action: handleCopyLink
        },
        ...(pluginItems.length ? [{ separator: true }, ...pluginItems] : []),
        { separator: true },
        {
            label: 'Delete',
            icon: Trash2,
            action: handleDelete,
            danger: true,
            shortcut: 'Del'
        }
    ];

    return (
        <ContextMenu
            items={items}
            x={x}
            y={y}
            onClose={onClose}
        />
    );
}
