import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { inspectPortfolioIntegrity } from '../lib/portfolioIntegrity';
import {
    importVisioFile,
    importVisioPortfolio,
    validateVisioArchiveMetadata,
    validateVisioSourceFile,
    VISIO_IMPORT_LIMITS,
} from './VisioImportService';

async function zipAsVisioFile(zip: JSZip, name: string): Promise<File> {
    const blob = await zip.generateAsync({ type: 'blob' });
    return new File([blob], name, { type: 'application/vnd.ms-visio.drawing' });
}

describe('Visio import safety limits', () => {
    it('rejects oversized source files before parsing', () => {
        expect(() => validateVisioSourceFile({
            size: VISIO_IMPORT_LIMITS.maxSourceBytes + 1,
        })).toThrow('larger than 50 MB');
    });

    it('rejects unsafe archive paths', () => {
        expect(() => validateVisioArchiveMetadata([
            { name: '../outside.xml', uncompressedSize: 10 },
        ])).toThrow('unsafe archive path');
    });

    it('rejects oversized XML entries and expanded archives', () => {
        expect(() => validateVisioArchiveMetadata([
            { name: 'visio/pages/page1.xml', uncompressedSize: VISIO_IMPORT_LIMITS.maxXmlEntryBytes + 1 },
        ])).toThrow('larger than 20 MB');

        expect(() => validateVisioArchiveMetadata([
            { name: 'media/one.bin', uncompressedSize: VISIO_IMPORT_LIMITS.maxExpandedBytes },
            { name: 'media/two.bin', uncompressedSize: 1 },
        ])).toThrow('200 MB safety limit');
    });

    it('rejects archives with excessive entry counts', () => {
        const entries = Array.from({ length: VISIO_IMPORT_LIMITS.maxEntries + 1 }, (_, index) => ({
            name: `entry-${index}.bin`,
            uncompressedSize: 1,
        }));

        expect(() => validateVisioArchiveMetadata(entries)).toThrow('too many archive entries');
    });

    it('imports a minimal valid VSDX archive', async () => {
        const zip = new JSZip();
        zip.file('visio/masters/master1.xml', `
            <PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main">
                <Shapes><Shape ID="100" NameU="Process" /></Shapes>
            </PageContents>
        `);
        zip.file('visio/pages/page1.xml', `
            <PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main">
                <Shapes>
                    <Shape ID="1" NameU="Process" Master="1">
                        <Cell N="PinX" V="1" />
                        <Cell N="PinY" V="2" />
                        <Cell N="Width" V="1" />
                        <Cell N="Height" V="0.5" />
                        <Text>Review request</Text>
                    </Shape>
                </Shapes>
            </PageContents>
        `);
        const blob = await zip.generateAsync({ type: 'blob' });
        const file = new File([blob], 'minimal.vsdx', {
            type: 'application/vnd.ms-visio.drawing',
        });

        const graph = await importVisioFile(file);

        expect(graph.nodes).toHaveLength(1);
        expect(graph.nodes[0]).toMatchObject({
            id: 'visio-1',
            type: 'action',
            label: 'Review request',
        });
        expect(graph.edges).toEqual([]);
    });

    it('namespaces nodes, edges, and swimlanes across pages', async () => {
        const zip = new JSZip();
        zip.file('visio/pages/pages.xml', `
            <Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                <Page ID="1" Name="One"><Rel r:id="rId1" /></Page>
                <Page ID="2" Name="Two"><Rel r:id="rId2" /></Page>
            </Pages>
        `);
        zip.file('visio/pages/_rels/pages.xml.rels', `
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                <Relationship Id="rId1" Target="page1.xml" />
                <Relationship Id="rId2" Target="page2.xml" />
            </Relationships>
        `);
        const pageXml = (laneLabel: string) => `
            <PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main">
                <Shapes>
                    <Shape ID="1" NameU="Swimlane">
                        <Cell N="PinX" V="4" /><Cell N="PinY" V="2" />
                        <Cell N="Width" V="8" /><Cell N="Height" V="2" />
                        <Text>${laneLabel}</Text>
                    </Shape>
                    <Shape ID="2" NameU="Process">
                        <Cell N="PinX" V="2" /><Cell N="PinY" V="2" />
                        <Text>Work</Text>
                    </Shape>
                </Shapes>
            </PageContents>
        `;
        zip.file('visio/pages/page1.xml', pageXml('Lane A'));
        zip.file('visio/pages/page2.xml', pageXml('Lane B'));

        const portfolio = await importVisioPortfolio(await zipAsVisioFile(zip, 'lanes.vsdx'));
        const allIds = portfolio.processes.flatMap(process => [
            process.id,
            ...process.graph.nodes.map(node => node.id),
            ...process.graph.edges.map(edge => edge.id),
            ...process.graph.swimlanes.map(lane => lane.id),
        ]);

        expect(new Set(allIds).size).toBe(allIds.length);
        expect(inspectPortfolioIntegrity(portfolio).errors).toEqual([]);
    });

    it('keeps a connected process node named Ja instead of consuming it as an edge label', async () => {
        const zip = new JSZip();
        zip.file('visio/pages/page1.xml', `
            <PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main">
                <Shapes>
                    <Shape ID="1" NameU="Decision">
                        <Cell N="PinX" V="1" /><Cell N="PinY" V="2" /><Text>Proceed?</Text>
                    </Shape>
                    <Shape ID="2" NameU="Process">
                        <Cell N="PinX" V="3" /><Cell N="PinY" V="2" /><Text>Ja</Text>
                    </Shape>
                    <Shape ID="3" NameU="Dynamic connector">
                        <Cell N="PinX" V="2" /><Cell N="PinY" V="2" />
                    </Shape>
                </Shapes>
                <Connects>
                    <Connect FromSheet="3" FromCell="BeginX" ToSheet="1" />
                    <Connect FromSheet="3" FromCell="EndX" ToSheet="2" />
                </Connects>
            </PageContents>
        `);

        const portfolio = await importVisioPortfolio(await zipAsVisioFile(zip, 'connected-ja.vsdx'));
        const graph = portfolio.processes[0].graph;

        expect(graph.nodes.map(node => node.label)).toContain('Ja');
        expect(graph.edges[0].label).toBeUndefined();
        expect(inspectPortfolioIntegrity(portfolio).errors).toEqual([]);
    });

    it('assigns detached branch labels once to their nearest connectors', async () => {
        const zip = new JSZip();
        zip.file('visio/pages/page1.xml', `
            <PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main">
                <Shapes>
                    <Shape ID="1" NameU="Decision"><Cell N="PinX" V="1" /><Cell N="PinY" V="2" /><Text>Proceed?</Text></Shape>
                    <Shape ID="2" NameU="Process"><Cell N="PinX" V="3" /><Cell N="PinY" V="3" /><Text>Approved</Text></Shape>
                    <Shape ID="3" NameU="Process"><Cell N="PinX" V="3" /><Cell N="PinY" V="1" /><Text>Rejected</Text></Shape>
                    <Shape ID="4" NameU="Dynamic connector"><Cell N="PinX" V="2" /><Cell N="PinY" V="2.8" /></Shape>
                    <Shape ID="5" NameU="Dynamic connector"><Cell N="PinX" V="2" /><Cell N="PinY" V="1.2" /></Shape>
                    <Shape ID="6"><Cell N="PinX" V="2" /><Cell N="PinY" V="2.8" /><Text>Ja</Text></Shape>
                    <Shape ID="7"><Cell N="PinX" V="2" /><Cell N="PinY" V="1.2" /><Text>Nej</Text></Shape>
                </Shapes>
                <Connects>
                    <Connect FromSheet="4" FromCell="BeginX" ToSheet="1" /><Connect FromSheet="4" FromCell="EndX" ToSheet="2" />
                    <Connect FromSheet="5" FromCell="BeginX" ToSheet="1" /><Connect FromSheet="5" FromCell="EndX" ToSheet="3" />
                </Connects>
            </PageContents>
        `);

        const portfolio = await importVisioPortfolio(await zipAsVisioFile(zip, 'branches.vsdx'));
        const graph = portfolio.processes[0].graph;

        expect(graph.edges.map(edge => edge.label).sort()).toEqual(['Ja', 'Nej']);
        expect(graph.nodes.map(node => node.label)).not.toEqual(expect.arrayContaining(['Ja', 'Nej']));
        expect(inspectPortfolioIntegrity(portfolio).errors).toEqual([]);
    });
});

