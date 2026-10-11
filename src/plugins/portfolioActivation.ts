import type { Portfolio } from '../types';
import type { InstalledPluginDocument } from './installedPackages';
import { createEmptyPortfolioPluginState } from './portfolioData';

export function setPortfolioPluginActive(
    portfolio: Portfolio,
    document: InstalledPluginDocument,
    active: boolean,
): Portfolio {
    const pluginState = portfolio.plugins || createEmptyPortfolioPluginState();
    const previous = pluginState.requirements.find(item => item.pluginId === document.manifest.id);
    const requirement = {
        pluginId: document.manifest.id,
        version: !active && previous ? previous.version : `=${document.manifest.version}`,
        dataVersion: !active && previous ? previous.dataVersion : document.manifest.dataVersion,
        requirement: active ? 'recommended' as const : 'previously-used' as const,
        activation: active ? 'active' as const : 'inactive' as const,
    };

    return {
        ...portfolio,
        plugins: {
            ...pluginState,
            requirements: [
                ...pluginState.requirements.filter(item => item.pluginId !== document.manifest.id),
                requirement,
            ],
        },
    };
}
