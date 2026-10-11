import type { PluginActivationResult } from './activation';
import {
    CURRENT_PLUGIN_CONTRIBUTION_SCHEMA_VERSION,
    PLUGIN_CONTRIBUTION_SCHEMAS,
    isSupportedContributionFamily,
    type PluginContributionPayload,
    type PluginContributionPayloadByFamily,
    type SupportedPluginContributionFamily,
} from './contributionSchemas';
import type {
    PluginContributionFamily,
    RegisteredPluginContribution,
} from './contributions';

export type PluginContributionSources = Readonly<Record<
    string,
    Readonly<Record<string, unknown>>
>>;

/** @deprecated Prefer PluginContributionSources. */
export type BundledPluginContributionSources = PluginContributionSources;

export interface LoadedPluginContribution<TFamily extends SupportedPluginContributionFamily = SupportedPluginContributionFamily> {
    readonly registration: RegisteredPluginContribution & { family: TFamily };
    readonly payload: PluginContributionPayloadByFamily[TFamily];
}

export interface PluginContentDiagnostic {
    severity: 'error' | 'warning';
    code:
        | 'unsupported-contribution-family'
        | 'unsupported-package-source'
        | 'missing-contribution-content'
        | 'unsupported-contribution-version'
        | 'invalid-contribution-content'
        | 'contribution-id-mismatch';
    message: string;
    pluginId: string;
    contributionId: string;
    family: PluginContributionFamily;
}

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.freeze(value);
};

const contributionSchemaVersion = (value: unknown): number | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const version = (value as Record<string, unknown>).schemaVersion;
    return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
};

export class PluginContentRegistry {
    readonly size: number;
    readonly #byId: ReadonlyMap<string, LoadedPluginContribution>;

    constructor(contributions: readonly LoadedPluginContribution[]) {
        this.#byId = new Map(contributions.map(contribution => [
            contribution.registration.id,
            deepFreeze({
                registration: { ...contribution.registration },
                payload: contribution.payload,
            }),
        ]));
        this.size = this.#byId.size;
    }

    get(contributionId: string): LoadedPluginContribution | undefined {
        return this.#byId.get(contributionId);
    }

    getPayload<TFamily extends SupportedPluginContributionFamily>(
        contributionId: string,
        family: TFamily,
    ): PluginContributionPayloadByFamily[TFamily] | undefined {
        const contribution = this.#byId.get(contributionId);
        if (!contribution || contribution.registration.family !== family) return undefined;
        return contribution.payload as PluginContributionPayloadByFamily[TFamily];
    }

    list<TFamily extends SupportedPluginContributionFamily>(
        family: TFamily,
    ): Array<LoadedPluginContribution<TFamily>> {
        return [...this.#byId.values()].filter(
            (contribution): contribution is LoadedPluginContribution<TFamily> => (
                contribution.registration.family === family
            ),
        );
    }
}

export interface LoadPluginContentResult {
    registry: PluginContentRegistry;
    diagnostics: PluginContentDiagnostic[];
}

const makeDiagnostic = (
    registration: RegisteredPluginContribution,
    code: PluginContentDiagnostic['code'],
    message: string,
): PluginContentDiagnostic => ({
    severity: registration.optional ? 'warning' : 'error',
    code,
    message,
    pluginId: registration.pluginId,
    contributionId: registration.id,
    family: registration.family,
});

export function loadPluginContent(
    activation: PluginActivationResult,
    sources: PluginContributionSources,
): LoadPluginContentResult {
    if (activation.status === 'blocked') {
        return { registry: new PluginContentRegistry([]), diagnostics: [] };
    }

    const loaded: LoadedPluginContribution[] = [];
    const diagnostics: PluginContentDiagnostic[] = [];

    activation.registry.list().forEach(registration => {
        if (!isSupportedContributionFamily(registration.family)) {
            diagnostics.push(makeDiagnostic(
                registration,
                'unsupported-contribution-family',
                `Contribution family ${registration.family} is not supported by the Phase 2 host.`,
            ));
            return;
        }

        const source = sources[registration.pluginId]?.[registration.path];
        if (source === undefined) {
            diagnostics.push(makeDiagnostic(
                registration,
                'missing-contribution-content',
                `Plugin contribution file ${registration.path} is missing.`,
            ));
            return;
        }

        const sourceVersion = contributionSchemaVersion(source);
        if (sourceVersion !== undefined && sourceVersion > CURRENT_PLUGIN_CONTRIBUTION_SCHEMA_VERSION) {
            diagnostics.push(makeDiagnostic(
                registration,
                'unsupported-contribution-version',
                `Contribution schema version ${sourceVersion} is newer than the supported version ${CURRENT_PLUGIN_CONTRIBUTION_SCHEMA_VERSION}.`,
            ));
            return;
        }

        const schema = PLUGIN_CONTRIBUTION_SCHEMAS[registration.family];
        const result = schema.safeParse(source);
        if (!result.success) {
            diagnostics.push(makeDiagnostic(
                registration,
                'invalid-contribution-content',
                `Contribution file ${registration.path} failed ${registration.family} validation.`,
            ));
            return;
        }

        if (result.data.id !== registration.id) {
            diagnostics.push(makeDiagnostic(
                registration,
                'contribution-id-mismatch',
                `Contribution file ${registration.path} declares ${result.data.id} instead of ${registration.id}.`,
            ));
            return;
        }

        loaded.push({
            registration: registration as RegisteredPluginContribution & {
                family: SupportedPluginContributionFamily;
            },
            payload: deepFreeze(result.data as PluginContributionPayload),
        });
    });

    diagnostics.sort((left, right) => (
        (left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1)
        || left.contributionId.localeCompare(right.contributionId)
        || left.code.localeCompare(right.code)
    ));

    return { registry: new PluginContentRegistry(loaded), diagnostics };
}

/** @deprecated Kept for the bundled proof-of-concept fixtures. */
export const loadBundledPluginContent = loadPluginContent;
