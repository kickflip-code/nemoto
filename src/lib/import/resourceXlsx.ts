import JSZip, { type JSZipObject } from 'jszip';
import {
    RESOURCE_IMPORT_LIMITS,
    ResourceImportError,
    createResourceImportSheet,
    type ResourceImportSource,
    type ResourceImportValue,
} from './resourceImport';

export const RESOURCE_XLSX_LIMITS = {
    maxEntries: 2_000,
    maxExpandedBytes: 200 * 1024 * 1024,
    maxXmlEntryBytes: 50 * 1024 * 1024,
} as const;

type SizedZipObject = JSZipObject & {
    unsafeOriginalName?: string;
    _data?: { uncompressedSize?: number };
};

const parserError = (document: XMLDocument): Element | null => (
    document.getElementsByTagName('parsererror')[0] || null
);

const parseXml = (text: string, label: string): XMLDocument => {
    const document = new DOMParser().parseFromString(text, 'application/xml');
    if (parserError(document)) {
        throw new ResourceImportError(`${label} contains invalid XML.`, 'INVALID_DELIMITED_TEXT');
    }
    return document;
};

const elements = (root: Document | Element, localName: string): Element[] => (
    Array.from(root.getElementsByTagNameNS('*', localName))
);

function validateArchive(entries: readonly SizedZipObject[]): void {
    const files = entries.filter(entry => !entry.dir);
    if (files.length > RESOURCE_XLSX_LIMITS.maxEntries) {
        throw new ResourceImportError('The workbook contains too many archive entries.', 'IMPORT_LIMIT_EXCEEDED');
    }
    let expandedBytes = 0;
    files.forEach(entry => {
        const normalized = (entry.unsafeOriginalName || entry.name).replace(/\\/g, '/');
        if (normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.split('/').includes('..')) {
            throw new ResourceImportError('The workbook contains an unsafe archive path.', 'INVALID_DELIMITED_TEXT');
        }
        const size = entry._data?.uncompressedSize;
        if (size === undefined) return;
        if (!Number.isSafeInteger(size) || size < 0) {
            throw new ResourceImportError('The workbook contains invalid archive metadata.', 'INVALID_DELIMITED_TEXT');
        }
        if (entry.name.toLocaleLowerCase().endsWith('.xml') && size > RESOURCE_XLSX_LIMITS.maxXmlEntryBytes) {
            throw new ResourceImportError('A workbook XML entry is larger than 50 MB.', 'IMPORT_LIMIT_EXCEEDED');
        }
        expandedBytes += size;
        if (expandedBytes > RESOURCE_XLSX_LIMITS.maxExpandedBytes) {
            throw new ResourceImportError('The workbook expands beyond the 200 MB safety limit.', 'IMPORT_LIMIT_EXCEEDED');
        }
    });
}

async function readXml(zip: JSZip, path: string, required = true): Promise<string | undefined> {
    const entry = zip.file(path);
    if (!entry) {
        if (required) throw new ResourceImportError(`The workbook is missing ${path}.`, 'INVALID_DELIMITED_TEXT');
        return undefined;
    }
    const text = await entry.async('string');
    if (text.length > RESOURCE_XLSX_LIMITS.maxXmlEntryBytes) {
        throw new ResourceImportError('A workbook XML entry is larger than 50 MB.', 'IMPORT_LIMIT_EXCEEDED');
    }
    return text;
}

const normalizeZipPath = (base: string, target: string): string => {
    const parts = target.startsWith('/') ? [] : base.split('/').filter(Boolean);
    target.replace(/\\/g, '/').split('/').forEach(part => {
        if (!part || part === '.') return;
        if (part === '..') {
            if (parts.length === 0) {
                throw new ResourceImportError('The workbook contains an unsafe relationship path.', 'INVALID_DELIMITED_TEXT');
            }
            parts.pop();
        } else {
            parts.push(part);
        }
    });
    return parts.join('/');
};

const cellColumnIndex = (reference: string): number => {
    const letters = reference.match(/^[A-Za-z]+/)?.[0].toUpperCase() || '';
    let result = 0;
    for (const letter of letters) result = (result * 26) + letter.charCodeAt(0) - 64;
    return Math.max(0, result - 1);
};

const textContent = (element: Element): string => (
    elements(element, 't').map(node => node.textContent || '').join('')
);

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function parseDateStyles(stylesXml: string | undefined): Set<number> {
    if (!stylesXml) return new Set();
    const document = parseXml(stylesXml, 'Workbook styles');
    const customFormats = new Map<number, string>();
    elements(document, 'numFmt').forEach(format => {
        const id = Number(format.getAttribute('numFmtId'));
        const code = format.getAttribute('formatCode');
        if (Number.isInteger(id) && code) customFormats.set(id, code);
    });
    const cellFormats = elements(document, 'cellXfs')[0];
    if (!cellFormats) return new Set();
    const result = new Set<number>();
    Array.from(cellFormats.children).forEach((format, index) => {
        const id = Number(format.getAttribute('numFmtId'));
        const custom = customFormats.get(id)?.replace(/"[^"]*"|\\./g, '');
        if (BUILTIN_DATE_FORMATS.has(id) || (custom && /[ymdhis]/i.test(custom))) result.add(index);
    });
    return result;
}

const excelDate = (serial: number): string => {
    const milliseconds = Math.round((serial - 25569) * 86_400_000);
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) return String(serial);
    const iso = date.toISOString();
    return serial % 1 === 0 ? iso.slice(0, 10) : iso;
};

function parseWorksheet(
    xml: string,
    sharedStrings: readonly string[],
    dateStyles: ReadonlySet<number>,
): ResourceImportValue[][] {
    const document = parseXml(xml, 'Workbook sheet');
    const rows: ResourceImportValue[][] = [];
    for (const rowElement of elements(document, 'row')) {
        const row: ResourceImportValue[] = [];
        for (const cell of Array.from(rowElement.children).filter(child => child.localName === 'c')) {
            const columnIndex = cellColumnIndex(cell.getAttribute('r') || '');
            if (columnIndex >= RESOURCE_IMPORT_LIMITS.maxColumns) {
                throw new ResourceImportError('The workbook contains more than 250 columns.', 'IMPORT_LIMIT_EXCEEDED');
            }
            const type = cell.getAttribute('t') || '';
            const raw = elements(cell, 'v')[0]?.textContent ?? '';
            let value: ResourceImportValue = null;
            if (type === 's') value = sharedStrings[Number(raw)] ?? '';
            else if (type === 'inlineStr') value = textContent(cell);
            else if (type === 'b') value = raw === '1';
            else if (type === 'str' || type === 'e') value = raw;
            else if (raw !== '') {
                const numeric = Number(raw);
                const styleIndex = Number(cell.getAttribute('s'));
                value = Number.isFinite(numeric)
                    ? (dateStyles.has(styleIndex) ? excelDate(numeric) : numeric)
                    : raw;
            }
            if (typeof value === 'string' && value.length > RESOURCE_IMPORT_LIMITS.maxCellCharacters) {
                throw new ResourceImportError('A workbook cell contains more than 50,000 characters.', 'IMPORT_LIMIT_EXCEEDED');
            }
            row[columnIndex] = value;
        }
        rows.push(row);
        if (rows.length > RESOURCE_IMPORT_LIMITS.maxRows + 1) {
            throw new ResourceImportError('The workbook contains more than 50,000 data rows.', 'IMPORT_LIMIT_EXCEEDED');
        }
    }
    return rows;
}

export async function parseResourceWorkbook(file: File): Promise<ResourceImportSource> {
    if (file.size > RESOURCE_IMPORT_LIMITS.maxSourceBytes) {
        throw new ResourceImportError('The workbook is larger than 50 MB.', 'IMPORT_LIMIT_EXCEEDED');
    }
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(file);
    } catch {
        throw new ResourceImportError('The Excel workbook could not be opened.', 'INVALID_DELIMITED_TEXT');
    }
    validateArchive(Object.values(zip.files) as SizedZipObject[]);

    const workbookXml = await readXml(zip, 'xl/workbook.xml');
    const relationshipsXml = await readXml(zip, 'xl/_rels/workbook.xml.rels');
    const sharedStringsXml = await readXml(zip, 'xl/sharedStrings.xml', false);
    const stylesXml = await readXml(zip, 'xl/styles.xml', false);
    const workbook = parseXml(workbookXml!, 'Workbook');
    const relationships = parseXml(relationshipsXml!, 'Workbook relationships');
    const relationshipTargets = new Map<string, string>();
    elements(relationships, 'Relationship').forEach(relationship => {
        const id = relationship.getAttribute('Id');
        const target = relationship.getAttribute('Target');
        if (id && target) relationshipTargets.set(id, normalizeZipPath('xl', target));
    });
    const sharedStrings = sharedStringsXml
        ? elements(parseXml(sharedStringsXml, 'Shared strings'), 'si').map(textContent)
        : [];
    const dateStyles = parseDateStyles(stylesXml);
    const sheets = [];

    for (const [index, sheet] of elements(workbook, 'sheet').entries()) {
        const state = sheet.getAttribute('state');
        if (state === 'hidden' || state === 'veryHidden') continue;
        const relationshipId = sheet.getAttribute('r:id')
            || Array.from(sheet.attributes).find(attribute => attribute.localName === 'id')?.value;
        const path = relationshipId ? relationshipTargets.get(relationshipId) : undefined;
        if (!path) continue;
        const sheetXml = await readXml(zip, path);
        const rawRows = parseWorksheet(sheetXml!, sharedStrings, dateStyles);
        try {
            sheets.push(createResourceImportSheet(
                sheet.getAttribute('name') || `Sheet ${index + 1}`,
                rawRows,
                `sheet-${index + 1}`,
            ));
        } catch (error) {
            if (!(error instanceof ResourceImportError) || error.code !== 'EMPTY_SOURCE') throw error;
        }
    }
    if (sheets.length === 0) {
        throw new ResourceImportError('The workbook contains no importable worksheets.', 'EMPTY_SOURCE');
    }
    return { name: file.name, format: 'xlsx', sheets, warnings: [] };
}
