import { isTauri } from '@tauri-apps/api/core';
import { createActivePluginRuntime } from '../plugins/activeRuntime';
import type { DeclarativePluginRuntime } from '../plugins/declarativeRuntime';
import {
    InstalledPluginDocumentSchema,
    type InstalledPluginDocument,
} from '../plugins/installedPackages';
import type { PortfolioPluginRequirement } from '../plugins/portfolioData';
import { satisfiesVersionRange } from '../plugins/versionRange';
import { listInstalledPluginDocuments } from '../lib/tauri';
import { usePluginStore } from '../stores/usePluginStore';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useUIStore } from '../stores/useUIStore';
import { pluginDeveloperDiagnostics } from './pluginDeveloperDiagnostics';

export type PluginDeveloperReloadErrorCode =
    | 'developer-mode-disabled'
    | 'reload-in-progress'
    | 'read-failed'
    | 'invalid-installed-document'
    | 'package-set-changed'
    | 'package-version-changed'
    | 'data-version-changed'
    | 'capability-grants-changed'
    | 'portfolio-changed'
    | 'installed-state-changed'
    | 'runtime-blocked'
    | 'unexpected-failure';

const RELOAD_ERROR_MESSAGES: Record<PluginDeveloperReloadErrorCode, string> = {
    'developer-mode-disabled': 'Enable Developer Mode before reloading declarative packages.',
    'reload-in-progress': 'A declarative package reload is already in progress.',
    'read-failed': 'Nemoto could not read the installed declarative package documents.',
    'invalid-installed-document': 'Reload was rejected because an installed package document is invalid.',
    'package-set-changed': 'Reload cannot install or remove packages. Use the normal package controls first.',
    'package-version-changed': 'Reload cannot change package versions. Install the update through the normal package flow.',
    'data-version-changed': 'Reload cannot change plugin data versions. A migration is required.',
    'capability-grants-changed': 'Reload cannot change declared effective grants. Review permissions through the normal package flow.',
    'portfolio-changed': 'The portfolio changed while packages were being validated. Reload again.',
    'installed-state-changed': 'The installed package state changed while reload was running. Reload again.',
    'runtime-blocked': 'Reload was rejected because the candidate catalog or registries did not validate.',
    'unexpected-failure': 'Reload was rejected by an unexpected host validation failure. The current runtime was kept.',
};

export class PluginDeveloperReloadError extends Error {
    constructor(readonly code: PluginDeveloperReloadErrorCode) {
        super(RELOAD_ERROR_MESSAGES[code]);
        this.name = 'PluginDeveloperReloadError';
    }
}

export interface PluginDeveloperRuntimeReloadSnapshot {
    readonly status: 'idle' | 'reloading' | 'succeeded' | 'rejected';
    readonly generation: number;
    readonly lastAttemptAt?: string;
    readonly lastSuccessAt?: string;
    readonly lastErrorCode?: PluginDeveloperReloadErrorCode;
    readonly packageCount: number;
    readonly activePluginCount: number;
    readonly navigationViewCount: number;
}

export interface PluginDeveloperRuntimeReloadResult {
    readonly generation: number;
    readonly packageCount: number;
    readonly activePluginCount: number;
    readonly navigationViewCount: number;
    readonly reloadedAt: string;
}

interface PluginDeveloperRuntimeReloadDependencies {
    readonly isDeveloperModeEnabled: () => boolean;
    readonly readInstalledDocuments: () => Promise<readonly unknown[]>;
    readonly getInstalledPlugins: () => readonly InstalledPluginDocument[];
    readonly getRequirements: () => readonly PortfolioPluginRequirement[];
    readonly getPortfolioRevision: () => number;
    readonly publishInstalledPlugins: (documents: readonly InstalledPluginDocument[]) => void;
    readonly getActiveView: () => string;
    readonly resetNavigation: () => void;
    readonly clock: () => Date;
    readonly recordLifecycle: (outcome: 'succeeded' | 'failed', durationMs: number) => void;
    readonly captureRuntime: (runtime: DeclarativePluginRuntime, durationMs: number) => void;
}

const monotonicNow = (): number => (
    typeof performance === 'undefined' ? Date.now() : performance.now()
);

const elapsedSince = (startedAt: number): number => (
    Math.max(0, Math.round((monotonicNow() - startedAt) * 100) / 100)
);

const sameStringSet = (left: readonly string[], right: readonly string[]): boolean => {
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.length === sortedRight.length
        && sortedLeft.every((value, index) => value === sortedRight[index]);
};

const parseReloadCandidate = (
    values: readonly unknown[],
    current: readonly InstalledPluginDocument[],
): InstalledPluginDocument[] => {
    const parsed = values.map(value => {
        const result = InstalledPluginDocumentSchema.safeParse(value);
        if (!result.success) throw new PluginDeveloperReloadError('invalid-installed-document');
        return result.data;
    });
    const currentIds = current.map(document => document.manifest.id);
    const candidateIds = parsed.map(document => document.manifest.id);
    if (!sameStringSet(currentIds, candidateIds)) {
        throw new PluginDeveloperReloadError('package-set-changed');
    }

    const currentById = new Map(current.map(document => [document.manifest.id, document]));
    return parsed.map(document => {
        const installed = currentById.get(document.manifest.id)!;
        if (document.manifest.version !== installed.manifest.version) {
            throw new PluginDeveloperReloadError('package-version-changed');
        }
        if (document.manifest.dataVersion !== installed.manifest.dataVersion) {
            throw new PluginDeveloperReloadError('data-version-changed');
        }
        if (
            !sameStringSet(document.grantedCapabilities, installed.grantedCapabilities)
            || installed.grantedCapabilities.some(capability => !document.manifest.capabilities.includes(capability))
        ) {
            throw new PluginDeveloperReloadError('capability-grants-changed');
        }
        return InstalledPluginDocumentSchema.parse({
            ...document,
            installedAt: installed.installedAt,
            grantedCapabilities: [...installed.grantedCapabilities],
        });
    }).sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
};

const assertActiveRequirementsCompatible = (
    documents: readonly InstalledPluginDocument[],
    requirements: readonly PortfolioPluginRequirement[],
): void => {
    const documentsById = new Map(documents.map(document => [document.manifest.id, document]));
    const compatible = requirements
        .filter(requirement => requirement.activation === 'active')
        .every(requirement => {
            const document = documentsById.get(requirement.pluginId);
            return !!document
                && satisfiesVersionRange(document.manifest.version, requirement.version)
                && document.manifest.dataVersion === requirement.dataVersion;
        });
    if (!compatible) throw new PluginDeveloperReloadError('runtime-blocked');
};

export class PluginDeveloperRuntimeReloadService {
    readonly #dependencies: PluginDeveloperRuntimeReloadDependencies;
    readonly #listeners = new Set<() => void>();
    #snapshot: PluginDeveloperRuntimeReloadSnapshot = Object.freeze({
        status: 'idle',
        generation: 0,
        packageCount: 0,
        activePluginCount: 0,
        navigationViewCount: 0,
    });

    constructor(dependencies: PluginDeveloperRuntimeReloadDependencies) {
        this.#dependencies = dependencies;
    }

    getSnapshot = (): PluginDeveloperRuntimeReloadSnapshot => this.#snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    };

    async reload(): Promise<PluginDeveloperRuntimeReloadResult> {
        if (!this.#dependencies.isDeveloperModeEnabled()) {
            throw new PluginDeveloperReloadError('developer-mode-disabled');
        }
        if (this.#snapshot.status === 'reloading') {
            throw new PluginDeveloperReloadError('reload-in-progress');
        }

        const startedAt = monotonicNow();
        const attemptedAt = this.#dependencies.clock().toISOString();
        const installedAtStart = this.#dependencies.getInstalledPlugins();
        const portfolioRevisionAtStart = this.#dependencies.getPortfolioRevision();
        this.#setSnapshot({ ...this.#snapshot, status: 'reloading', lastAttemptAt: attemptedAt });

        try {
            let rawDocuments: readonly unknown[];
            try {
                rawDocuments = await this.#dependencies.readInstalledDocuments();
            } catch {
                throw new PluginDeveloperReloadError('read-failed');
            }
            const documents = parseReloadCandidate(rawDocuments, installedAtStart);
            const requirements = this.#dependencies.getRequirements();
            assertActiveRequirementsCompatible(documents, requirements);
            const runtime = createActivePluginRuntime(documents, requirements);
            if (runtime.status !== 'ready') {
                this.#captureRuntime(runtime, elapsedSince(startedAt));
                throw new PluginDeveloperReloadError('runtime-blocked');
            }
            if (this.#dependencies.getPortfolioRevision() !== portfolioRevisionAtStart) {
                throw new PluginDeveloperReloadError('portfolio-changed');
            }
            if (this.#dependencies.getInstalledPlugins() !== installedAtStart) {
                throw new PluginDeveloperReloadError('installed-state-changed');
            }
            if (!this.#dependencies.isDeveloperModeEnabled()) {
                throw new PluginDeveloperReloadError('developer-mode-disabled');
            }

            const activeView = this.#dependencies.getActiveView();
            const reloadedAt = this.#dependencies.clock().toISOString();
            const durationMs = elapsedSince(startedAt);
            const result = Object.freeze({
                generation: this.#snapshot.generation + 1,
                packageCount: documents.length,
                activePluginCount: runtime.activation.activePluginIds.length,
                navigationViewCount: runtime.navigationViews.length,
                reloadedAt,
            });
            const resetNavigation = activeView.includes('/')
                && !runtime.content.getPayload(activeView, 'views');

            this.#dependencies.publishInstalledPlugins(documents);
            if (resetNavigation) {
                try {
                    this.#dependencies.resetNavigation();
                } catch {
                    // Navigation recovery cannot roll back a validated runtime publication.
                }
            }
            this.#recordLifecycle('succeeded', durationMs);
            this.#setSnapshot({
                status: 'succeeded',
                generation: result.generation,
                lastAttemptAt: attemptedAt,
                lastSuccessAt: reloadedAt,
                packageCount: result.packageCount,
                activePluginCount: result.activePluginCount,
                navigationViewCount: result.navigationViewCount,
            });
            return result;
        } catch (error) {
            const reloadError = error instanceof PluginDeveloperReloadError
                ? error
                : new PluginDeveloperReloadError('unexpected-failure');
            const durationMs = elapsedSince(startedAt);
            this.#recordLifecycle('failed', durationMs);
            this.#setSnapshot({
                ...this.#snapshot,
                status: 'rejected',
                lastAttemptAt: attemptedAt,
                lastErrorCode: reloadError.code,
            });
            throw reloadError;
        }
    }

    #setSnapshot(snapshot: PluginDeveloperRuntimeReloadSnapshot): void {
        this.#snapshot = Object.freeze(snapshot);
        this.#listeners.forEach(listener => {
            try {
                listener();
            } catch {
                // Developer tooling must not interrupt runtime publication.
            }
        });
    }

    #recordLifecycle(outcome: 'succeeded' | 'failed', durationMs: number): void {
        try {
            this.#dependencies.recordLifecycle(outcome, durationMs);
        } catch {
            // Diagnostics must never change reload publication semantics.
        }
    }

    #captureRuntime(runtime: DeclarativePluginRuntime, durationMs: number): void {
        try {
            this.#dependencies.captureRuntime(runtime, durationMs);
        } catch {
            // Diagnostics must never change reload rejection semantics.
        }
    }
}

export const pluginDeveloperRuntimeReload = new PluginDeveloperRuntimeReloadService({
    isDeveloperModeEnabled: () => useSettingsStore.getState().developerModeEnabled,
    readInstalledDocuments: async () => (
        isTauri()
            ? listInstalledPluginDocuments()
            : usePluginStore.getState().installed
    ),
    getInstalledPlugins: () => usePluginStore.getState().installed,
    getRequirements: () => usePortfolioStore.getState().portfolio.plugins?.requirements || [],
    getPortfolioRevision: () => usePortfolioStore.getState().changeRevision,
    publishInstalledPlugins: documents => usePluginStore.setState({
        installed: [...documents],
        initialized: true,
        error: null,
    }),
    getActiveView: () => useUIStore.getState().activeView,
    resetNavigation: () => useUIStore.getState().setActiveView('designer'),
    clock: () => new Date(),
    recordLifecycle: (outcome, durationMs) => pluginDeveloperDiagnostics.recordLifecycle(
        'reload',
        outcome,
        undefined,
        durationMs,
    ),
    captureRuntime: (runtime, durationMs) => pluginDeveloperDiagnostics.captureRuntime(runtime, durationMs),
});
