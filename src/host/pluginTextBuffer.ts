import { PLUGIN_UI_LIMITS } from '../plugins/pluginUiProtocol';

/** One ephemeral report per view instance, never written to Portfolio data. */
export function createPluginTextBuffer() {
    let text = '';
    let bytes = 0;
    let revision: number | null = null;
    return {
        reset(nextRevision: number) { text = ''; bytes = 0; revision = nextRevision; },
        append(fragment: string, expectedRevision: number) {
            if (revision !== expectedRevision) throw new Error('Prepared text is stale. Prepare the report again.');
            const next = bytes + new TextEncoder().encode(fragment).byteLength;
            if (next > PLUGIN_UI_LIMITS.textOutputBytes) {
                text = ''; bytes = 0; revision = null;
                throw new Error('The complete report exceeds the 128 KiB text-output limit. Narrow the filters.');
            }
            text += fragment; bytes = next;
            return bytes;
        },
        read(expectedRevision: number) {
            if (revision !== expectedRevision) throw new Error('Prepared text is stale. Prepare the report again.');
            return text;
        },
        dispose() { text = ''; bytes = 0; revision = null; },
    };
}
export type PluginTextBuffer = ReturnType<typeof createPluginTextBuffer>;
