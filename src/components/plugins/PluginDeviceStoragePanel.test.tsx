import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PluginDeviceStorageAdminService } from '../../host/pluginDeviceStorageAdmin';
import PluginDeviceStoragePanel from './PluginDeviceStoragePanel';

describe('plugin device-storage administration panel', () => {
    it('reviews retained metadata and requires confirmation before permanent clearing', async () => {
        const entry = {
            pluginId: 'org.axiom.retired-plugin',
            hasSettings: true,
            settingsDocumentCount: 2,
            settingsBytes: 1_536,
            hasSecretIndex: true,
            secretCount: 1,
        } as const;
        const list = vi.fn()
            .mockResolvedValueOnce([entry])
            .mockResolvedValueOnce([]);
        const clear = vi.fn(async () => ({
            pluginId: entry.pluginId,
            settingsRemoved: true,
            settingsDocumentsCleared: 2,
            secretIndexRemoved: true,
            secretsCleared: 1,
        }));
        const service: PluginDeviceStorageAdminService = { list, clear };
        const user = userEvent.setup();

        render(<PluginDeviceStoragePanel installedPlugins={[]} service={service} />);

        expect(await screen.findByText('Previously installed plugin')).toBeInTheDocument();
        expect(screen.getByText(entry.pluginId)).toBeInTheDocument();
        expect(screen.getByText('2 settings · 1.5 KiB')).toBeInTheDocument();
        expect(screen.getByText('1 protected secret')).toBeInTheDocument();
        expect(screen.getByText(/Secret values are never displayed/i)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Clear device data' }));
        expect(clear).not.toHaveBeenCalled();
        expect(screen.getByRole('heading', { name: 'Clear retained plugin data?' }))
            .toBeInTheDocument();
        expect(screen.getByText(/This cannot be undone/i)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Clear permanently' }));
        await waitFor(() => expect(clear).toHaveBeenCalledWith(entry.pluginId));
        expect(await screen.findByText(/No device-local plugin settings/i)).toBeInTheDocument();
        expect(list).toHaveBeenCalledTimes(2);
    });

    it('does not expose native failure details or mutate data after an inventory failure', async () => {
        const service: PluginDeviceStorageAdminService = {
            list: vi.fn(async () => {
                throw new Error('C:\\private\\plugin-secret-indexes\\broken.json');
            }),
            clear: vi.fn(),
        };

        render(<PluginDeviceStoragePanel installedPlugins={[]} service={service} />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Device data could not be inspected safely.',
        );
        expect(screen.queryByText(/private\\plugin-secret-indexes/i)).not.toBeInTheDocument();
        expect(service.clear).not.toHaveBeenCalled();
    });
});
