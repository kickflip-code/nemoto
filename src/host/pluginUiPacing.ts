import { PLUGIN_UI_LIMITS } from '../plugins/pluginUiProtocol';

// Shared across view instances and package updates. Native independently enforces
// the rolling ceilings. This scheduler keeps legitimate receipt chains below them.
const nextSlots = new Map<string, number>();
const interval = Math.max(1000 / PLUGIN_UI_LIMITS.reductionsPerSecond,
    60_000 / PLUGIN_UI_LIMITS.reductionsPerMinute) + 1;
export async function waitForPluginUiSlot(pluginId: string): Promise<void> {
    const now = performance.now();
    for (const [id, next] of nextSlots) if (next < now) nextSlots.delete(id);
    const slot = Math.max(now, nextSlots.get(pluginId) ?? now);
    nextSlots.set(pluginId, slot + interval);
    if (slot > now) await new Promise<void>(resolve => setTimeout(resolve, slot - now));
}
