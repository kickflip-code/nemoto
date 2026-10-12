import { useMemo } from 'react';
import { ExternalLink, FileSearch } from 'lucide-react';
import { toast } from 'sonner';
import type { PluginSearchResultsView } from '../../plugins/contributionSchemas';
import type { PluginSearchResult } from '../../plugins/searchReadModel';
import { NemotoButton } from '../ui';
import {
    usePluginHostServices,
    usePluginHostSnapshot,
} from './PluginHostServicesContext';

interface SearchResultsViewProps {
    pluginId: string;
    view: PluginSearchResultsView;
}

export default function SearchResultsView({ pluginId, view }: SearchResultsViewProps) {
    const host = usePluginHostServices();
    const { portfolioRevision, installedPlugins, pluginRequirements } = usePluginHostSnapshot();
    const pluginApi = useMemo(
        () => host.publicApi.connect(pluginId),
        [host, installedPlugins, pluginId, pluginRequirements],
    );
    const canNavigate = host.permissions.has(pluginId, 'workspace.navigate');
    const search = useMemo<{ results: readonly PluginSearchResult[]; error: string | null }>(() => {
        try {
            return {
                results: pluginApi.read.search({
                    query: view.query.text,
                    kinds: view.query.kinds,
                    limit: view.query.limit,
                }),
                error: null,
            };
        } catch (error) {
            return {
                results: [],
                error: error instanceof Error ? error.message : 'Portfolio results are unavailable.',
            };
        }
    }, [pluginApi, portfolioRevision, view.query.kinds, view.query.limit, view.query.text]);

    const openResult = (result: PluginSearchResult) => {
        if (!view.openAction || !canNavigate) return;
        try {
            const opened = pluginApi.workspace.open({
                schema: 'axiom.plugin-navigation-intent',
                schemaVersion: 1,
                action: view.openAction,
                reference: result.reference,
            });
            if (opened.status !== 'opened') toast.error('Nemoto could not open the referenced item.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Nemoto could not open the referenced item.');
        }
    };

    return (
        <div className="h-full overflow-y-auto bg-app-bg p-6 text-text-main">
            <div className="mx-auto max-w-4xl space-y-6">
                <header className="border-b border-app-border pb-5">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent-primary">
                        {view.content.eyebrow}
                    </div>
                    <h1 className="mt-2 text-2xl font-black tracking-tight">{view.content.title}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
                        {view.content.description}
                    </p>
                </header>

                {search.error && (
                    <div role="alert" className="rounded-lg border border-accent-danger/30 bg-accent-danger/5 p-4 text-sm text-accent-danger">
                        {search.error}
                    </div>
                )}

                {!search.error && search.results.length === 0 && (
                    <div className="rounded-xl border border-dashed border-app-border px-6 py-12 text-center">
                        <FileSearch size={28} className="mx-auto text-text-faint" aria-hidden="true" />
                        <h2 className="mt-3 text-base font-bold">{view.content.emptyTitle}</h2>
                        <p className="mt-1 text-sm text-text-muted">{view.content.emptyDescription}</p>
                    </div>
                )}

                {!search.error && search.results.length > 0 && (
                    <ul aria-label={view.content.title} className="space-y-2">
                        {search.results.map(result => (
                            <li
                                key={`${result.reference.kind}:${result.reference.id}`}
                                className="nemoto-dialog-row flex items-center gap-3 p-3"
                            >
                                <FileSearch size={16} className="shrink-0 text-accent-primary" aria-hidden="true" />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold">{result.label}</div>
                                    <div className="mt-0.5 truncate text-[11px] text-text-muted">
                                        {result.context}
                                    </div>
                                </div>
                                {view.openAction && canNavigate && (
                                    <NemotoButton
                                        onClick={() => openResult(result)}
                                        aria-label={`${view.openAction === 'inspect' ? 'Inspect' : 'Reveal'} ${result.label}`}
                                    >
                                        <ExternalLink size={14} aria-hidden="true" />
                                        {view.openAction === 'inspect' ? 'Inspect' : 'Reveal'}
                                    </NemotoButton>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
