import { describe, expect, it } from 'vitest';
import type { Portfolio } from '../../types';
import {
    ResourceImportError,
    buildResourceImportPlan,
    createDefaultResourceMapping,
    detectDelimiter,
    parseDelimitedResourceText,
    parseJsonResourceText,
    suggestResourceNameColumn,
} from './resourceImport';

const portfolio = (): Pick<Portfolio, 'assets' | 'assetCategories'> => ({
    assets: [{ id: 'asset-existing', name: 'Router', type: 'hardware' }],
    assetCategories: [{ id: 'hardware', label: 'Hardware', icon: 'Box', color: 'blue' }],
});

describe('resource import parsing', () => {
    it('detects common delimiters and parses quoted CSV values', () => {
        const text = 'Resource name;Owner;Description\r\nRouter;IT;"Core; network"\r\nLaptop;Support;Portable';
        expect(detectDelimiter(text)).toBe(';');

        const source = parseDelimitedResourceText(text, { name: 'resources.csv' });
        expect(source.format).toBe('csv');
        expect(source.sheets[0]).toMatchObject({
            headers: ['Resource name', 'Owner', 'Description'],
            rows: [
                ['Router', 'IT', 'Core; network'],
                ['Laptop', 'Support', 'Portable'],
            ],
        });
    });

    it('turns flat and nested JSON resource records into one table', () => {
        const source = parseJsonResourceText(JSON.stringify({
            resources: [
                { name: 'Router', details: { owner: 'IT' }, active: true },
                { name: 'Laptop', details: { owner: 'Support' }, active: false },
            ],
        }), 'resources.json');

        expect(source.sheets[0].headers).toEqual(['name', 'details.owner', 'active']);
        expect(source.sheets[0].rows[1]).toEqual(['Laptop', 'Support', false]);
        expect(suggestResourceNameColumn(source.sheets[0].headers)).toBe(0);
    });

    it('does not mistake an Axiom document for resource JSON', () => {
        try {
            parseJsonResourceText(JSON.stringify({
                format: 'axiom',
                data: { assets: [] },
            }));
            throw new Error('Expected resource JSON parsing to fail.');
        } catch (error) {
            expect(error).toBeInstanceOf(ResourceImportError);
            expect((error as ResourceImportError).code).toBe('NOT_RESOURCE_JSON');
        }
    });
});

describe('resource import planning', () => {
    it('creates typed resources, skips blank names and safely ignores duplicates', () => {
        const source = parseDelimitedResourceText([
            'Resource name,Cost,Active,Purchase date',
            'Router,100,true,2026-08-20',
            'Laptop,249.50,false,2026-08-21',
            ',10,true,2026-08-22',
        ].join('\n'));
        const mapping = createDefaultResourceMapping(source.sheets[0], 'hardware');
        let nextId = 0;
        const plan = buildResourceImportPlan(
            source.sheets[0],
            mapping,
            portfolio(),
            () => `asset-${nextId += 1}`,
        );

        expect(plan).toMatchObject({ totalRows: 3, emptyNameRows: 1, duplicateRows: 1, invalidValues: 0 });
        expect(plan.assets).toEqual([{
            id: 'asset-1',
            name: 'Laptop',
            type: 'hardware',
            metadata: {
                Cost: 249.5,
                Active: false,
                'Purchase date': '2026-08-21',
            },
        }]);
    });

    it('requires a real category and unique property names before creating a plan', () => {
        const source = parseDelimitedResourceText('Name,Owner,Location\nLaptop,IT,Stockholm');
        const mapping = createDefaultResourceMapping(source.sheets[0]);
        try {
            buildResourceImportPlan(source.sheets[0], mapping, portfolio());
            throw new Error('Expected resource import planning to fail.');
        } catch (error) {
            expect(error).toBeInstanceOf(ResourceImportError);
            expect((error as ResourceImportError).code).toBe('INVALID_MAPPING');
        }

        mapping.categoryId = 'hardware';
        mapping.properties[1].propertyName = 'Place';
        mapping.properties[2].propertyName = 'place';
        expect(() => buildResourceImportPlan(source.sheets[0], mapping, portfolio()))
            .toThrow(/unique/i);
    });
});
