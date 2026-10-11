import { useState, useEffect, useMemo, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bug, FlaskConical, Minus, Square, X, Copy } from "lucide-react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { pluginDeveloperSandbox } from "../../host/pluginDeveloperSandbox";

export default function Titlebar() {
    const [isMaximized, setIsMaximized] = useState(false);
    const appWindow = useMemo(() => isTauri() ? getCurrentWindow() : null, []);
    const developerModeEnabled = useSettingsStore(state => state.developerModeEnabled);
    const sandboxSnapshot = useSyncExternalStore(
        pluginDeveloperSandbox.subscribe,
        pluginDeveloperSandbox.getSnapshot,
        pluginDeveloperSandbox.getSnapshot,
    );

    useEffect(() => {
        if (!appWindow) return;

        // Check initial state
        appWindow.isMaximized().then(setIsMaximized);

        // Listen for resize/maximize events to update icon
        const unlisten = appWindow.onResized(() => {
            appWindow.isMaximized().then(setIsMaximized);
        });

        return () => {
            unlisten.then((f) => f());
        };
    }, [appWindow]);

    const handleMinimize = () => appWindow?.minimize();
    const handleMaximize = () => appWindow?.toggleMaximize();
    const handleClose = () => appWindow?.close();

    return (
        <div
            data-tauri-drag-region
            className="h-8 bg-app-header border-b border-app-border flex items-center justify-between select-none"
        >
            <div className="flex items-center px-3 gap-2 pointer-events-none">
                {developerModeEnabled && (
                    <div
                        role="status"
                        aria-label="Developer Mode is active"
                        className="flex items-center gap-1.5 rounded border border-accent-warning/40 bg-accent-warning/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-accent-warning"
                    >
                        <Bug size={11} />
                        <span>Developer Mode</span>
                    </div>
                )}
                {sandboxSnapshot.active && (
                    <div
                        role="status"
                        aria-label="Disposable plugin sandbox is active"
                        className="flex items-center gap-1.5 rounded border border-accent-danger/50 bg-accent-danger/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-accent-danger"
                    >
                        <FlaskConical size={11} />
                        <span>Sandbox · not saved</span>
                    </div>
                )}
            </div>

            <div className="flex h-full">
                <button
                    onClick={handleMinimize}
                    className="px-3 h-full hover:bg-app-hover text-text-muted transition-colors"
                    title="Minimize"
                >
                    <Minus size={14} />
                </button>
                <button
                    onClick={handleMaximize}
                    className="px-3 h-full hover:bg-app-hover text-text-muted transition-colors"
                    title={isMaximized ? "Restore" : "Maximize"}
                >
                    {isMaximized ? <Copy size={12} /> : <Square size={12} />}
                </button>
                <button
                    onClick={handleClose}
                    className="px-3 h-full hover:bg-accent-danger/80 hover:text-white text-text-muted transition-colors"
                    title="Close"
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
}
