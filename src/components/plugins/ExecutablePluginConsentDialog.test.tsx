import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../context/ThemeContext';
import {
    ExecutablePackageReviewSchema,
    ISOLATED_COMPUTE_RISK_ACKNOWLEDGEMENT,
    type ExecutablePackageReview,
} from '../../plugins/executablePackageConsent';
import { InstalledPluginDocumentSchema } from '../../plugins/installedPackages';
import ExecutablePluginConsentDialog from './ExecutablePluginConsentDialog';

const review = (version = '2.0.0', dataVersion = 2): ExecutablePackageReview => (
    ExecutablePackageReviewSchema.parse({
        schema: 'axiom.executable-package-review',
        schemaVersion: 1,
        archiveSha256: 'a'.repeat(64),
        identity: {
            pluginId: 'org.axiom.analysis',
            pluginVersion: version,
            dataVersion,
        },
        name: 'Isolated Analysis',
        description: 'Runs a bounded deterministic analysis.',
        publisherName: 'Axiom Labs',
        requestedCapabilities: ['compute.isolated', 'proposal.create'],
        moduleSha256: 'b'.repeat(64),
        compressedBytes: 4096,
        expandedBytes: 8192,
        contributionCount: 1,
    })
);

const installed = InstalledPluginDocumentSchema.parse({
    schema: 'axiom.installed-plugin',
    schemaVersion: 1,
    installedAt: '2026-08-28T12:00:00.000Z',
    manifest: {
        schema: 'axiom.plugin',
        schemaVersion: 1,
        id: 'org.axiom.analysis',
        version: '1.0.0',
        name: 'Isolated Analysis',
        description: 'Previous version.',
        categories: ['method'],
        compatibility: { axiomPluginApi: '^1.0.0' },
        dataVersion: 1,
        capabilities: ['compute.isolated'],
        dependencies: [],
        runtime: {
            schema: 'axiom.plugin-wasm-runtime',
            schemaVersion: 1,
            abi: 'axiom-wasm-v1',
            module: 'runtime/plugin.wasm',
        },
        contributes: {
            analyses: [{
                id: 'org.axiom.analysis/risk',
                path: 'contributions/risk.json',
            }],
        },
    },
    grantedCapabilities: ['compute.isolated'],
    contributions: {
        'contributions/risk.json': {
            schema: 'axiom.plugin.analysis',
            schemaVersion: 1,
            id: 'org.axiom.analysis/risk',
        },
    },
});

const renderDialog = (
    candidate: ExecutablePackageReview,
    current = [installed],
    onApprove = vi.fn(),
) => {
    render(
        <ThemeProvider>
            <ExecutablePluginConsentDialog
                installed={current}
                onApprove={onApprove}
                onCancel={vi.fn()}
                review={candidate}
            />
        </ThemeProvider>,
    );
    return onApprove;
};

describe('ExecutablePluginConsentDialog', () => {
    it('requires explicit acknowledgement and binds approval to the reviewed archive', async () => {
        const user = userEvent.setup();
        const approve = renderDialog(review(), []);
        const install = screen.getByRole('button', { name: 'Install isolated plugin' });
        expect(install).toBeDisabled();
        expect(screen.getByText(/runs only declared, capability-gated commands/i)).toBeInTheDocument();

        await user.click(screen.getByRole('checkbox', {
            name: 'Acknowledge isolated executable code risk',
        }));
        await user.click(install);

        expect(approve).toHaveBeenCalledWith(expect.objectContaining({
            archiveSha256: 'a'.repeat(64),
            identity: expect.objectContaining({ pluginVersion: '2.0.0' }),
            grantedCapabilities: ['compute.isolated'],
            riskAcknowledgement: ISOLATED_COMPUTE_RISK_ACKNOWLEDGEMENT,
        }));
    });

    it('shows version and newly requested access during an update', () => {
        renderDialog(review());
        expect(screen.getByText(/Current v1\.0\.0 \/ data 1 → reviewed v2\.0\.0 \/ data 2/)).toBeInTheDocument();
        expect(screen.getByText('New access')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Approve isolated update' })).toBeDisabled();
    });

    it('offers connected bounded brokers with new access off by default', async () => {
        const user = userEvent.setup();
        const approve = renderDialog(review(), []);
        expect(screen.getByRole('checkbox', { name: 'Grant compute.isolated' })).toBeDisabled();
        expect(screen.getByRole('checkbox', { name: 'Grant proposal.create' })).toBeEnabled();
        expect(screen.getByRole('checkbox', { name: 'Grant proposal.create' })).not.toBeChecked();
        await user.click(screen.getByRole('checkbox', { name: 'Grant proposal.create' }));
        await user.click(screen.getByRole('checkbox', {
            name: 'Acknowledge isolated executable code risk',
        }));
        await user.click(screen.getByRole('button', { name: 'Install isolated plugin' }));
        expect(approve).toHaveBeenCalledWith(expect.objectContaining({
            grantedCapabilities: ['compute.isolated', 'proposal.create'],
        }));
    });

    it('continues to withhold capabilities without an executable broker', () => {
        renderDialog(ExecutablePackageReviewSchema.parse({
            ...review(),
            requestedCapabilities: ['compute.isolated', 'network.declared'],
        }), []);

        expect(screen.getByRole('checkbox', { name: 'Grant network.declared' })).toBeDisabled();
        expect(screen.getByRole('checkbox', { name: 'Grant network.declared' })).not.toBeChecked();
        expect(screen.getByText('Not available')).toBeInTheDocument();
    });

    it('requires every capability bound to a reviewed interactive operation', async () => {
        const user = userEvent.setup();
        const approve = renderDialog(ExecutablePackageReviewSchema.parse({
            ...review(),
            requestedCapabilities: ['compute.isolated', 'portfolio.read-scoped'],
            interactiveOperations: [{
                viewId: 'org.axiom.analysis/composed',
                operation: 'ui.analysis.reduce',
                requiredCapabilities: ['compute.isolated', 'portfolio.read-scoped'],
            }],
        }), []);
        expect(screen.getByText('ui.analysis.reduce')).toBeInTheDocument();
        expect(screen.getByText('org.axiom.analysis/composed')).toBeInTheDocument();
        await user.click(screen.getByRole('checkbox', { name: 'Acknowledge isolated executable code risk' }));
        const install = screen.getByRole('button', { name: 'Install isolated plugin' });
        expect(install).toBeDisabled();
        await user.click(screen.getByRole('checkbox', { name: 'Grant portfolio.read-scoped' }));
        expect(install).toBeEnabled();
        await user.click(install);
        expect(approve).toHaveBeenCalledWith(expect.objectContaining({
            approvedInteractiveOperations: ['ui.analysis.reduce'],
            grantedCapabilities: ['compute.isolated', 'portfolio.read-scoped'],
        }));
    });

    it('supports composed UI capabilities and allows granting all required in one click', async () => {
        const user = userEvent.setup();
        const approve = renderDialog(ExecutablePackageReviewSchema.parse({
            ...review(),
            requestedCapabilities: [
                'compute.isolated',
                'plugin-data.write',
                'portfolio.read-scoped',
                'workspace.navigate',
                'file.write-selected',
                'clipboard.write',
            ],
            interactiveOperations: [{
                viewId: 'org.axiom.tasks/tasks',
                operation: 'ui.tasks.reduce',
                requiredCapabilities: [
                    'compute.isolated',
                    'plugin-data.write',
                    'portfolio.read-scoped',
                    'workspace.navigate',
                    'file.write-selected',
                    'clipboard.write',
                ],
            }],
        }), []);

        // None of the composed UI capabilities should be marked 'Not available'
        expect(screen.queryByText('Not available')).not.toBeInTheDocument();

        // Checkboxes should be enabled
        expect(screen.getByRole('checkbox', { name: 'Grant plugin-data.write' })).toBeEnabled();
        expect(screen.getByRole('checkbox', { name: 'Grant workspace.navigate' })).toBeEnabled();
        expect(screen.getByRole('checkbox', { name: 'Grant file.write-selected' })).toBeEnabled();
        expect(screen.getByRole('checkbox', { name: 'Grant clipboard.write' })).toBeEnabled();

        // Grant all required button should be present while grants are missing
        const grantAllBtn = screen.getByRole('button', { name: 'Grant all required' });
        expect(grantAllBtn).toBeInTheDocument();
        expect(screen.getByText('Grant all required capabilities to enable interactive views.')).toBeInTheDocument();

        await user.click(grantAllBtn);

        // After clicking Grant all required, the button and hint disappear
        expect(screen.queryByRole('button', { name: 'Grant all required' })).not.toBeInTheDocument();
        expect(screen.queryByText('Grant all required capabilities to enable interactive views.')).not.toBeInTheDocument();

        // Acknowledge risk and install
        await user.click(screen.getByRole('checkbox', { name: 'Acknowledge isolated executable code risk' }));
        const install = screen.getByRole('button', { name: 'Install isolated plugin' });
        expect(install).toBeEnabled();
        await user.click(install);

        expect(approve).toHaveBeenCalledWith(expect.objectContaining({
            approvedInteractiveOperations: ['ui.tasks.reduce'],
            grantedCapabilities: expect.arrayContaining([
                'compute.isolated',
                'plugin-data.write',
                'portfolio.read-scoped',
                'workspace.navigate',
                'file.write-selected',
                'clipboard.write',
            ]),
        }));
    });

    it('blocks downgrade approval before native installation', () => {
        renderDialog(review('0.9.0', 1));
        expect(screen.getByRole('alert')).toHaveTextContent(/must increase the package version/i);
        expect(screen.getByRole('button', { name: 'Install isolated plugin' })).toBeDisabled();
        expect(screen.getByRole('checkbox', {
            name: 'Acknowledge isolated executable code risk',
        })).toBeDisabled();
    });
});
