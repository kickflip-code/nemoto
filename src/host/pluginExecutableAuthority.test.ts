import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMocks = vi.hoisted(() => ({
    invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: nativeMocks.invoke,
    isTauri: () => true,
}));

const requirement = {
    pluginId: 'org.axiom.compute',
    version: '=1.0.0',
    dataVersion: 1,
    requirement: 'recommended' as const,
    activation: 'active' as const,
};

const response = {
    schema: 'axiom.executable-authority-sync',
    schemaVersion: 1,
    authorityScopeId: 'portfolio:main',
    hostPluginApiVersion: '1.8.0',
    executionEnabled: false,
    decisions: [{
        identity: {
            pluginId: 'org.axiom.compute',
            pluginVersion: '1.0.0',
            dataVersion: 1,
        },
        portfolioActive: true,
        compatible: true,
        effectiveCapabilities: ['compute.isolated'],
        eligible: true,
        authorized: false,
        authorityGeneration: 1,
        invalidatedSessions: 0,
    }],
};

describe('executable authority host bridge', () => {
    beforeEach(() => {
        nativeMocks.invoke.mockReset();
        nativeMocks.invoke.mockResolvedValue(response);
    });

    it('sends no caller-selected identity, grants, API version, or scope', async () => {
        const { synchronizeExecutablePluginAuthority } = await import('./pluginExecutableAuthority');
        await synchronizeExecutablePluginAuthority([requirement], true);

        expect(nativeMocks.invoke).toHaveBeenCalledWith(
            'synchronize_executable_plugin_authority',
            {
                snapshot: {
                    schema: 'axiom.executable-activation-snapshot',
                    schemaVersion: 1,
                    requirements: [requirement],
                },
            },
        );
    });
});
