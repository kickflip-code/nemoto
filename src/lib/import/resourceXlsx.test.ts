import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseResourceWorkbook } from './resourceXlsx';

async function workbookFile(): Promise<File> {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', `<?xml version="1.0"?>
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <sheets><sheet name="Resources" sheetId="1" r:id="rId1" /></sheets>
        </workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Target="worksheets/sheet1.xml" />
        </Relationships>`);
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?>
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
          <row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Cost</t></is></c></row>
          <row r="2"><c r="A2" t="inlineStr"><is><t>Laptop</t></is></c><c r="B2"><v>249.5</v></c></row>
        </sheetData></worksheet>`);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    return new File([bytes], 'resources.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
}

describe('resource XLSX parsing', () => {
    it('reads visible workbook sheets without evaluating formulas or macros', async () => {
        const source = await parseResourceWorkbook(await workbookFile());

        expect(source).toMatchObject({ name: 'resources.xlsx', format: 'xlsx' });
        expect(source.sheets[0]).toMatchObject({
            name: 'Resources',
            headers: ['Name', 'Cost'],
            rows: [['Laptop', 249.5]],
        });
    });

    it('resolves shared strings and converts Excel date cells to portable dates', async () => {
        const zip = new JSZip();
        const serial = Math.floor(Date.UTC(2026, 7, 20) / 86_400_000) + 25569;
        zip.file('xl/workbook.xml', `<?xml version="1.0"?>
            <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
              <sheets><sheet name="Inventory" sheetId="1" r:id="rId1" /></sheets>
            </workbook>`);
        zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?>
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
              <Relationship Id="rId1" Target="worksheets/sheet1.xml" />
            </Relationships>`);
        zip.file('xl/sharedStrings.xml', `<?xml version="1.0"?>
            <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
              <si><t>Name</t></si><si><t>Purchase date</t></si><si><t>Router</t></si>
            </sst>`);
        zip.file('xl/styles.xml', `<?xml version="1.0"?>
            <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
              <cellXfs count="2"><xf numFmtId="0" /><xf numFmtId="14" /></cellXfs>
            </styleSheet>`);
        zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?>
            <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
              <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
              <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>${serial}</v></c></row>
            </sheetData></worksheet>`);
        const bytes = await zip.generateAsync({ type: 'uint8array' });
        const file = new File([bytes], 'inventory.xlsx');

        const source = await parseResourceWorkbook(file);

        expect(source.sheets[0].rows).toEqual([['Router', '2026-08-20']]);
    });
});
