import ContextualRecordCapture from '../canvas/ContextualRecordCapture';
import { lazy, ReactNode, Suspense, useEffect, useState } from 'react';
import AppRail from './AppRail';
import JournalPanel from '../journal/JournalPanelNew';

import DragOverlay from './DragOverlay';
import Header from './Header';
// StatusBar removed as it does not exist

import FloatingDock from './FloatingDock';
import SidePanel from './SidePanel';
import CanvasToolbar from './CanvasToolbar';
import ProcessHeader from '../canvas/ProcessHeader';
import { useUIStore } from '../../stores/useUIStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useProposalReviewStore } from '../../stores/useProposalReviewStore';
import {
    JOURNAL_SIDE_DOCK_MIN_VIEWPORT_WIDTH,
    resolveJournalDock,
} from '../../lib/journalDock';

const ExportDialog = lazy(() => import('../dialogs/ExportDialog'));
const ImportWizardModal = lazy(() => import('../import/ImportWizardModal'));
const Inspector = lazy(() => import('./Inspector'));
const JournalContextPanel = lazy(() => import('../journal/JournalContextPanel'));
const Omnibox = lazy(() => import('../shared/Omnibox'));
const SettingsDialog = lazy(() => import('../dialogs/SettingsDialog'));
const UnifiedManagementHub = lazy(() => import('./UnifiedManagementHub'));
const ProposalReviewDialog = lazy(() => import('../plugins/ProposalReviewDialog'));
const PortfolioChatPanel = lazy(() => import('../ai/PortfolioChatDialog'));

// Removed separate interface if not exported, or keep it local
interface LayoutProps {
    children: ReactNode;
    pluginRuntime?: import('../../plugins/declarativeRuntime').DeclarativePluginRuntime;
}

import { useAutoSave } from '../../hooks/useAutoSave';
import { useAutoBackup } from '../../hooks/useAutoBackup';

import { ReactFlowProvider } from 'reactflow'; // Import Provider

import { Toaster } from 'sonner';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';

import { useCanvasSync } from '../../hooks/useCanvasSync';
import { leftPanelMotion, rightPanelMotion } from '../../lib/motion';

import Titlebar from './Titlebar';
import CloseGuard from '../startup/CloseGuard';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import HelpDialogLoader from '../help/HelpDialogLoader';

export default function Layout({ children, pluginRuntime }: LayoutProps) {
    const hasProcesses = usePortfolioStore(state => state.portfolio.processes.length > 0);
    const isImportedPreview = useCanvasStore(state => !!state.previewGraph);
    const journalDockPreference = useSettingsStore(state => state.journalDock);
    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
    const {
        inspectorOpen,
        rightPanelMode,
        activeView,
        importDialogOpen,
        closeImportDialog,
        exportDialogOpen,
        omniboxOpen,
        resourcePowerViewOpen,
        setResourcePowerViewOpen,
        leftPanelOpen,
        settingsOpen,
        helpOpen,
        closeHelp,
        portfolioChatOpen,
        closePortfolioChat,
    } = useUIStore();
    const proposalReviewOpen = useProposalReviewStore(state => state.reviewOpen);
    const inspectorSurfaceOpen = inspectorOpen && !portfolioChatOpen && activeView === 'designer';
    const rightSurfaceOpen = portfolioChatOpen || inspectorSurfaceOpen;
    const sideDockAvailable = activeView === 'designer'
        && viewportWidth >= JOURNAL_SIDE_DOCK_MIN_VIEWPORT_WIDTH;
    const journalDock = resolveJournalDock(
        journalDockPreference,
        viewportWidth,
        activeView === 'designer',
    );

    useEffect(() => {
        const handleResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    useAutoSave();
    useAutoBackup(); // <--- Periodic snapshots
    useCanvasSync(); // <--- Sync active process to canvas

    return (
        <MotionConfig reducedMotion="user">
          <ReactFlowProvider>
            <Toaster theme="dark" position="bottom-right" toastOptions={{
                style: {
                    background: 'var(--color-app-surface)',
                    border: '1px solid var(--color-app-border)',
                    color: 'var(--color-text-main)',
                },
                className: 'font-sans text-xs',
            }} />
            <CloseGuard />

            <div className="flex flex-col h-screen bg-app-bg text-text-main overflow-hidden border border-app-border">
                <Titlebar />
                <Header />

                <div className="flex min-h-0 flex-1 overflow-hidden">
                    <AppRail runtime={pluginRuntime} />

                    {/* Left Panel (SidePanel) - Animated Slide */}
                    <AnimatePresence initial={false}>
                        {activeView === 'designer' && leftPanelOpen && (
                            <motion.div
                                {...leftPanelMotion}
                                className="nemoto-motion-panel nemoto-motion-panel-left flex-shrink-0 z-10 bg-app-sidebar overflow-hidden flex flex-col"
                            >
                                <SidePanel />
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Main Stage */}
                    <main className="relative flex min-h-0 flex-1 overflow-hidden bg-app-surface">

                        {/* Canvas and journal workspace */}
                        <div
                            className={`relative flex min-h-0 min-w-0 flex-1 ${journalDock === 'left' ? 'flex-row' : 'flex-col'}`}
                            data-journal-dock={journalDock}
                        >
                            <div className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${journalDock === 'left' ? 'order-2' : 'order-1'}`}>
                                {activeView === 'designer' && (hasProcesses || isImportedPreview) && <CanvasToolbar />}
                                {activeView === 'designer' && hasProcesses && !isImportedPreview && <ProcessHeader />}

                                <div className="relative min-h-0 flex-1">
                                    {children}
                                    {activeView === 'designer' && hasProcesses && !resourcePowerViewOpen && <FloatingDock />}
                                    {activeView === 'designer' && hasProcesses && <DragOverlay />}
                                </div>
                            </div>

                            <JournalPanel dock={journalDock} sideDockAvailable={sideDockAvailable} />
                        </div>

                        {/* Right Panel (Inspector) - Animated Slide/Resize */}
                        <AnimatePresence initial={false}>
                            {rightSurfaceOpen && (
                                <motion.div
                                    {...rightPanelMotion}
                                    className="nemoto-motion-panel nemoto-motion-panel-right flex-shrink-0 z-20 overflow-hidden"
                                >
                                    {portfolioChatOpen ? (
                                        <Suspense fallback={<div className="h-full w-[500px] border-l border-app-border bg-app-header" />}>
                                            <PortfolioChatPanel onClose={closePortfolioChat} />
                                        </Suspense>
                                    ) : (
                                        <div className="h-full bg-app-header shadow-xl">
                                            <Suspense fallback={<div className="p-4 text-xs text-text-muted">Loading panel...</div>}>
                                                {rightPanelMode === 'inspector' ? (
                                                    <Inspector />
                                                ) : (
                                                    <JournalContextPanel />
                                                )}
                                            </Suspense>
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </main>

                    {/* Global Omnibox Overlay */}
                    <AnimatePresence initial={false}>
                        {omniboxOpen && (
                            <Suspense key="omnibox" fallback={null}>
                                <Omnibox pluginRuntime={pluginRuntime} />
                            </Suspense>
                        )}
                    </AnimatePresence>

                    {/* Load global dialogs only when they are opened. */}
                    <ContextualRecordCapture />
                    <AnimatePresence initial={false}>
                        {settingsOpen && (
                            <Suspense key="settings" fallback={null}>
                                <SettingsDialog />
                            </Suspense>
                        )}
                        {helpOpen && (
                            <HelpDialogLoader key="help" onClose={closeHelp} />
                        )}
                        {exportDialogOpen && (
                            <Suspense key="export" fallback={null}>
                                <ExportDialog />
                            </Suspense>
                        )}

                        {/* Import Wizard */}
                        {importDialogOpen && (
                            <Suspense key="import" fallback={null}>
                                <ImportWizardModal
                                    isOpen
                                    onClose={closeImportDialog}
                                />
                            </Suspense>
                        )}

                        {/* Portfolio overview and content management */}
                        {resourcePowerViewOpen && (
                            <Suspense key="management" fallback={null}>
                                <UnifiedManagementHub
                                    isOpen
                                    onClose={() => setResourcePowerViewOpen(false)}
                                />
                            </Suspense>
                        )}
                        {proposalReviewOpen && (
                            <Suspense key="proposal-review" fallback={null}>
                                <ProposalReviewDialog />
                            </Suspense>
                        )}
                    </AnimatePresence>
                </div>
            </div>
          </ReactFlowProvider>
        </MotionConfig>
    );
}
