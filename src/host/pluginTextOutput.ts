import { isTauri } from '@tauri-apps/api/core';

export const PLUGIN_TEXT_OUTPUT_MAX_BYTES = 128 * 1024;

export type PluginTextFileResult =
    | { readonly status: 'saved'; readonly fileName: string }
    | { readonly status: 'cancelled' };

export const sanitizePluginTextBaseName = (input: string): string => {
    const normalized = input.normalize('NFKC')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '')
        .replace(/-{2,}/g, '-')
        .slice(0, 100);
    const base = normalized || 'plugin-report';
    return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)
        ? `plugin-${base}`
        : base;
};

const assertBoundedText = (text: string): void => {
    if (new TextEncoder().encode(text).byteLength > PLUGIN_TEXT_OUTPUT_MAX_BYTES) {
        throw new Error('Plugin text output exceeds the 128 KiB limit.');
    }
};

export interface PluginTextOutputDependencies {
    readonly chooseTextFile: (fileName: string) => Promise<string | null>;
    readonly writeTextFile: (path: string, text: string) => Promise<void>;
    readonly writeClipboardText: (text: string) => Promise<void>;
}

const loadDependencies = async (): Promise<PluginTextOutputDependencies> => {
    if (!isTauri()) {
        return {
            chooseTextFile: async fileName => fileName,
            writeTextFile: async (fileName, text) => {
                const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = fileName;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            },
            writeClipboardText: async text => {
                if (!navigator.clipboard?.writeText) throw new Error('Clipboard output is unavailable.');
                await navigator.clipboard.writeText(text);
            },
        };
    }
    const [{ save }, { writeTextFile }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs'),
    ]);
    return {
        chooseTextFile: fileName => save({
            defaultPath: fileName,
            filters: [{ name: 'Text', extensions: ['txt'] }],
        }),
        writeTextFile,
        writeClipboardText: async text => {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard output is unavailable.');
            await navigator.clipboard.writeText(text);
        },
    };
};

export async function savePluginText(
    suggestedBaseName: string,
    text: string,
    dependencies?: PluginTextOutputDependencies,
): Promise<PluginTextFileResult> {
    assertBoundedText(text);
    const fileName = `${sanitizePluginTextBaseName(suggestedBaseName.replace(/\.txt$/i, ''))}.txt`;
    const output = dependencies ?? await loadDependencies();
    const path = await output.chooseTextFile(fileName);
    if (!path) return Object.freeze({ status: 'cancelled' });
    await output.writeTextFile(path, text);
    return Object.freeze({ status: 'saved', fileName });
}

export async function copyPluginText(
    text: string,
    dependencies?: PluginTextOutputDependencies,
): Promise<Readonly<{ status: 'copied' }>> {
    assertBoundedText(text);
    const output = dependencies ?? await loadDependencies();
    await output.writeClipboardText(text);
    return Object.freeze({ status: 'copied' });
}
