import { z } from 'zod';
import type { CanvasGraph, Portfolio } from '../types';
import { APP_VERSION } from './appVersion';
import { PortfolioSchema } from './schemas';
import {
    CURRENT_PORTFOLIO_SCHEMA_VERSION,
    migratePortfolioWithReport,
    type MigrationReport,
} from './import/migrate';
import { inspectPortfolioIntegrity, type PortfolioIntegrityReport } from './portfolioIntegrity';
import type { AxiomAppearanceBackup } from '../theme/themeBackup';

export const AXIOM_FORMAT_ID = 'axiom';
export type AxiomDocumentKind = 'portfolio' | 'process-fragment';

export interface AxiomEnvelope {
    format: typeof AXIOM_FORMAT_ID;
    kind: AxiomDocumentKind;
    schemaVersion: number;
    /** Legacy wrapper alias retained for older legacy readers. */
    version: string;
    appVersion: string;
    timestamp: string;
    type?: 'partial';
    sourceId?: string;
    /** Optional, non-canonical snapshot used to reproduce the active appearance after restore. */
    appearance?: AxiomAppearanceBackup;
    data: Portfolio;
    extensions?: Record<string, unknown>;
}

export interface DecodedPortfolio {
    portfolio: Portfolio;
    kind: AxiomDocumentKind;
    wasWrapped: boolean;
    sourceSchemaVersion: number;
    sourceAppVersion?: string;
    sourceTimestamp?: string;
    migration: MigrationReport;
    integrity: PortfolioIntegrityReport;
}

export class PortfolioCodecError extends Error {
    constructor(
        message: string,
        readonly code: 'INVALID_JSON' | 'INVALID_PORTFOLIO' | 'UNSUPPORTED_SCHEMA_VERSION',
        readonly issues?: z.ZodIssue[],
    ) {
        super(message);
        this.name = 'PortfolioCodecError';
    }
}

function formatIntegrityFailure(report: PortfolioIntegrityReport): string {
    const firstIssue = report.errors[0];
    const remainder = Math.max(0, report.errors.length - 1);
    return `Portfolio contains ${report.errors.length} reference or ID error(s). ${firstIssue.message}${remainder > 0 ? ` ${remainder} more error(s) must be resolved before this data can be written.` : ''}`;
}

export function assertPortfolioIntegrity(portfolio: Portfolio): PortfolioIntegrityReport {
    const report = inspectPortfolioIntegrity(portfolio);
    if (!report.valid) {
        throw new PortfolioCodecError(formatIntegrityFailure(report), 'INVALID_PORTFOLIO');
    }
    return report;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnvelopeLike(value: Record<string, unknown>): boolean {
    if (!isRecord(value.data)) return false;
    return value.format === AXIOM_FORMAT_ID
        || value.kind === 'portfolio'
        || value.kind === 'process-fragment'
        || value.type === 'partial'
        || typeof value.schemaVersion === 'number'
        || typeof value.version === 'string'
        || typeof value.appVersion === 'string'
        || typeof value.timestamp === 'string'
        || typeof value.exportedAt === 'string'
        || typeof value.source === 'string';
}

function inferDocumentKind(wrapper: Record<string, unknown> | undefined): AxiomDocumentKind {
    if (wrapper?.kind === 'process-fragment' || wrapper?.type === 'partial') {
        return 'process-fragment';
    }
    return 'portfolio';
}

function explicitSchemaVersion(
    wrapper: Record<string, unknown> | undefined,
    data: Record<string, unknown>,
): number {
    const wrapperVersion = wrapper?.schemaVersion;
    const dataVersion = data.schemaVersion;
    const hasWrapperVersion = typeof wrapperVersion === 'number' && Number.isInteger(wrapperVersion);
    const hasDataVersion = typeof dataVersion === 'number' && Number.isInteger(dataVersion);

    if (hasWrapperVersion && hasDataVersion && wrapperVersion !== dataVersion) {
        throw new PortfolioCodecError(
            `Nemoto envelope schema version ${wrapperVersion} does not match portfolio schema version ${dataVersion}.`,
            'INVALID_PORTFOLIO',
        );
    }

    const candidate = hasWrapperVersion ? wrapperVersion : hasDataVersion ? dataVersion : 0;
    if (candidate < 0) {
        throw new PortfolioCodecError('Nemoto schema version cannot be negative.', 'INVALID_PORTFOLIO');
    }
    return candidate;
}

export function decodePortfolioValue(input: unknown): DecodedPortfolio {
    if (!isRecord(input)) {
        throw new PortfolioCodecError('Nemoto document root must be a JSON object.', 'INVALID_PORTFOLIO');
    }

    const wrapper = isEnvelopeLike(input) ? input : undefined;
    const rawData = wrapper?.data ?? input;
    if (!isRecord(rawData)) {
        throw new PortfolioCodecError('Nemoto portfolio data must be a JSON object.', 'INVALID_PORTFOLIO');
    }

    const sourceSchemaVersion = explicitSchemaVersion(wrapper, rawData);
    if (sourceSchemaVersion > CURRENT_PORTFOLIO_SCHEMA_VERSION) {
        throw new PortfolioCodecError(
            `This file uses schema version ${sourceSchemaVersion}, but this Nemoto build supports up to ${CURRENT_PORTFOLIO_SCHEMA_VERSION}.`,
            'UNSUPPORTED_SCHEMA_VERSION',
        );
    }

    const compatibilityResult = PortfolioSchema.safeParse(rawData);
    if (!compatibilityResult.success) {
        throw new PortfolioCodecError(
            'Portfolio validation failed.',
            'INVALID_PORTFOLIO',
            compatibilityResult.error.issues,
        );
    }

    const migrated = migratePortfolioWithReport(compatibilityResult.data as unknown as Portfolio);
    const canonicalResult = PortfolioSchema.safeParse(migrated.portfolio);
    if (!canonicalResult.success) {
        throw new PortfolioCodecError(
            'Portfolio migration produced invalid canonical data.',
            'INVALID_PORTFOLIO',
            canonicalResult.error.issues,
        );
    }

    const portfolio = canonicalResult.data as unknown as Portfolio;
    return {
        portfolio,
        kind: inferDocumentKind(wrapper),
        wasWrapped: !!wrapper,
        sourceSchemaVersion,
        sourceAppVersion: typeof wrapper?.appVersion === 'string' ? wrapper.appVersion : undefined,
        sourceTimestamp: typeof wrapper?.timestamp === 'string'
            ? wrapper.timestamp
            : typeof wrapper?.exportedAt === 'string'
                ? wrapper.exportedAt
                : undefined,
        migration: migrated.report,
        integrity: inspectPortfolioIntegrity(portfolio),
    };
}

export function decodePortfolioJson(jsonContent: string): DecodedPortfolio {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonContent);
    } catch (error) {
        throw new PortfolioCodecError(
            error instanceof Error ? error.message : 'Invalid JSON.',
            'INVALID_JSON',
        );
    }
    return decodePortfolioValue(parsed);
}

function stripGraphUiState(graph: CanvasGraph): void {
    graph.nodes.forEach(node => {
        delete node.selected;
    });
    graph.edges.forEach(edge => {
        delete edge.selected;
    });
}

/**
 * Produce the durable portfolio projection. Pure UI selection is accepted on
 * legacy input but never emitted by current writers.
 */
export function preparePortfolioForPersistence(input: Portfolio): Portfolio {
    if (typeof input.schemaVersion === 'number' && !Number.isInteger(input.schemaVersion)) {
        throw new PortfolioCodecError('Nemoto schema version must be an integer.', 'INVALID_PORTFOLIO');
    }
    if (typeof input.schemaVersion === 'number' && input.schemaVersion > CURRENT_PORTFOLIO_SCHEMA_VERSION) {
        throw new PortfolioCodecError(
            `Cannot persist schema version ${input.schemaVersion}; this build supports up to ${CURRENT_PORTFOLIO_SCHEMA_VERSION}.`,
            'UNSUPPORTED_SCHEMA_VERSION',
        );
    }
    if (typeof input.schemaVersion === 'number' && input.schemaVersion < 0) {
        throw new PortfolioCodecError('Nemoto schema version cannot be negative.', 'INVALID_PORTFOLIO');
    }
    const migrated = migratePortfolioWithReport(input).portfolio;
    const portfolio = typeof structuredClone === 'function'
        ? structuredClone(migrated)
        : JSON.parse(JSON.stringify(migrated)) as Portfolio;

    portfolio.processes.forEach(process => {
        stripGraphUiState(process.graph);
        Object.values(process.subGraphs || {}).forEach(stripGraphUiState);
    });
    portfolio.schemaVersion = CURRENT_PORTFOLIO_SCHEMA_VERSION;
    const validation = PortfolioSchema.safeParse(portfolio);
    if (!validation.success) {
        throw new PortfolioCodecError(
            'Cannot persist an invalid portfolio.',
            'INVALID_PORTFOLIO',
            validation.error.issues,
        );
    }
    return validation.data as unknown as Portfolio;
}

export interface CreateEnvelopeOptions {
    kind?: AxiomDocumentKind;
    sourceId?: string;
    timestamp?: string;
}

export function createPortfolioEnvelope(
    input: Portfolio,
    options: CreateEnvelopeOptions = {},
): AxiomEnvelope {
    const kind = options.kind || 'portfolio';
    assertPortfolioIntegrity(input);
    return {
        format: AXIOM_FORMAT_ID,
        kind,
        schemaVersion: CURRENT_PORTFOLIO_SCHEMA_VERSION,
        version: '1.0.0',
        appVersion: APP_VERSION,
        timestamp: options.timestamp || new Date().toISOString(),
        ...(kind === 'process-fragment' ? { type: 'partial' as const } : {}),
        ...(options.sourceId ? { sourceId: options.sourceId } : {}),
        data: preparePortfolioForPersistence(input),
    };
}

export function serializePortfolioEnvelope(
    input: Portfolio,
    options: CreateEnvelopeOptions & { pretty?: boolean } = {},
): string {
    return JSON.stringify(createPortfolioEnvelope(input, options), null, options.pretty === false ? 0 : 2);
}
