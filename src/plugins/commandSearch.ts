import type {
    PluginCommandRegistry,
    RegisteredPluginCommand,
} from './commandRegistry';

export function searchPluginCommands(
    registry: PluginCommandRegistry,
    query: string,
    limit = 12,
): RegisteredPluginCommand[] {
    const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || limit <= 0) return [];

    return registry.list('omnibox').filter(command => {
        const searchable = [
            command.title,
            command.description || '',
            command.pluginId,
            ...command.keywords,
        ].join(' ').toLocaleLowerCase();
        return tokens.every(token => searchable.includes(token));
    }).slice(0, limit);
}
