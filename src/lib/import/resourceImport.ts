import type { Asset, Portfolio } from '../../types';
import { generateId } from '../id';

export const RESOURCE_IMPORT_LIMITS = {
    maxSourceBytes: 50 * 1024 * 1024,
    maxRows: 50_000,
    maxColumns: 250,
    maxCellCharacters: 50_000,
} as const;

export type ResourceImportFormat = 'csv' | 'tsv' | 'xlsx' | 'json' | 'clipboard';
export type ResourceImportValue = string | number | boolean | null;
export type ResourcePropertyValueType = 'auto' | 'text' | 'number' | 'boolean' | 'date';
export type ResourceDuplicateStrategy = 'skip' | 'create';

export interface ResourceImportSheet {
    id: string;
    name: string;
    headers: string[];
    rows: ResourceImportValue[][];
}

export interface ResourceImportSource {
    name: string;
    format: ResourceImportFormat;
    sheets: ResourceImportSheet[];
    warnings: string[];
}

export interface ResourcePropertyMapping {
    columnIndex: number;
    enabled: boolean;
    propertyName: string;
    valueType: ResourcePropertyValueType;
}

export interface ResourceImportMapping {
    nameColumnIndex: number;
    categoryId: string;
    properties: ResourcePropertyMapping[];
    duplicateStrategy: ResourceDuplicateStrategy;
}

export interface ResourceImportPlan {
    assets: Asset[];
    totalRows: number;
    emptyNameRows: number;
    duplicateRows: number;
    invalidValues: number;
}

export type ResourceImportErrorCode =
    | 'INVALID_DELIMITED_TEXT'
    | 'INVALID_JSON'
    | 'NOT_RESOURCE_JSON'
    | 'EMPTY_SOURCE'
    | 'IMPORT_LIMIT_EXCEEDED'
    | 'INVALID_MAPPING';

export class ResourceImportError extends Error {
    constructor(message: string, readonly code: ResourceImportErrorCode) {
        super(message);
        this.name = 'ResourceImportError';
    }
}

const UNSAFE_PROPERTY_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const assertCellLength = (value: string): void => {
    if (value.length > RESOURCE_IMPORT_LIMITS.maxCellCharacters) {
        throw new ResourceImportError(
            'A cell contains more than 50,000 characters.',
            'IMPORT_LIMIT_EXCEEDED',
        );
    }
};

function parseDelimitedRows(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;

    const pushCell = () => {
        assertCellLength(cell);
        row.push(cell);
        cell = '';
        if (row.length > RESOURCE_IMPORT_LIMITS.maxColumns) {
            throw new ResourceImportError(
                'The source contains more than 250 columns.',
                'IMPORT_LIMIT_EXCEEDED',
            );
        }
    };
    const pushRow = () => {
        pushCell();
        rows.push(row);
        row = [];
        if (rows.length > RESOURCE_IMPORT_LIMITS.maxRows + 1) {
            throw new ResourceImportError(
                'The source contains more than 50,000 data rows.',
                'IMPORT_LIMIT_EXCEEDED',
            );
        }
    };

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (quoted) {
            if (character === '"') {
                if (text[index + 1] === '"') {
                    cell += '"';
                    index += 1;
                } else {
                    quoted = false;
                }
            } else {
                cell += character;
            }
            continue;
        }

        if (character === '"' && cell.length === 0) {
            quoted = true;
        } else if (character === delimiter) {
            pushCell();
        } else if (character === '\n') {
            pushRow();
        } else if (character !== '\r') {
            cell += character;
        }
    }

    if (quoted) {
        throw new ResourceImportError('The source contains an unclosed quoted value.', 'INVALID_DELIMITED_TEXT');
    }
    if (cell.length > 0 || row.length > 0) pushRow();
    return rows;
}

const delimiterScore = (text: string, delimiter: string): number => {
    try {
        const rows = parseDelimitedRows(text.slice(0, 24_000), delimiter)
            .filter(row => row.some(value => value.trim().length > 0))
            .slice(0, 12);
        if (rows.length === 0) return 0;
        const widths = rows.map(row => row.length);
        const mostCommonWidth = widths.reduce((best, width) => (
            widths.filter(candidate => candidate === width).length
                > widths.filter(candidate => candidate === best).length ? width : best
        ), widths[0]);
        const consistentRows = widths.filter(width => width === mostCommonWidth).length;
        return mostCommonWidth > 1 ? (mostCommonWidth * 10) + consistentRows : 0;
    } catch {
        return 0;
    }
};

export function detectDelimiter(text: string): ',' | ';' | '\t' {
    const candidates = [',', ';', '\t'] as const;
    return candidates.reduce((best, candidate) => (
        delimiterScore(text, candidate) > delimiterScore(text, best) ? candidate : best
    ), candidates[0]);
}

function normalizedHeaders(values: readonly ResourceImportValue[]): string[] {
    const occurrences = new Map<string, number>();
    return values.map((value, index) => {
        const requested = value === null ? '' : String(value).trim();
        const base = requested || `Column ${index + 1}`;
        const key = base.toLocaleLowerCase();
        const occurrence = (occurrences.get(key) || 0) + 1;
        occurrences.set(key, occurrence);
        return occurrence === 1 ? base : `${base} (${occurrence})`;
    });
}

export function createResourceImportSheet(
    name: string,
    rawRows: readonly (readonly ResourceImportValue[])[],
    id = 'sheet-1',
): ResourceImportSheet {
    const nonEmptyRows = rawRows.filter(row => row.some(value => (
        value !== null && String(value).trim().length > 0
    )));
    if (nonEmptyRows.length < 2) {
        throw new ResourceImportError(
            'The source needs a header row and at least one data row.',
            'EMPTY_SOURCE',
        );
    }
    const width = Math.max(...nonEmptyRows.map(row => row.length));
    if (width > RESOURCE_IMPORT_LIMITS.maxColumns) {
        throw new ResourceImportError('The source contains more than 250 columns.', 'IMPORT_LIMIT_EXCEEDED');
    }
    const headers = normalizedHeaders(Array.from({ length: width }, (_, index) => nonEmptyRows[0][index] ?? null));
    const rows = nonEmptyRows.slice(1).map(row => (
        Array.from({ length: width }, (_, index) => row[index] ?? null)
    ));
    if (rows.length > RESOURCE_IMPORT_LIMITS.maxRows) {
        throw new ResourceImportError('The source contains more than 50,000 data rows.', 'IMPORT_LIMIT_EXCEEDED');
    }
    return { id, name, headers, rows };
}

export function parseDelimitedResourceText(
    text: string,
    options: { name?: string; delimiter?: ',' | ';' | '\t'; format?: 'csv' | 'tsv' | 'clipboard' } = {},
): ResourceImportSource {
    const cleaned = text.replace(/^\uFEFF/, '');
    const delimiter = options.delimiter || detectDelimiter(cleaned);
    const format = options.format || (delimiter === '\t' ? 'tsv' : 'csv');
    const sourceName = options.name || (format === 'clipboard' ? 'Pasted table' : 'Imported table');
    const rawRows = parseDelimitedRows(cleaned, delimiter);
    return {
        name: sourceName,
        format,
        sheets: [createResourceImportSheet('Table', rawRows)],
        warnings: [],
    };
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

function flattenJsonRecord(
    source: Record<string, unknown>,
    target: Record<string, ResourceImportValue>,
    prefix = '',
    depth = 0,
): void {
    Object.entries(source).forEach(([key, value]) => {
        if (UNSAFE_PROPERTY_KEYS.has(key)) return;
        const path = prefix ? `${prefix}.${key}` : key;
        if (isPlainRecord(value) && depth < 5) {
            flattenJsonRecord(value, target, path, depth + 1);
            return;
        }
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            if (typeof value === 'string') assertCellLength(value);
            target[path] = value;
            return;
        }
        if (Array.isArray(value) || isPlainRecord(value)) {
            const serialized = JSON.stringify(value);
            assertCellLength(serialized);
            target[path] = serialized;
        }
    });
}

export function parseJsonResourceText(text: string, name = 'Imported JSON'): ResourceImportSource {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
        throw new ResourceImportError('The JSON file could not be read.', 'INVALID_JSON');
    }

    const records = Array.isArray(parsed)
        ? parsed
        : isPlainRecord(parsed) && Array.isArray(parsed.resources)
            ? parsed.resources
            : undefined;
    if (!records || !records.every(isPlainRecord)) {
        throw new ResourceImportError(
            'Resource JSON must contain an array of objects, either directly or under “resources”.',
            'NOT_RESOURCE_JSON',
        );
    }
    if (records.length > RESOURCE_IMPORT_LIMITS.maxRows) {
        throw new ResourceImportError('The source contains more than 50,000 data rows.', 'IMPORT_LIMIT_EXCEEDED');
    }
    if (records.length === 0) {
        throw new ResourceImportError('The JSON file contains no resources.', 'EMPTY_SOURCE');
    }

    const flattened = records.map(record => {
        const result: Record<string, ResourceImportValue> = Object.create(null);
        flattenJsonRecord(record, result);
        return result;
    });
    const headers: string[] = [];
    const seen = new Set<string>();
    flattened.forEach(record => Object.keys(record).forEach(key => {
        if (!seen.has(key)) {
            seen.add(key);
            headers.push(key);
        }
    }));
    if (headers.length === 0) {
        throw new ResourceImportError('The JSON resources contain no importable values.', 'EMPTY_SOURCE');
    }
    if (headers.length > RESOURCE_IMPORT_LIMITS.maxColumns) {
        throw new ResourceImportError('The source contains more than 250 properties.', 'IMPORT_LIMIT_EXCEEDED');
    }

    return {
        name,
        format: 'json',
        sheets: [{
            id: 'json-resources',
            name: 'Resources',
            headers,
            rows: flattened.map(record => headers.map(header => record[header] ?? null)),
        }],
        warnings: [],
    };
}

const normalizedHeader = (header: string): string => header.trim().toLocaleLowerCase().replace(/[\s_-]+/g, ' ');

export function suggestResourceNameColumn(headers: readonly string[]): number {
    const preferred = ['resource name', 'asset name', 'name', 'resource', 'asset', 'title'];
    for (const candidate of preferred) {
        const index = headers.findIndex(header => normalizedHeader(header) === candidate);
        if (index >= 0) return index;
    }
    return 0;
}

const booleanValue = (value: ResourceImportValue): boolean | undefined => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
        return undefined;
    }
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLocaleLowerCase();
    if (['true', 'yes', 'y', 'ja', '1'].includes(normalized)) return true;
    if (['false', 'no', 'n', 'nej', '0'].includes(normalized)) return false;
    return undefined;
};

const numberValue = (value: ResourceImportValue): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().replace(',', '.');
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const dateValue = (value: ResourceImportValue): string | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
        ? value.trim()
        : parsed.toISOString();
};

export function inferResourcePropertyType(
    sheet: ResourceImportSheet,
    columnIndex: number,
): Exclude<ResourcePropertyValueType, 'auto'> {
    const values = sheet.rows
        .map(row => row[columnIndex] ?? null)
        .filter(value => value !== null && String(value).trim().length > 0)
        .slice(0, 250);
    if (values.length === 0) return 'text';
    if (values.every(value => booleanValue(value) !== undefined)) return 'boolean';
    if (values.every(value => numberValue(value) !== undefined)) return 'number';
    const header = normalizedHeader(sheet.headers[columnIndex] || '');
    if (/(^| )(date|time|created|updated|expires|expiry)( |$)/.test(header)
        && values.every(value => dateValue(value) !== undefined)) return 'date';
    return 'text';
}

export function createDefaultResourceMapping(
    sheet: ResourceImportSheet,
    categoryId = '',
): ResourceImportMapping {
    const nameColumnIndex = suggestResourceNameColumn(sheet.headers);
    return {
        nameColumnIndex,
        categoryId,
        duplicateStrategy: 'skip',
        properties: sheet.headers.map((header, columnIndex) => ({
            columnIndex,
            enabled: columnIndex !== nameColumnIndex,
            propertyName: header,
            valueType: inferResourcePropertyType(sheet, columnIndex),
        })),
    };
}

const convertPropertyValue = (
    value: ResourceImportValue,
    type: ResourcePropertyValueType,
    inferredType: Exclude<ResourcePropertyValueType, 'auto'>,
): ResourceImportValue | undefined => {
    if (value === null || String(value).trim().length === 0) return undefined;
    const effectiveType = type === 'auto' ? inferredType : type;
    if (effectiveType === 'text') return String(value);
    if (effectiveType === 'number') return numberValue(value);
    if (effectiveType === 'boolean') return booleanValue(value);
    return dateValue(value);
};

const duplicateKey = (name: string, categoryId: string): string => (
    `${categoryId}\u0000${name.trim().toLocaleLowerCase()}`
);

export function buildResourceImportPlan(
    sheet: ResourceImportSheet,
    mapping: ResourceImportMapping,
    portfolio: Pick<Portfolio, 'assets' | 'assetCategories'>,
    createId: () => string = () => generateId('asset'),
): ResourceImportPlan {
    if (!sheet.headers[mapping.nameColumnIndex]) {
        throw new ResourceImportError('Choose the column that contains resource names.', 'INVALID_MAPPING');
    }
    if (!portfolio.assetCategories.some(category => category.id === mapping.categoryId)) {
        throw new ResourceImportError('Choose a valid resource category.', 'INVALID_MAPPING');
    }
    const enabledProperties = mapping.properties.filter(property => (
        property.enabled && property.columnIndex !== mapping.nameColumnIndex
    ));
    const propertyNames = new Set<string>();
    enabledProperties.forEach(property => {
        const name = property.propertyName.trim();
        const key = name.toLocaleLowerCase();
        if (!name || UNSAFE_PROPERTY_KEYS.has(key) || propertyNames.has(key)) {
            throw new ResourceImportError('Property names must be unique and cannot be empty.', 'INVALID_MAPPING');
        }
        propertyNames.add(key);
    });

    const seen = new Set(portfolio.assets.map(asset => duplicateKey(asset.name, asset.type)));
    const ids = new Set(portfolio.assets.map(asset => asset.id));
    const preparedProperties = enabledProperties.map(property => ({
        ...property,
        inferredType: inferResourcePropertyType(sheet, property.columnIndex),
    }));
    const assets: Asset[] = [];
    let emptyNameRows = 0;
    let duplicateRows = 0;
    let invalidValues = 0;

    sheet.rows.forEach(row => {
        const rawName = row[mapping.nameColumnIndex];
        const name = rawName === null || rawName === undefined ? '' : String(rawName).trim();
        if (!name) {
            emptyNameRows += 1;
            return;
        }
        const key = duplicateKey(name, mapping.categoryId);
        if (mapping.duplicateStrategy === 'skip' && seen.has(key)) {
            duplicateRows += 1;
            return;
        }

        let id = createId();
        while (ids.has(id)) id = createId();
        ids.add(id);
        seen.add(key);
        const metadata: Record<string, ResourceImportValue> = Object.create(null);
        preparedProperties.forEach(property => {
            const rawValue = row[property.columnIndex] ?? null;
            const converted = convertPropertyValue(rawValue, property.valueType, property.inferredType);
            if (converted === undefined) {
                if (rawValue !== null && String(rawValue).trim().length > 0) invalidValues += 1;
                return;
            }
            metadata[property.propertyName.trim()] = converted;
        });
        assets.push({
            id,
            name,
            type: mapping.categoryId,
            ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        });
    });

    return {
        assets,
        totalRows: sheet.rows.length,
        emptyNameRows,
        duplicateRows,
        invalidValues,
    };
}
