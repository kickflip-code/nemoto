import { useEffect, useState } from 'react';
import { useUIStore } from '../../stores/useUIStore';
import { Book, Server, FileText } from 'lucide-react';

export default function DragOverlay() {
    const { draggedEntity } = useUIStore();
    const [position, setPosition] = useState({ x: 0, y: 0 });

    useEffect(() => {
        if (!draggedEntity) return;

        const handleMouseMove = (e: MouseEvent) => {
            setPosition({ x: e.clientX, y: e.clientY });
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [draggedEntity]);

    useEffect(() => {
        const handleMouseUp = () => {
            const { draggedEntity } = useUIStore.getState();
            if (draggedEntity) {
                // Delay cleanup to allow drop handlers to process first
                setTimeout(() => {
                    const { setDraggedEntity, setDraggedAsset } = useUIStore.getState();
                    setDraggedEntity(null);
                    setDraggedAsset(null);
                    document.body.style.cursor = '';
                }, 50);
            }
        };

        window.addEventListener('mouseup', handleMouseUp);
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, []);

    if (!draggedEntity) return null;

    const getIcon = () => {
        switch (draggedEntity.type) {
            case 'journalEntry': return <Book size={14} className="text-accent-primary" />;
            case 'asset': return <Server size={14} className="text-accent-primary" />;
            default: return <FileText size={14} className="text-accent-primary" />;
        }
    };

    return (
        <div
            className="fixed pointer-events-none z-[1000] flex items-center gap-2 px-3 py-2 bg-app-surface/90 border border-accent-primary/20 text-text-main rounded-sm shadow-xl backdrop-blur-sm opacity-90 scale-95"
            style={{
                left: position.x,
                top: position.y,
                transform: 'translate(-10px, -10px)', // Offset slightly from cursor
            }}
        >
            <div className="p-1.5 bg-accent-primary/10 rounded-sm">
                {getIcon()}
            </div>
            <div className="flex flex-col">
                <span className="text-[11px] font-bold leading-tight">{draggedEntity.name}</span>
                <span className="text-[9px] text-text-muted font-mono leading-tight mt-0.5 uppercase tracking-tighter">{draggedEntity.type}</span>
            </div>
        </div>
    );
}
