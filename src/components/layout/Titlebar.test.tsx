import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { usePluginStore } from '../../stores/usePluginStore';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { emptyPortfolio } from '../../stores/slices/coreSlice';
import { pluginDeveloperSandbox } from '../../host/pluginDeveloperSandbox';
import Titlebar from './Titlebar';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));

describe('Titlebar Developer Mode status', () => {
    beforeEach(() => {
        pluginDeveloperSandbox.stop();
        useSettingsStore.setState({ developerModeEnabled: false });
        usePluginStore.setState({ installed: [], initialized: true, error: null });
        usePortfolioStore.setState({ portfolio: structuredClone(emptyPortfolio), changeRevision: 0 });
    });

    it('keeps a persistent visible indicator while Developer Mode is enabled', () => {
        render(<Titlebar />);
        expect(screen.queryByRole('status', { name: 'Developer Mode is active' })).not.toBeInTheDocument();

        act(() => useSettingsStore.getState().setDeveloperModeEnabled(true));
        expect(screen.getByRole('status', { name: 'Developer Mode is active' })).toHaveTextContent('Developer Mode');

        act(() => useSettingsStore.getState().setDeveloperModeEnabled(false));
        expect(screen.queryByRole('status', { name: 'Developer Mode is active' })).not.toBeInTheDocument();
    });

    it('adds an unmistakable not-saved indicator while a sandbox clone exists', () => {
        useSettingsStore.setState({ developerModeEnabled: true });
        render(<Titlebar />);

        act(() => { pluginDeveloperSandbox.start(); });
        expect(screen.getByRole('status', { name: 'Disposable plugin sandbox is active' })).toHaveTextContent(
            'Sandbox · not saved',
        );

        act(() => useSettingsStore.getState().setDeveloperModeEnabled(false));
        expect(pluginDeveloperSandbox.getSnapshot()).toEqual({ active: false });
        expect(screen.queryByRole('status', { name: 'Disposable plugin sandbox is active' })).not.toBeInTheDocument();
    });
});
