import { describe, expect, it, vi } from 'vitest';
import {
    copyPluginText,
    PLUGIN_TEXT_OUTPUT_MAX_BYTES,
    sanitizePluginTextBaseName,
    savePluginText,
    type PluginTextOutputDependencies,
} from './pluginTextOutput';

function dependencies(selection: string | null = 'C:\\private\\chosen.txt'): PluginTextOutputDependencies {
    return {
        chooseTextFile: vi.fn(async () => selection),
        writeTextFile: vi.fn(async () => undefined),
        writeClipboardText: vi.fn(async () => undefined),
    };
}

describe('plugin text output boundary', () => {
    it('sanitizes the basename, writes exact text, and never returns the selected path', async () => {
        const output = dependencies();
        const result = await savePluginText('../CON.txt', 'åäö\nexact', output);

        expect(output.chooseTextFile).toHaveBeenCalledWith('plugin-CON.txt');
        expect(output.writeTextFile).toHaveBeenCalledWith('C:\\private\\chosen.txt', 'åäö\nexact');
        expect(result).toEqual({ status: 'saved', fileName: 'plugin-CON.txt' });
        expect(JSON.stringify(result)).not.toContain('private');
    });

    it('treats a cancelled chooser as a successful no-write outcome', async () => {
        const output = dependencies(null);
        await expect(savePluginText('report', 'unchanged', output)).resolves.toEqual({ status: 'cancelled' });
        expect(output.writeTextFile).not.toHaveBeenCalled();
    });

    it('copies exact text through the bounded clipboard adapter', async () => {
        const output = dependencies();
        await expect(copyPluginText('filtered\nreport', output)).resolves.toEqual({ status: 'copied' });
        expect(output.writeClipboardText).toHaveBeenCalledWith('filtered\nreport');
    });

    it('rejects UTF-8 output beyond 128 KiB before opening an output surface', async () => {
        const output = dependencies();
        const oversized = 'å'.repeat((PLUGIN_TEXT_OUTPUT_MAX_BYTES / 2) + 1);
        await expect(savePluginText('report', oversized, output)).rejects.toThrow('128 KiB');
        await expect(copyPluginText(oversized, output)).rejects.toThrow('128 KiB');
        expect(output.chooseTextFile).not.toHaveBeenCalled();
        expect(output.writeClipboardText).not.toHaveBeenCalled();
    });

    it('provides a stable fallback for a basename containing no safe characters', () => {
        expect(sanitizePluginTextBaseName('…/…')).toBe('plugin-report');
    });
});
