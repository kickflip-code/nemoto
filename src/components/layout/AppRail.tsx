import { LayoutGrid, BookOpen, CircleHelp, Network, Server, PanelLeftClose, PanelLeft, PanelRightClose, PanelRight } from 'lucide-react';
import { pocPluginRuntime } from '../../plugins/pocRuntime';
import { useUIStore, type PluginViewId } from '../../stores/useUIStore';
import { getPluginIcon } from '../plugins/pluginIcons';
import type { DeclarativePluginRuntime } from '../../plugins/declarativeRuntime';

interface AppRailProps {
    preview?: boolean;
    runtime?: DeclarativePluginRuntime;
}

export default function AppRail({ preview = false, runtime }: AppRailProps) {
    const {
        toggleJournalPanel,
        journalPanelExpanded,
        activeView,
        setActiveView,
        setResourcePowerViewOpen,
        leftPanelOpen,
        toggleLeftPanel,
        inspectorOpen,
        toggleInspector,
        openInspector,
        portfolioChatOpen,
        closePortfolioChat,
        helpOpen,
        openHelp,
    } = useUIStore();
    const displayedActiveView = preview ? 'designer' : activeView;
    const displayedJournalPanelExpanded = preview ? false : journalPanelExpanded;
    const displayedLeftPanelOpen = preview ? true : leftPanelOpen;
    const displayedInspectorOpen = preview ? true : inspectorOpen && !portfolioChatOpen;
    const displayedHelpOpen = preview ? false : helpOpen;
    const isPluginPocPreview = import.meta.env.DEV
        && new URLSearchParams(window.location.search).get('view') === 'plugin-poc';
    const rawPluginViews = preview
        ? []
        : runtime?.navigationViews || (isPluginPocPreview ? pocPluginRuntime.navigationViews : []);
    const suppressedViewIds = new Set(
        rawPluginViews
            .filter(view => view.renderer === 'composed-view' && 'storageViewId' in view && typeof view.storageViewId === 'string')
            .map(view => (view as { storageViewId: string }).storageViewId)
    );
    const pluginViews = rawPluginViews.filter(view => !suppressedViewIds.has(view.id));

    return (
        <nav className={`axiom-app-rail ${preview ? 'axiom-app-rail-preview' : ''} w-12 flex flex-col items-center py-3 gap-3 z-40 shrink-0`}>
            <RailButton
                icon={displayedLeftPanelOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
                onClick={preview ? undefined : toggleLeftPanel}
                title="Toggle Left Panel"
            />
            <div className="axiom-rail-divider h-[1px] w-6 my-1" />
            <RailButton
                icon={<LayoutGrid size={16} />}
                active={displayedActiveView === 'designer'}
                onClick={preview ? undefined : () => setActiveView('designer')}
                title="Designer"
            />
            <RailButton
                icon={<Network size={16} />}
                active={displayedActiveView === 'dependency'}
                onClick={preview ? undefined : () => setActiveView('dependency')}
                title="Dependency Map"
            />
            {pluginViews.map(view => {
                const PluginIcon = getPluginIcon(view.navigation.icon);
                const isActive = displayedActiveView === view.id
                    || (view.renderer === 'composed-view' && 'storageViewId' in view && displayedActiveView === (view as { storageViewId: string }).storageViewId);
                return (
                    <RailButton
                        key={view.id}
                        icon={<PluginIcon size={16} />}
                        active={isActive}
                        onClick={() => setActiveView(view.id as PluginViewId)}
                        title={view.navigation.label}
                    />
                );
            })}

            <RailButton
                icon={<BookOpen size={16} />}
                active={displayedJournalPanelExpanded}
                onClick={preview ? undefined : toggleJournalPanel}
                title="Toggle Journal Panel"
            />
            <div className="axiom-rail-divider h-[1px] w-6 my-1" />
            <RailButton
                icon={<Server size={16} />}
                title="Portfolio"
                onClick={preview ? undefined : () => setResourcePowerViewOpen(true)}
            />

            <div className="mt-auto flex flex-col items-center gap-3">
                <div className="axiom-rail-divider h-[1px] w-6 my-1" />
                <RailButton
                    icon={displayedInspectorOpen ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
                    onClick={preview ? undefined : () => {
                        if (portfolioChatOpen) {
                            closePortfolioChat();
                            openInspector();
                            return;
                        }
                        toggleInspector();
                    }}
                    title="Toggle Right Panel"
                />
                <RailButton
                    active={displayedHelpOpen}
                    ariaKeyShortcuts="F1"
                    ariaLabel="Help"
                    icon={<CircleHelp size={16} />}
                    onClick={preview ? undefined : openHelp}
                    title="Help (F1)"
                />
                {/* Settings Button */}
                <RailButton
                    icon={<SettingsIcon />}
                    title="Settings & Backup"
                    onClick={preview ? undefined : useUIStore.getState().openSettings}
                />
            </div>
        </nav>
    );
}

function SettingsIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    )
}

function RailButton({
    icon,
    active,
    ariaKeyShortcuts,
    ariaLabel,
    onClick,
    title,
}: {
    icon: React.ReactNode;
    active?: boolean;
    ariaKeyShortcuts?: string;
    ariaLabel?: string;
    onClick?: () => void;
    title?: string;
}) {
    return (
        <button
            type="button"
            aria-keyshortcuts={ariaKeyShortcuts}
            aria-label={ariaLabel || title}
            onClick={onClick}
            title={title}
            className={`axiom-rail-button ${active ? 'axiom-rail-button-active' : ''}`}
        >
            {icon}
        </button>
    );
}
