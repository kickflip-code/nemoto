import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import type { RegisteredPluginCommand } from '../plugins/commandRegistry';
import {
    createExecutableComputeRequest,
    ExecutableComputeResultSchema,
    validateExecutableComputeResult,
    type ValidatedExecutableComputeResult,
} from '../plugins/executableCompute';
import { createPluginEntitySnapshot } from '../plugins/entityReadModel';
import { WasmPluginIdentitySchema } from '../plugins/executablePackageConsent';
import type { InstalledPluginDocument } from '../plugins/installedPackages';
import type { PortfolioPluginRequirement } from '../plugins/portfolioData';
import { createPortfolioRevision } from '../plugins/portfolioRevision';
import type { JsonValue } from '../plugins/semanticData';
import type { Portfolio } from '../types';
import type { PluginWorkspaceContext } from '../plugins/workspaceContracts';
import { synchronizeExecutablePluginAuthority } from './pluginExecutableAuthority';

const ExecutableProposalCapabilitySchema = z.enum([
    'compute.isolated',
    'portfolio.read-scoped',
    'proposal.create',
]);
const REQUIRED_PROPOSAL_CAPABILITIES = [
    'compute.isolated',
    'portfolio.read-scoped',
    'proposal.create',
] as const;

export const ExecutableProposalCommandOutcomeSchema = z.object({
    schema: z.literal('axiom.executable-proposal-command-result'),
    schemaVersion: z.literal(1),
    commandId: z.string().trim().min(3).max(240),
    identity: WasmPluginIdentitySchema,
    effectiveCapabilities: z.array(ExecutableProposalCapabilitySchema).max(3)
        .refine(values => new Set(values).size === values.length),
    result: ExecutableComputeResultSchema,
}).strict().readonly();

export type ExecutableProposalCommand = RegisteredPluginCommand & {
    readonly action: Extract<RegisteredPluginCommand['action'], { kind: 'compute.propose' }>;
};

export type ExecutableProposalCommandContextErrorCode =
    | 'context-stale'
    | 'active-process-required'
    | 'selected-entity-required'
    | 'active-process-unavailable'
    | 'selected-entity-unavailable';

/**
 * A bounded, Core-authored precondition error that is safe to show to the user
 * and retain as a stable diagnostic status. Native/runtime failures remain
 * opaque at the command UI boundary.
 */
export class ExecutableProposalCommandContextError extends Error {
    constructor(
        readonly code: ExecutableProposalCommandContextErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'ExecutableProposalCommandContextError';
    }
}

export interface RunExecutableProposalCommandInput {
    readonly command: RegisteredPluginCommand;
    readonly installedDocument: InstalledPluginDocument;
    readonly portfolio: Portfolio;
    readonly portfolioRevision: number;
    readonly workspaceContext: Pick<
        PluginWorkspaceContext,
        'portfolioRevision' | 'activeProcess' | 'primarySelection'
    >;
    readonly requirements: readonly PortfolioPluginRequirement[];
    readonly now?: () => Date;
    readonly requestId?: () => string;
}

export interface ExecutableProposalCommandResult extends ValidatedExecutableComputeResult {
    readonly commandId: string;
}

const newRequestId = (): string => {
    const random = globalThis.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `compute:${random}`;
};

export async function runExecutableProposalCommand(
    input: RunExecutableProposalCommandInput,
): Promise<ExecutableProposalCommandResult> {
    if (input.command.action.kind !== 'compute.propose') {
        throw new Error('The selected command is not an executable proposal command.');
    }
    const command = input.command as ExecutableProposalCommand;
    const document = input.installedDocument;
    if (document.manifest.id !== command.pluginId
        || document.manifest.version !== command.pluginVersion
        || !document.manifest.runtime) {
        throw new Error('The executable command does not match the installed package.');
    }
    if (input.workspaceContext.portfolioRevision !== input.portfolioRevision) {
        throw new ExecutableProposalCommandContextError(
            'context-stale',
            'The Portfolio changed before the command could run. Try again.',
        );
    }
    const contextReference = command.action.context.kind === 'active-process'
        ? input.workspaceContext.activeProcess
        : input.workspaceContext.primarySelection;
    if (!contextReference) {
        throw new ExecutableProposalCommandContextError(
            command.action.context.kind === 'active-process'
                ? 'active-process-required'
                : 'selected-entity-required',
            command.action.context.kind === 'active-process'
                ? 'Open a process before running this command.'
                : 'Select an entity before running this command.',
        );
    }
    const snapshot = createPluginEntitySnapshot(
        input.portfolio,
        contextReference,
        input.portfolioRevision,
    );
    if (!snapshot) {
        throw new ExecutableProposalCommandContextError(
            command.action.context.kind === 'active-process'
                ? 'active-process-unavailable'
                : 'selected-entity-unavailable',
            command.action.context.kind === 'active-process'
                ? 'The active process is no longer available.'
                : 'The selected entity is no longer available.',
        );
    }

    const requestId = (input.requestId || newRequestId)();
    const observedAt = (input.now || (() => new Date()))().toISOString();
    const request = createExecutableComputeRequest({
        requestId,
        baseRevision: createPortfolioRevision(input.portfolio),
        portfolioRevision: input.portfolioRevision,
        snapshots: [snapshot],
        parameters: {
            invocationId: requestId,
            observedAt,
            input: command.action.parameters as JsonValue,
        },
        grantedCapabilities: document.grantedCapabilities,
    });
    const authority = await synchronizeExecutablePluginAuthority(input.requirements, true);
    const decision = authority?.decisions.find(candidate => (
        candidate.identity.pluginId === command.pluginId
        && candidate.identity.pluginVersion === command.pluginVersion
        && candidate.identity.dataVersion === document.manifest.dataVersion
    ));
    if (!decision?.authorized || REQUIRED_PROPOSAL_CAPABILITIES.some(
        capability => !decision.effectiveCapabilities.includes(capability),
    )) {
        throw new Error('The executable plugin is not active and authorized for this Portfolio.');
    }

    const outcome = ExecutableProposalCommandOutcomeSchema.parse(
        await invoke<unknown>('run_executable_plugin_proposal_command', {
            commandId: command.id,
            request,
        }),
    );
    if (outcome.commandId !== command.id
        || outcome.identity.pluginId !== command.pluginId
        || outcome.identity.pluginVersion !== command.pluginVersion
        || outcome.identity.dataVersion !== document.manifest.dataVersion
        || REQUIRED_PROPOSAL_CAPABILITIES.some(
            capability => !outcome.effectiveCapabilities.includes(capability),
        )) {
        throw new Error('The executable command result identity does not match its installed package.');
    }
    const validated = validateExecutableComputeResult(outcome.result, {
        request,
        identity: outcome.identity,
        grantedCapabilities: outcome.effectiveCapabilities,
        proposedAt: observedAt,
    });
    if (!validated.proposal) {
        throw new Error('The executable proposal command returned no reviewable proposal.');
    }
    return Object.freeze({
        ...validated,
        commandId: command.id,
    });
}
