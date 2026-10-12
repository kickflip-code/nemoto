import { useEffect, useState, useSyncExternalStore } from 'react';
import { registerPluginViewLeaveGuard } from '../../plugins/pluginViewLeaveGuard';
import { NemotoButton, NemotoDialog, NemotoDialogBody, NemotoDialogFooter, NemotoDialogHeader } from '../ui';
import { createHostPluginUiSession } from '../../host/pluginHostServices';
import { resolveActiveComposedViewAuthority } from '../../plugins/activeRuntime';
import { usePluginHostSnapshot } from './PluginHostServicesContext';
import { useUIStore } from '../../stores/useUIStore';
import type { DeclarativePluginRuntime } from '../../plugins/declarativeRuntime';
import type { PluginUiSession } from '../../host/pluginUiSession';
import GuidedResourceJourneyView from './GuidedResourceJourneyView';
import CollectionListView from './CollectionListView';
import SearchResultsView from './SearchResultsView';
import ContextualCollectionView from './ContextualCollectionView';
import PluginComposedView, { type PluginComposedAction } from './PluginComposedView';

interface PluginViewHostProps {
    runtime: DeclarativePluginRuntime;
    sandbox?: boolean;
    viewId: string;
    composedTree?: unknown;
    composedSession?: PluginUiSession;
    onComposedAction?: (action: PluginComposedAction) => void;
}

export default function PluginViewHost({
    runtime,
    sandbox = false,
    viewId,
    composedTree,
    composedSession,
    onComposedAction,
}: PluginViewHostProps) {
    const view = runtime.content.getPayload(viewId, 'views');
    const viewRegistration = runtime.content.get(viewId)?.registration;
    if (!view) {
        return (
            <div className="flex h-full items-center justify-center bg-app-bg p-8 text-sm text-text-muted">
                Plugin view is unavailable.
            </div>
        );
    }

    if (view.renderer === 'guided-resource-journey') {
        const questionSet = runtime.content.getPayload(view.questionSetId, 'questionSets');
        const template = runtime.content.getPayload(view.templateId, 'templates');
        const aiProfile = runtime.content.getPayload(view.aiProfileId, 'aiProfiles');
        const vocabulary = runtime.content.list('vocabularies')
            .find(contribution => contribution.registration.pluginId === viewRegistration?.pluginId)
            ?.payload;

        if (!questionSet || !template || !aiProfile) {
            return (
                <div className="flex h-full items-center justify-center bg-app-bg p-8 text-sm text-accent-danger">
                    Plugin view dependencies are unavailable.
                </div>
            );
        }

        return (
            <GuidedResourceJourneyView
                view={view}
                questionSet={questionSet}
                template={template}
                aiProfile={aiProfile}
                vocabulary={vocabulary}
                sandbox={sandbox}
            />
        );
    }

    if (view.renderer === 'collection-list' && viewRegistration) {
        if (view.contextual) return <ContextualCollectionView key={view.id} pluginId={viewRegistration.pluginId} view={view} />;
        return (
            <CollectionListView
                pluginId={viewRegistration.pluginId}
                view={view}
            />
        );
    }

    if (view.renderer === 'search-results' && viewRegistration) {
        return (
            <SearchResultsView
                pluginId={viewRegistration.pluginId}
                view={view}
            />
        );
    }

    if (view.renderer === 'composed-view') {
        const storageViewId = 'storageViewId' in view ? (view.storageViewId as string) : undefined;
        if (composedSession?.viewId === viewId) {
            return <SessionComposedView session={composedSession} storageViewId={storageViewId} />;
        }
        if (composedTree === undefined) {
            if (!sandbox) return <ActiveComposedView key={viewId} viewId={viewId} storageViewId={storageViewId} />;
            return (
                <div className="flex h-full items-center justify-center bg-app-bg p-8 text-sm text-text-muted">
                    Composed plugin view is not active.
                </div>
            );
        }
        return <PluginComposedView tree={composedTree} onAction={onComposedAction} />;
    }

    return null;
}

function ActiveComposedView({ viewId, storageViewId }: { viewId: string; storageViewId?: string }) {
    const host = usePluginHostSnapshot();
    const [session, setSession] = useState<PluginUiSession | null>(null);
    const authority = resolveActiveComposedViewAuthority(
        host.installedPlugins, host.pluginRequirements, viewId,
    );
    useEffect(() => {
        if (!authority) { setSession(null); return; }
        // A StrictMode cleanup must not dispose the instance used by its next setup.
        const current = createHostPluginUiSession(authority, { surface: 'app-rail' });
        setSession(current);
        current.start();
        return () => current.dispose('view-closed');
    }, [host.installedPlugins, viewId, authority?.pluginId, authority?.pluginVersion,
        authority?.dataVersion, authority?.operation]);
    return session ? <SessionComposedView session={session} storageViewId={storageViewId} /> : (
        <p role="status">Composed plugin view is not active.</p>
    );
}

function SessionComposedView({
    session,
    storageViewId,
}: {
    session: PluginUiSession;
    storageViewId?: string;
}) {
    const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
    useEffect(() => registerPluginViewLeaveGuard(session.viewId, {
        hasUnsavedChanges: () => session.getSnapshot().hasUnsavedChanges,
        requestLeave: navigate => setPendingLeave(() => navigate),
    }), [session]);
    const snapshot = useSyncExternalStore(
        session.subscribe,
        session.getSnapshot,
        session.getSnapshot,
    );
    if (snapshot.status === 'error' && !snapshot.tree) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 bg-app-bg p-8 text-sm text-accent-danger" role="alert">
                <p>{snapshot.error || 'Composed plugin view failed.'}</p>
                {storageViewId ? (
                    <NemotoButton
                        variant="primary"
                        onClick={() => useUIStore.getState().setActiveView(storageViewId as never)}
                    >
                        Open standard view
                    </NemotoButton>
                ) : null}
            </div>
        );
    }
    if (!snapshot.tree) {
        return (
            <div className="flex h-full items-center justify-center bg-app-bg p-8 text-sm text-text-muted" role="status">
                Loading plugin view...
            </div>
        );
    }
    const inactive = snapshot.status === 'error' || snapshot.status === 'disposed';
    return <>
        {pendingLeave && <NemotoDialog aria-labelledby="plugin-leave-title" onClose={() => setPendingLeave(null)}>
            <NemotoDialogHeader><h2 id="plugin-leave-title">Discard plugin changes?</h2></NemotoDialogHeader>
            <NemotoDialogBody>Your plugin edits have not been saved. Keep editing or discard them before leaving this view.</NemotoDialogBody>
            <NemotoDialogFooter>
                <NemotoButton onClick={() => setPendingLeave(null)}>Keep editing</NemotoButton>
                <NemotoButton variant="danger" onClick={() => {
                    const navigate = pendingLeave;
                    setPendingLeave(null);
                    session.requestClose(true);
                    navigate();
                }}>Discard changes</NemotoButton>
            </NemotoDialogFooter>
        </NemotoDialog>}
        {inactive && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border bg-accent-danger/10 px-4 py-2 text-sm text-accent-danger" role="alert">
                <span>{snapshot.error || 'Plugin view closed. Writes are disabled.'}</span>
                {storageViewId ? (
                    <NemotoButton
                        size="sm"
                        onClick={() => useUIStore.getState().setActiveView(storageViewId as never)}
                    >
                        Open standard view
                    </NemotoButton>
                ) : null}
            </div>
        )}
        <PluginComposedView
            tree={snapshot.tree}
            onAction={inactive ? undefined : session.dispatchAction}
            onDraftChange={inactive ? undefined : session.stageDraft}
        />
    </>;
}
