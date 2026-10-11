import { z } from 'zod';
import type { Portfolio } from '../../types';
import { decodePortfolioJson, PortfolioCodecError } from '../portfolioCodec';
import type { AxiomDocumentKind } from '../portfolioCodec';
import type { MigrationReport } from './migrate';
import type { PortfolioIntegrityReport } from '../portfolioIntegrity';

export interface ValidationResult {
    success: boolean;
    data?: Portfolio;
    error?: string;
    issues?: z.ZodIssue[];
    kind?: AxiomDocumentKind;
    migration?: MigrationReport;
    integrity?: PortfolioIntegrityReport;
    sourceSchemaVersion?: number;
    sourceAppVersion?: string;
    sourceTimestamp?: string;
    wasWrapped?: boolean;
}

export const validateImport = async (jsonContent: string): Promise<ValidationResult> => {
    try {
        const decoded = decodePortfolioJson(jsonContent);
        return {
            success: true,
            data: decoded.portfolio,
            kind: decoded.kind,
            migration: decoded.migration,
            integrity: decoded.integrity,
            sourceSchemaVersion: decoded.sourceSchemaVersion,
            sourceAppVersion: decoded.sourceAppVersion,
            sourceTimestamp: decoded.sourceTimestamp,
            wasWrapped: decoded.wasWrapped,
        };
    } catch (e) {
        if (e instanceof PortfolioCodecError) {
            return {
                success: false,
                error: e.message,
                issues: e.issues,
            };
        }
        return {
            success: false,
            error: e instanceof Error ? e.message : 'Invalid JSON format'
        };
    }
};
