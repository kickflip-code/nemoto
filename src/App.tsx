import { lazy, Suspense, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ThemeProvider } from "./context/ThemeContext";
import Layout from "./components/layout/Layout";
import Titlebar from "./components/layout/Titlebar";
import PortfolioLoadFailure from "./components/startup/PortfolioLoadFailure";
import EmptyPortfolioWelcome from "./components/startup/EmptyPortfolioWelcome";
import Canvas from "./components/canvas/Canvas";
import { useCanvasStore } from "./stores/useCanvasStore";
import { usePortfolioStore } from "./stores/usePortfolioStore";
import { useUIStore } from "./stores/useUIStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { pocPluginRuntime } from "./plugins/pocRuntime";
import { useActivePluginRuntime } from "./components/plugins/useActivePluginRuntime";
import { usePluginStore } from "./stores/usePluginStore";
import {
  PluginHostServicesProvider,
  usePluginHostServices,
} from "./components/plugins/PluginHostServicesContext";
import { pluginHostServices } from "./host/pluginHostServices";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import "./styles/index.css";
import "./styles/features/journal.css";
import "./styles/features/omnibox.css";
import "./styles/features/portfolio-chat.css";
import "./styles/features/resource-categories.css";
import "./styles/features/settings.css";
import "./styles/features/theme-studio.css";
import "./styles/ui-primitives.css";
import "./styles/react-flow.css";
import "./styles/theme-recipes.css";

const DependencyView = lazy(() => import("./components/views/DependencyView"));
const ThemeBuilder = lazy(() => import("./components/views/ThemeBuilder"));
const PluginViewHost = lazy(() => import("./components/plugins/PluginViewHost"));

function ViewLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-app-surface text-sm text-text-muted">
      Loading view...
    </div>
  );
}

function AppContent() {
  const {
    loadPortfolio,
    recoverPortfolioBackup,
    isLoading,
    loadError,
    recoveryAvailable,
    portfolio,
  } = usePortfolioStore();
  const previewGraph = useCanvasStore(state => state.previewGraph);
  const { activeView } = useUIStore();
  const host = usePluginHostServices();
  const installedPluginRuntime = useActivePluginRuntime();
  const [initialized, setInitialized] = useState(false);

  // Check if this window should run as the Theme Studio
  const params = new URLSearchParams(window.location.search);
  const isThemeStudio = params.get('view') === 'theme-studio';
  const isTauriRuntime = isTauri();
  const isBrowserThemeStudioPreview = import.meta.env.DEV && isThemeStudio && !isTauriRuntime;
  const isBrowserWelcomePreview = import.meta.env.DEV
    && params.get('view') === 'welcome'
    && !isTauriRuntime;
  const isBrowserPluginPocPreview = import.meta.env.DEV
    && params.get('view') === 'plugin-poc'
    && !isTauriRuntime;
  const browserPluginPackage = params.get('plugin-package');
  const isBrowserPluginPackagePreview = import.meta.env.DEV
    && !isTauriRuntime
    && !!browserPluginPackage?.startsWith('/');
  const browserPreviewTheme = params.get('theme');
  const pluginRuntime = isBrowserPluginPocPreview ? pocPluginRuntime : installedPluginRuntime;
  const activePluginView = pluginRuntime.content.getPayload(activeView, 'views');

  useEffect(() => {
    if (!isBrowserThemeStudioPreview) return;

    const previewThemeMap = {
      void: 'void',
      polar: 'soft',
      soft: 'soft',
      brutalist: 'hard',
      hard: 'hard',
    } as const;
    const requestedTheme = browserPreviewTheme
      ? previewThemeMap[browserPreviewTheme as keyof typeof previewThemeMap]
      : undefined;

    if (requestedTheme) {
      useSettingsStore.getState().setTheme(requestedTheme);
      useSettingsStore.getState().setActiveThemeId(null);
    }
  }, [browserPreviewTheme, isBrowserThemeStudioPreview]);

  useEffect(() => {
    if (!isThemeStudio || !isTauriRuntime) return;

    getCurrentWindow().setDecorations(false).catch((error) => {
      console.warn('[Theme Studio] Could not disable native titlebar:', error);
    });
  }, [isTauriRuntime, isThemeStudio]);

  // Global Keyboard Shortcuts
  useGlobalShortcuts();

  // Initialization
  useEffect(() => {
    if (isBrowserThemeStudioPreview || isBrowserWelcomePreview) {
      setInitialized(true);
      return;
    }

    if (isBrowserPluginPackagePreview && browserPluginPackage) {
      const loadPackagePreview = async () => {
        const { inspectPluginPackage } = await import('./plugins/packageInspection');
        const response = await fetch(browserPluginPackage);
        if (!response.ok) throw new Error(`Plugin preview package returned ${response.status}.`);
        const document = await inspectPluginPackage(await response.arrayBuffer());
        usePluginStore.setState({ installed: [document], initialized: true, error: null });
        host.plugins.setActive(document, true);
        const firstView = document.manifest.contributes.views?.[0]?.id;
        if (firstView) useUIStore.getState().setActiveView(firstView as `${string}/${string}`);
        setInitialized(true);
      };
      void loadPackagePreview().catch(error => {
        console.error('Plugin package preview failed:', error);
        setInitialized(true);
      });
      return;
    }

    const init = async () => {
      console.log("Loading portfolio...");
      await Promise.all([loadPortfolio(), host.plugins.load()]);
      if (!usePortfolioStore.getState().loadError) console.log("Portfolio loaded!");
      setInitialized(true);
    };
    init();
  }, [browserPluginPackage, host, isBrowserPluginPackagePreview, isBrowserPluginPocPreview, isBrowserThemeStudioPreview, isBrowserWelcomePreview, loadPortfolio]);

  // Sync state between windows using Tauri global events
  useEffect(() => {
    if (!isTauriRuntime) return;

    let unlistenFn: (() => void) | undefined;

    const currentSender = isThemeStudio ? 'theme-studio' : 'main';
    listen('portfolio-reload', async (event) => {
      const payload = event.payload as { sender?: string } | null;
      if (payload?.sender !== currentSender) {
        console.log(`[${currentSender}] Reloading portfolio and settings due to update from ${payload?.sender}...`);
        await useSettingsStore.persist.rehydrate();
        await loadPortfolio();
      }
    }).then((unlisten) => {
      unlistenFn = unlisten;
    });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [isTauriRuntime, loadPortfolio, isThemeStudio]);

  if (!initialized || isLoading) {
    return (
      <div className="h-screen w-screen bg-app-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 bg-accent-primary rounded flex items-center justify-center shadow-lg shadow-amber-500/20 animate-pulse">
            <span className="font-black text-white text-sm tracking-tighter">AX</span>
          </div>
          <span className="text-text-muted text-sm">Loading portfolio...</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <ThemeProvider>
        <PortfolioLoadFailure
          error={loadError}
          recoveryAvailable={recoveryAvailable}
          onRecover={() => { void recoverPortfolioBackup(); }}
          onRetry={() => { void loadPortfolio(); }}
        />
      </ThemeProvider>
    );
  }

  // Render isolated full-screen Theme Studio window
  if (isThemeStudio) {
    return (
      <ThemeProvider>
        <div className="flex h-screen w-screen flex-col overflow-hidden border border-app-border bg-app-bg text-text-main">
          <Titlebar />
          <div className="min-h-0 flex-1">
            <Suspense fallback={<ViewLoading />}>
              <ThemeBuilder />
            </Suspense>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <Layout pluginRuntime={pluginRuntime}>
        {activeView === 'designer' && (
          portfolio.processes.length > 0 || previewGraph !== null
            ? <Canvas />
            : <EmptyPortfolioWelcome />
        )}
        {activeView === 'dependency' && (
          <Suspense fallback={<ViewLoading />}>
            <DependencyView />
          </Suspense>
        )}
        {activePluginView && (
          <Suspense fallback={<ViewLoading />}>
            <PluginViewHost
              runtime={pluginRuntime}
              viewId={activePluginView.id}
            />
          </Suspense>
        )}
      </Layout>
    </ThemeProvider>
  );
}

function App() {
  return (
    <PluginHostServicesProvider services={pluginHostServices}>
      <AppContent />
    </PluginHostServicesProvider>
  );
}

export default App;
