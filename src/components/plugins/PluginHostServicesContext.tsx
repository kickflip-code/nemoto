import {
    createContext,
    useContext,
    useSyncExternalStore,
    type ReactNode,
} from 'react';
import type {
    PluginHostServices,
    PluginHostSnapshot,
} from '../../plugins/hostServices';

const PluginHostServicesContext = createContext<PluginHostServices | null>(null);

export function PluginHostServicesProvider({
    children,
    services,
}: {
    children: ReactNode;
    services: PluginHostServices;
}) {
    return (
        <PluginHostServicesContext.Provider value={services}>
            {children}
        </PluginHostServicesContext.Provider>
    );
}

export function usePluginHostServices(): PluginHostServices {
    const services = useContext(PluginHostServicesContext);
    if (!services) {
        throw new Error('PluginHostServicesProvider is missing.');
    }
    return services;
}

export function usePluginHostSnapshot(): PluginHostSnapshot {
    const services = usePluginHostServices();
    return useSyncExternalStore(
        services.subscribe,
        services.getSnapshot,
        services.getSnapshot,
    );
}
