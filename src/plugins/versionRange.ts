export interface SemanticVersion {
    major: number;
    minor: number;
    patch: number;
    prerelease: Array<string | number>;
}

interface PartialVersion extends SemanticVersion {
    precision: 1 | 2 | 3;
}

type Comparator = (version: SemanticVersion) => boolean;

const FULL_VERSION_PATTERN = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PARTIAL_VERSION_PATTERN = /^(?:v)?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const CONSTRAINT_PATTERN = /^(>=|<=|>|<|=|\^|~)?(.+)$/;

const parsePrerelease = (value: string | undefined): Array<string | number> => {
    if (!value) return [];
    return value.split('.').map(identifier => (
        /^(0|[1-9]\d*)$/.test(identifier) ? Number(identifier) : identifier
    ));
};

export function parseSemanticVersion(value: string): SemanticVersion | null {
    const match = FULL_VERSION_PATTERN.exec(value.trim());
    if (!match) return null;

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: parsePrerelease(match[4]),
    };
}

const parsePartialVersion = (value: string): PartialVersion | null => {
    const match = PARTIAL_VERSION_PATTERN.exec(value.trim());
    if (!match) return null;

    const precision = match[3] !== undefined ? 3 : match[2] !== undefined ? 2 : 1;
    if (match[4] && precision !== 3) return null;

    return {
        major: Number(match[1]),
        minor: Number(match[2] || 0),
        patch: Number(match[3] || 0),
        prerelease: parsePrerelease(match[4]),
        precision,
    };
};

const comparePrerelease = (
    left: Array<string | number>,
    right: Array<string | number>,
): number => {
    if (left.length === 0 && right.length === 0) return 0;
    if (left.length === 0) return 1;
    if (right.length === 0) return -1;

    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = left[index];
        const rightPart = right[index];
        if (leftPart === undefined) return -1;
        if (rightPart === undefined) return 1;
        if (leftPart === rightPart) continue;

        if (typeof leftPart === 'number' && typeof rightPart === 'string') return -1;
        if (typeof leftPart === 'string' && typeof rightPart === 'number') return 1;
        return leftPart < rightPart ? -1 : 1;
    }
    return 0;
};

export function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
    if (left.major !== right.major) return left.major < right.major ? -1 : 1;
    if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
    if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
    return comparePrerelease(left.prerelease, right.prerelease);
}

const nextMajor = (version: PartialVersion): SemanticVersion => ({
    major: version.major + 1,
    minor: 0,
    patch: 0,
    prerelease: [],
});

const nextMinor = (version: PartialVersion): SemanticVersion => ({
    major: version.major,
    minor: version.minor + 1,
    patch: 0,
    prerelease: [],
});

const partialUpperBound = (version: PartialVersion): SemanticVersion => (
    version.precision === 1 ? nextMajor(version) : nextMinor(version)
);

const caretUpperBound = (version: PartialVersion): SemanticVersion => {
    if (version.major > 0) return nextMajor(version);
    if (version.minor > 0) return nextMinor(version);
    return {
        major: 0,
        minor: 0,
        patch: version.patch + 1,
        prerelease: [],
    };
};

const createComparator = (token: string): Comparator | null => {
    if (token === '*') return () => true;

    const constraint = CONSTRAINT_PATTERN.exec(token);
    if (!constraint) return null;

    const operator = constraint[1] || '';
    const target = parsePartialVersion(constraint[2]);
    if (!target) return null;

    const compare = (version: SemanticVersion): number => compareSemanticVersions(version, target);
    switch (operator) {
        case '>=': return version => compare(version) >= 0;
        case '<=': return version => compare(version) <= 0;
        case '>': return version => compare(version) > 0;
        case '<': return version => compare(version) < 0;
        case '=': return version => compare(version) === 0;
        case '^': {
            const upper = caretUpperBound(target);
            return version => compare(version) >= 0 && compareSemanticVersions(version, upper) < 0;
        }
        case '~': {
            const upper = partialUpperBound(target);
            return version => compare(version) >= 0 && compareSemanticVersions(version, upper) < 0;
        }
        default:
            if (target.precision === 3) return version => compare(version) === 0;
            {
                const upper = partialUpperBound(target);
                return version => compare(version) >= 0 && compareSemanticVersions(version, upper) < 0;
            }
    }
};

const parseRange = (range: string): Comparator[][] | null => {
    const alternatives = range.trim().split('||').map(part => part.trim());
    if (alternatives.some(part => !part)) return null;

    const parsed = alternatives.map(alternative => {
        const tokens = alternative.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return null;
        const comparators = tokens.map(createComparator);
        return comparators.some(comparator => comparator === null)
            ? null
            : comparators as Comparator[];
    });

    return parsed.some(alternative => alternative === null)
        ? null
        : parsed as Comparator[][];
};

export const isValidVersionRange = (range: string): boolean => parseRange(range) !== null;

export function satisfiesVersionRange(version: string, range: string): boolean {
    const parsedVersion = parseSemanticVersion(version);
    const alternatives = parseRange(range);
    if (!parsedVersion || !alternatives) return false;

    return alternatives.some(comparators => (
        comparators.every(comparator => comparator(parsedVersion))
    ));
}

/** True when every range alternative has an explicit lower bound at or above minimum. */
export function versionRangeExcludesVersionsBelow(range: string, minimum: string): boolean {
    const minimumVersion = parseSemanticVersion(minimum);
    if (!minimumVersion || !isValidVersionRange(range)) return false;
    return range.trim().split('||').every(alternative => (
        alternative.trim().split(/\s+/).some(token => {
            const constraint = CONSTRAINT_PATTERN.exec(token);
            if (!constraint) return false;
            const operator = constraint[1] || '';
            if (operator === '<' || operator === '<=' || token === '*') return false;
            const target = parsePartialVersion(constraint[2]);
            return Boolean(target && compareSemanticVersions(target, minimumVersion) >= 0);
        })
    ));
}
