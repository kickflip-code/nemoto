import { describe, expect, it } from 'vitest';
import {
    compareSemanticVersions,
    isValidVersionRange,
    parseSemanticVersion,
    satisfiesVersionRange,
} from './versionRange';

describe('plugin version ranges', () => {
    it('supports the bounded API ranges used by plugin manifests', () => {
        expect(satisfiesVersionRange('1.0.0', '>=1 <2')).toBe(true);
        expect(satisfiesVersionRange('2.0.0', '>=1 <2')).toBe(false);
        expect(satisfiesVersionRange('0.9.9', '>=1 <2')).toBe(false);
    });

    it('supports exact, partial, caret, tilde, and alternative ranges', () => {
        expect(satisfiesVersionRange('1.2.3', '1.2.3')).toBe(true);
        expect(satisfiesVersionRange('1.5.0', '1')).toBe(true);
        expect(satisfiesVersionRange('1.2.9', '1.2')).toBe(true);
        expect(satisfiesVersionRange('1.9.0', '^1.2.3')).toBe(true);
        expect(satisfiesVersionRange('2.0.0', '^1.2.3')).toBe(false);
        expect(satisfiesVersionRange('1.2.9', '~1.2.3')).toBe(true);
        expect(satisfiesVersionRange('1.3.0', '~1.2.3')).toBe(false);
        expect(satisfiesVersionRange('3.0.0', '<1 || >=3')).toBe(true);
    });

    it('orders prerelease versions before releases', () => {
        const prerelease = parseSemanticVersion('1.0.0-alpha.2');
        const release = parseSemanticVersion('1.0.0');

        expect(prerelease).not.toBeNull();
        expect(release).not.toBeNull();
        expect(compareSemanticVersions(prerelease!, release!)).toBeLessThan(0);
    });

    it('rejects unsupported or malformed ranges', () => {
        expect(isValidVersionRange('>=1 nonsense')).toBe(false);
        expect(isValidVersionRange('')).toBe(false);
        expect(isValidVersionRange('>=1 ||')).toBe(false);
        expect(satisfiesVersionRange('not-a-version', '>=1')).toBe(false);
    });
});
