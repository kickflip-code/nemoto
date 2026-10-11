import { useRecordCapture, type LegacyCapture, type ComposedCapture } from './contextualRecordState';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { coreEntityReference } from '../../plugins/universalReference';
import { pluginHostServices, createHostPluginUiSession } from '../../host/pluginHostServices';
import type { PluginUiSession } from '../../host/pluginUiSession';
import { createContextualItem, resolveRecordContext } from '../../plugins/contextualRecordModel';
import { AxiomButton, AxiomDialog, AxiomInput } from '../ui';
import { useActivePluginRuntime } from '../plugins/useActivePluginRuntime';
const PluginViewHost = lazy(() => import('../plugins/PluginViewHost'));

export default function ContextualRecordCapture() {
    const capture = useRecordCapture(state => state.capture);
    const processId = useProcessSessionStore(state => state.activeProcessId);
    useEffect(() => {
        if (capture && capture.processId !== processId) useRecordCapture.setState({ capture: null });
    }, [capture, processId]);
    if (!capture || capture.processId !== processId) return null;
    return capture.kind === 'composed-view'
        ? <ComposedCaptureDialog key={`${capture.action.pluginId}:${capture.reference.id}`} capture={capture} />
        : <LegacyCaptureDialog key={`${capture.pluginId}:${capture.nodeId}`} capture={capture} />;
}

function LegacyCaptureDialog({ capture }: { capture: LegacyCapture }) {
    const [title, setTitle] = useState('');
    const input = useRef<HTMLInputElement>(null);
    const close = () => useRecordCapture.setState({ capture: null });
    return <AxiomDialog aria-labelledby="record-capture-title" initialFocusRef={input} onClose={close} panelClassName="w-full max-w-md p-5">
        <h2 id="record-capture-title" className="mb-3 text-lg font-bold">{capture.view.contextual!.quickAddLabel}</h2>
        <form onSubmit={event => {
            event.preventDefault();
            try {
                const api = pluginHostServices.publicApi.connect(capture.pluginId);
                const context = resolveRecordContext(api, coreEntityReference('core.node', capture.nodeId, { processId: capture.processId }));
                if (!context) throw new Error('The selected object is no longer available.');
                const collection = api.storage.readCollection(capture.view.collection.id);
                if (collection.error) throw new Error(collection.error);
                api.storage.replaceCollection({ view: capture.view, items: [...collection.items, createContextualItem(capture.view, title, context)], expectedRevision: api.workspace.getContext().portfolioRevision });
                toast.success('Task added'); close();
            } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not add task.'); }
        }}>
            <AxiomInput ref={input} aria-label="Task title" className="w-full" placeholder="What needs to be done?" value={title} maxLength={500} required onChange={event => setTitle(event.target.value)} />
            <div className="mt-4 flex gap-2"><AxiomButton type="submit" disabled={!title.trim()}>Add</AxiomButton><AxiomButton type="button" onClick={close}>Cancel</AxiomButton></div>
        </form>
    </AxiomDialog>;
}

function hasDialogNode(node: unknown): boolean {
    if (!node || typeof node !== 'object') return false;
    const n = node as { type?: unknown; children?: unknown[] };
    if (n.type === 'dialog') return true;
    if (Array.isArray(n.children)) {
        return n.children.some(hasDialogNode);
    }
    return false;
}

function ComposedCaptureDialog({ capture }: { capture: ComposedCapture }) {
    const runtime = useActivePluginRuntime();
    const [session, setSession] = useState<PluginUiSession | null>(null);

    useEffect(() => {
        let active = true;
        const current = createHostPluginUiSession(capture.action.authority, {
            surface: 'canvas-dialog',
            capturedContext: capture.reference,
        });
        setSession(current);

        const unsubscribe = current.subscribe(() => {
            if (!active) return;
            const snapshot = current.getSnapshot();
            if (snapshot.status === 'error') {
                toast.error(snapshot.error || 'Failed to open plugin capture.');
                useRecordCapture.setState({ capture: null });
            } else if (snapshot.status === 'disposed') {
                useRecordCapture.setState({ capture: null });
            } else if (snapshot.status === 'ready' && snapshot.pendingEvents === 0 && snapshot.tree && !hasDialogNode(snapshot.tree)) {
                current.dispose('view-closed');
                useRecordCapture.setState({ capture: null });
            }
        });

        current.start();

        return () => {
            active = false;
            unsubscribe();
            current.dispose('view-closed');
        };
    }, [capture]);

    if (!session) return null;

    return (
        <Suspense fallback={<p role="status">Loading plugin view...</p>}>
            <PluginViewHost
                composedSession={session}
                runtime={runtime}
                viewId={capture.action.authority.viewId}
            />
        </Suspense>
    );
}
