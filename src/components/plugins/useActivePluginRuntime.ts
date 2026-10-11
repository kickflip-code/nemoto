import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createActivePluginRuntime } from '../../plugins/activeRuntime';
import { pluginDeveloperDiagnostics } from '../../host/pluginDeveloperDiagnostics';
import { usePluginHostSnapshot } from './PluginHostServicesContext';

const subscribeDeveloperDiagnostics = (listener: () => void) => (
    pluginDeveloperDiagnostics.subscribe(listener)
);
const getDeveloperDiagnosticsEnabled = () => pluginDeveloperDiagnostics.enabled;

export function useActivePluginRuntime() {
    const snapshot = usePluginHostSnapshot();
    const developerModeEnabled = useSyncExternalStore(
        subscribeDeveloperDiagnostics,
        getDeveloperDiagnosticsEnabled,
        getDeveloperDiagnosticsEnabled,
    );
    const runtime = useMemo(
        () => createActivePluginRuntime(
            snapshot.installedPlugins,
            snapshot.pluginRequirements,
        ),
        [snapshot.installedPlugins, snapshot.pluginRequirements],
    );
    useEffect(() => {
        pluginDeveloperDiagnostics.captureRuntime(runtime);
    }, [developerModeEnabled, runtime]);
    return runtime;
}
