import { Copy, Eye, LayoutGrid, Network } from 'lucide-react';
import { toast } from 'sonner';
import type { EntityReference } from '../../types/journal';
import { navigateToEntityReference } from '../../lib/entityNavigation';
import { useUIStore } from '../../stores/useUIStore';
import ContextMenu from '../shared/ContextMenu';

export interface JournalMentionMenuState {
    x: number;
    y: number;
    reference: EntityReference;
    label: string;
    dangling: boolean;
}

interface JournalMentionContextMenuProps {
    state: JournalMentionMenuState;
    onClose: () => void;
}

export default function JournalMentionContextMenu({
    state,
    onClose,
}: JournalMentionContextMenuProps) {
    return (
        <ContextMenu
            x={state.x}
            y={state.y}
            onClose={onClose}
            items={[
                {
                    label: 'Show in Dependency Map',
                    icon: Network,
                    disabled: state.dangling,
                    action: () => {
                        useUIStore.getState().setGravityWellFocalPoint({
                            id: state.reference.id,
                            label: state.label,
                        });
                        useUIStore.getState().setActiveView('dependency');
                    },
                },
                {
                    label: 'View in Inspector',
                    icon: Eye,
                    disabled: state.dangling,
                    action: () => {
                        const result = navigateToEntityReference(state.reference, 'inspect');
                        if (!result.ok) toast.error(result.reason || 'Could not open reference');
                        onClose();
                    },
                },
                {
                    label: 'Navigate to Process',
                    icon: LayoutGrid,
                    disabled: state.dangling || !['process', 'node'].includes(state.reference.type),
                    action: () => {
                        const result = navigateToEntityReference(state.reference, 'navigate');
                        if (!result.ok) toast.error(result.reason || 'Could not navigate to reference');
                        onClose();
                    },
                },
                { separator: true },
                {
                    label: 'Copy ID',
                    icon: Copy,
                    action: () => {
                        void navigator.clipboard.writeText(state.reference.id);
                        toast.success('ID copied');
                    },
                },
            ]}
        />
    );
}
