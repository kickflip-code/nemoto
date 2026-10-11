import { decodePortfolioValue, assertPortfolioIntegrity, PortfolioCodecError } from './portfolioCodec';
import { ProcessSchema } from './schemas';

const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

function rawProcesses(input: unknown): { data: Record<string, unknown>; processes: unknown[] } {
    if (!record(input) || !Array.isArray(input.processes)) {
        throw new Error('The active file must contain a readable portfolio and process list. Use a validated backup for damaged JSON or other file formats.');
    }
    return { data: input, processes: input.processes };
}

export function describeRepairError(error: unknown): string {
    if (error instanceof PortfolioCodecError && error.issues?.length) {
        return error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n');
    }
    return error instanceof Error ? error.message : String(error);
}

/** Raw data is inspected only in recovery, never passed to a canvas or a store. */
export function inspectRepairProcesses(input: unknown) {
    const { processes } = rawProcesses(input);
    return processes.map((process, index) => {
        const result = ProcessSchema.safeParse(process);
        return {
            index,
            title: record(process) && typeof process.title === 'string' ? process.title : `Process ${index + 1}`,
            description: record(process) && typeof process.description === 'string' ? process.description : '',
            issues: result.success ? [] : result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
            raw: process,
        };
    });
}

/** Remove only explicitly chosen entries. Other data and unresolved Journal links remain. */
export function prepareProcessRepair(input: unknown, removedIndexes: number[]) {
    const { data, processes } = rawProcesses(input);
    if (removedIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= processes.length)) {
        throw new Error('The process selection is no longer valid. Reload the process list.');
    }
    const removed = new Set(removedIndexes);
    const candidate = { ...data, processes: processes.filter((_, index) => !removed.has(index)) };
    const decoded = decodePortfolioValue(candidate);
    assertPortfolioIntegrity(decoded.portfolio);
    return { candidate, portfolio: decoded.portfolio, warnings: decoded.integrity.warnings };
}
