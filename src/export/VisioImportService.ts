import JSZip, { type JSZipObject } from 'jszip';
import { generateId } from '../lib/id';
import { getSmartHandles } from '../lib/smartHandles';
import { inspectPortfolioIntegrity } from '../lib/portfolioIntegrity';
import { CURRENT_PORTFOLIO_SCHEMA_VERSION } from '../lib/import/migrate';
import { createEmptyPortfolioPluginState } from '../plugins/portfolioData';
import type { CanvasNode, CanvasEdge, CanvasGraph, NodeType, Portfolio, Process, Swimlane, CanvasMode, Position } from '../types';

const VISIO_NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const SCALE = 240;
const PALETTE_COLORS = ['blue', 'purple', 'green', 'orange', 'amber', 'gray', 'red'];

export const VISIO_IMPORT_LIMITS = {
    maxSourceBytes: 50 * 1024 * 1024,
    maxEntries: 2_000,
    maxExpandedBytes: 200 * 1024 * 1024,
    maxXmlEntryBytes: 20 * 1024 * 1024,
    maxShapesPerPage: 25_000,
    maxConnectorsPerPage: 50_000,
} as const;

export interface VisioArchiveEntryMetadata {
    name: string;
    directory?: boolean;
    uncompressedSize?: number;
}

type SizedZipObject = JSZipObject & {
    unsafeOriginalName?: string;
    _data?: {
        uncompressedSize?: number;
    };
};

export function validateVisioSourceFile(file: Pick<File, 'size'>): void {
    if (file.size > VISIO_IMPORT_LIMITS.maxSourceBytes) {
        throw new Error('The Visio file is larger than 50 MB.');
    }
}

export function validateVisioArchiveMetadata(entries: readonly VisioArchiveEntryMetadata[]): void {
    const files = entries.filter(entry => !entry.directory);
    if (files.length > VISIO_IMPORT_LIMITS.maxEntries) {
        throw new Error(`The Visio file contains too many archive entries (${files.length}).`);
    }

    let expandedBytes = 0;
    files.forEach(entry => {
        const normalizedName = entry.name.replace(/\\/g, '/');
        const pathParts = normalizedName.split('/');
        if (
            normalizedName.startsWith('/')
            || /^[a-z]:\//i.test(normalizedName)
            || pathParts.includes('..')
        ) {
            throw new Error('The Visio file contains an unsafe archive path.');
        }

        if (entry.uncompressedSize === undefined) return;
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
            throw new Error('The Visio file contains invalid archive size metadata.');
        }
        if (entry.name.toLowerCase().endsWith('.xml')
            && entry.uncompressedSize > VISIO_IMPORT_LIMITS.maxXmlEntryBytes) {
            throw new Error(`A Visio XML entry is larger than 20 MB (${entry.name}).`);
        }
        if (expandedBytes > VISIO_IMPORT_LIMITS.maxExpandedBytes - entry.uncompressedSize) {
            throw new Error('The Visio file expands beyond the 200 MB safety limit.');
        }
        expandedBytes += entry.uncompressedSize;
    });
}

async function readVisioXml(file: JSZipObject, filename: string): Promise<string> {
    const xmlText = await file.async('string');
    if (xmlText.length > VISIO_IMPORT_LIMITS.maxXmlEntryBytes) {
        throw new Error(`A Visio XML entry is larger than 20 MB (${filename}).`);
    }
    return xmlText;
}

function parseVisioXml(parser: DOMParser, xml: string, filename: string): Document {
    const document = parser.parseFromString(xml, 'text/xml');
    if (document.querySelector('parsererror')) {
        throw new Error(`The Visio file contains invalid XML (${filename}).`);
    }
    return document;
}

function decodeXmlText(text: string | null | undefined): string {
    if (!text) return '';
    return text
        .replace(/&#xA;/gi, '\n')
        .replace(/&#10;/gi, '\n')
        .replace(/&#x9;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\r\n/g, '\n')
        .trim();
}

interface VisioMasterInfo {
    id: string;
    nameU: string;
    name: string;
    shapeNameU?: string;
    shapeName?: string;
    shapeType?: string;
}

interface RawShape {
    id: string;
    name: string;
    nameU: string;
    masterId: string | null;
    masterInfo: VisioMasterInfo | null;
    type: string;
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
    beginX: number | null;
    beginY: number | null;
    endX: number | null;
    endY: number | null;
    geometryPoints: Position[];
    linePattern: number;
    parentId: string | null;
    childIds: string[];
}

function normalizeComparableVisioText(value: string | undefined): string {
    return (value || '')
        .normalize('NFKC')
        .toLocaleLowerCase('sv-SE')
        .replace(/[^a-z0-9åäö]+/g, '');
}

function isVisioBranchLabel(value: string): boolean {
    return new Set([
        'ja', 'nej', 'yes', 'no', 'annatfel', 'avslagen', 'godkänd',
    ]).has(normalizeComparableVisioText(value));
}

function describeShape(shape: RawShape): string {
    return [
        shape.masterInfo?.nameU,
        shape.masterInfo?.name,
        shape.masterInfo?.shapeNameU,
        shape.masterInfo?.shapeName,
        shape.nameU,
        shape.name,
    ].filter(Boolean).join(' ').toLowerCase();
}

function isDiagramContainerShape(shape: RawShape): boolean {
    const descriptor = describeShape(shape);
    return descriptor.includes('cff container')
        || descriptor.includes('cff-behållare')
        || descriptor.includes('cross-functional')
        || descriptor.includes('cross functional')
        || descriptor.includes('swimlane list')
        || descriptor.includes('simbanelista')
        || /\bpool\b/.test(descriptor);
}

function isSwimlaneShape(shape: RawShape): boolean {
    const descriptor = describeShape(shape);
    if (isDiagramContainerShape(shape)) return false;
    if (descriptor.includes('phase') || descriptor.includes('faslista') || descriptor.includes('separator')) return false;
    return descriptor.includes('swimlane')
        || descriptor.includes('simbana')
        || /\bfunction\b/.test(descriptor)
        || /\bfunktion\b/.test(descriptor);
}

function isPhaseShape(shape: RawShape): boolean {
    const descriptor = describeShape(shape);
    return descriptor.includes('phase list')
        || descriptor.includes('faslista')
        || /\bphase\b/.test(descriptor)
        || /\bseparator\b/.test(descriptor)
        || /\bavgränsare\b/.test(descriptor);
}

function isConnectorShape(shape: RawShape): boolean {
    const descriptor = describeShape(shape);
    return descriptor.includes('dynamic connector')
        || descriptor.includes('dynamisk koppling')
        || descriptor.includes('sequence flow')
        || descriptor.includes('sekvensflöde')
        || descriptor.includes('message flow')
        || descriptor.includes('meddelandeflöde');
}

function isStructuralShape(shape: RawShape): boolean {
    return isDiagramContainerShape(shape) || isSwimlaneShape(shape) || isPhaseShape(shape);
}

/**
 * Maps a Visio Master/Shape name and text to an Axiom NodeType
 */
function mapVisioTypeToAxiomType(
    masterInfo: VisioMasterInfo | null,
    shapeNameU: string,
    shapeName: string,
    text: string
): NodeType {
    const mNameU = (masterInfo?.nameU || masterInfo?.shapeNameU || '').toLowerCase();
    const mName = (masterInfo?.name || masterInfo?.shapeName || '').toLowerCase();
    const sNameU = shapeNameU.toLowerCase();
    const sName = shapeName.toLowerCase();
    const lowerText = text.toLowerCase();
    const combined = `${mNameU} ${mName} ${sNameU} ${sName}`;

    // 1. Decision / Gateway / Condition (Highest priority if question mark or decision stencil)
    if (
        text.includes('?') ||
        /\b(decision|beslut|gateway)\b/i.test(combined)
    ) {
        return 'decision';
    }

    // 2. Start / Slut stencil with text check
    if (combined.includes('start/slut') || combined.includes('start/end')) {
        if (/\b(slut|end|stopp)\b/i.test(lowerText)) return 'end';
        if (/\b(start|inled)\b/i.test(lowerText)) return 'start';
        return 'start';
    }

    // 3. Start event
    if (
        /\b(start event|starthändelse|start)\b/i.test(combined) ||
        lowerText === 'start'
    ) {
        return 'start';
    }

    // 4. End event
    if (
        /\b(end event|sluthändelse)\b/i.test(combined) ||
        /\b(slut|stopp|end)\b/i.test(lowerText) ||
        /\b(end|slut|stopp)\b/i.test(combined)
    ) {
        return 'end';
    }

    // 5. System / Database / Backend
    if (
        /\b(system|database|databas|server|teknik|technic)\b/i.test(combined)
    ) {
        return 'system';
    }

    // 6. Post-It / Callout / Annotation / Document / Note
    if (
        /\b(post-it|note|callout|pratbubbla|orthogonal|rätvinklig|document|dokument|data)\b/i.test(combined)
    ) {
        return 'post-it';
    }

    return 'action';
}

/**
 * Parses raw page XML and builds an Axiom CanvasGraph
 */
function parsePageToGraph(
    doc: Document,
    mastersById: Map<string, VisioMasterInfo>,
    pageName: string,
    nodePrefix: string = 'visio-',
    documentTitle?: string,
): { graph: CanvasGraph; containerTitle?: string } {
    const shapeNodes = doc.getElementsByTagNameNS(VISIO_NS, 'Shape');
    if (shapeNodes.length > VISIO_IMPORT_LIMITS.maxShapesPerPage) {
        throw new Error(`A Visio page contains too many shapes (${pageName}).`);
    }

    const extractedShapes: RawShape[] = [];

    // 1. First pass: extract all raw shapes
    for (let i = 0; i < shapeNodes.length; i++) {
        const shapeNode = shapeNodes[i];
        const id = shapeNode.getAttribute('ID');
        if (!id) continue;

        const name = shapeNode.getAttribute('Name') || '';
        const nameU = shapeNode.getAttribute('NameU') || '';
        const masterId = shapeNode.getAttribute('Master');
        const masterInfo = masterId ? mastersById.get(masterId) || null : null;
        const type = shapeNode.getAttribute('Type') || 'Shape';

        let text = '';
        for (let childIndex = 0; childIndex < shapeNode.childNodes.length; childIndex += 1) {
            const child = shapeNode.childNodes[childIndex] as Element;
            if (child.localName === 'Text') {
                text = decodeXmlText(child.textContent);
                break;
            }
        }

        let x = 0;
        let y = 0;
        let w = 1;
        let h = 1;
        let locPinX: number | null = null;
        let locPinY: number | null = null;
        let beginX: number | null = null;
        let beginY: number | null = null;
        let endX: number | null = null;
        let endY: number | null = null;
        let linePattern = 1;

        for (let j = 0; j < shapeNode.childNodes.length; j++) {
            const child = shapeNode.childNodes[j] as Element;
            if (child.localName === 'Cell') {
                const n = child.getAttribute('N');
                const v = child.getAttribute('V');
                if (!v) continue;
                if (n === 'PinX') x = parseFloat(v);
                if (n === 'PinY') y = parseFloat(v);
                if (n === 'Width') w = parseFloat(v);
                if (n === 'Height') h = parseFloat(v);
                if (n === 'LocPinX') locPinX = parseFloat(v);
                if (n === 'LocPinY') locPinY = parseFloat(v);
                if (n === 'BeginX') beginX = parseFloat(v);
                if (n === 'BeginY') beginY = parseFloat(v);
                if (n === 'EndX') endX = parseFloat(v);
                if (n === 'EndY') endY = parseFloat(v);
                if (n === 'LinePattern') linePattern = parseInt(v, 10) || 1;
            }
        }

        const geometryPoints: Position[] = [];
        const resolvedLocPinX = locPinX ?? (w / 2);
        const resolvedLocPinY = locPinY ?? (h / 2);
        for (let childIndex = 0; childIndex < shapeNode.childNodes.length; childIndex += 1) {
            const section = shapeNode.childNodes[childIndex] as Element;
            if (section.localName !== 'Section' || section.getAttribute('N') !== 'Geometry') continue;
            for (let rowIndex = 0; rowIndex < section.childNodes.length; rowIndex += 1) {
                const row = section.childNodes[rowIndex] as Element;
                if (row.localName !== 'Row' || !['MoveTo', 'LineTo'].includes(row.getAttribute('T') || '')) continue;
                let localX: number | null = null;
                let localY: number | null = null;
                for (let cellIndex = 0; cellIndex < row.childNodes.length; cellIndex += 1) {
                    const cell = row.childNodes[cellIndex] as Element;
                    if (cell.localName !== 'Cell') continue;
                    const value = cell.getAttribute('V');
                    if (!value) continue;
                    if (cell.getAttribute('N') === 'X') localX = parseFloat(value);
                    if (cell.getAttribute('N') === 'Y') localY = parseFloat(value);
                }
                if (localX !== null && localY !== null && Number.isFinite(localX) && Number.isFinite(localY)) {
                    geometryPoints.push({
                        x: x + localX - resolvedLocPinX,
                        y: y + localY - resolvedLocPinY,
                    });
                }
            }
        }

        // Parent detection
        let parentId: string | null = null;
        let parent = shapeNode.parentNode as Element | null;
        while (parent && parent.localName !== 'PageContents' && parent.localName !== 'Page') {
            if (parent.localName === 'Shape') {
                parentId = parent.getAttribute('ID');
                break;
            }
            parent = parent.parentNode as Element | null;
        }

        extractedShapes.push({
            id,
            name,
            nameU,
            masterId,
            masterInfo,
            type,
            text,
            x,
            y,
            w,
            h,
            beginX,
            beginY,
            endX,
            endY,
            geometryPoints,
            linePattern,
            parentId,
            childIds: [],
        });
    }

    const shapeById = new Map<string, RawShape>(extractedShapes.map(s => [s.id, s]));

    // Populate childIds
    extractedShapes.forEach(s => {
        if (s.parentId && shapeById.has(s.parentId)) {
            shapeById.get(s.parentId)!.childIds.push(s.id);
        }
    });

    // 2. Recursive text bubbling for composite groups
    function collectDescendantText(shape: RawShape): string {
        if (shape.text) return shape.text;
        for (const childId of shape.childIds) {
            const child = shapeById.get(childId);
            if (!child) continue;
            const childText = collectDescendantText(child);
            if (childText) return childText;
        }
        return '';
    }

    extractedShapes.forEach(s => {
        if (!s.text && s.childIds.length > 0) {
            s.text = collectDescendantText(s);
        }
    });

    // 3. Connects parsing (Edges / Connectors)
    const lineMap = new Map<string, { cell: string; nodeId: string }[]>();
    const connectNodes = doc.getElementsByTagNameNS(VISIO_NS, 'Connect');
    if (connectNodes.length > VISIO_IMPORT_LIMITS.maxConnectorsPerPage) {
        throw new Error(`A Visio page contains too many connectors (${pageName}).`);
    }

    for (let i = 0; i < connectNodes.length; i++) {
        const c = connectNodes[i];
        const lineId = c.getAttribute('FromSheet');
        const cell = c.getAttribute('FromCell') || '';
        const targetNodeId = c.getAttribute('ToSheet');

        if (lineId && targetNodeId) {
            if (!lineMap.has(lineId)) lineMap.set(lineId, []);
            lineMap.get(lineId)!.push({ cell, nodeId: targetNodeId });
        }
    }

    // Helper: find root container/node ID for grouped sub-shapes
    function getRootTargetId(shapeId: string): string {
        let curr = shapeById.get(shapeId);
        while (curr && curr.parentId) {
            const parent = shapeById.get(curr.parentId);
            if (parent && isStructuralShape(parent)) {
                break;
            }
            if (parent) {
                curr = parent;
            } else {
                break;
            }
        }
        return curr ? curr.id : shapeId;
    }

    function hasStructuralAncestor(shape: RawShape): boolean {
        let parentId = shape.parentId;
        while (parentId) {
            const parent = shapeById.get(parentId);
            if (!parent) return false;
            if (isStructuralShape(parent)) return true;
            parentId = parent.parentId;
        }
        return false;
    }

    const connectedEndpointIds = new Set<string>();
    lineMap.forEach(ends => {
        ends.forEach(end => {
            connectedEndpointIds.add(end.nodeId);
            connectedEndpointIds.add(getRootTargetId(end.nodeId));
        });
    });

    // Visio often stores the caption below an unlabeled start/end symbol as a
    // separate plain text shape. Merge that caption into the semantic marker
    // instead of importing a duplicate process node.
    const consumedMarkerLabelShapes = new Set<string>();
    const unlabeledMarkers = extractedShapes.filter(shape => {
        if (shape.text || isStructuralShape(shape) || isConnectorShape(shape)) return false;
        const type = mapVisioTypeToAxiomType(shape.masterInfo, shape.nameU, shape.name, shape.text);
        return type === 'start' || type === 'end';
    });
    const markerLabelCandidates = extractedShapes.filter(shape => (
        !!shape.text
        && !shape.masterInfo
        && !shape.parentId
        && !connectedEndpointIds.has(shape.id)
        && !lineMap.has(shape.id)
        && !isStructuralShape(shape)
        && !isVisioBranchLabel(shape.text)
    ));
    unlabeledMarkers.forEach(marker => {
        let closest: RawShape | undefined;
        let closestDistance = 1;
        markerLabelCandidates.forEach(candidate => {
            if (consumedMarkerLabelShapes.has(candidate.id)) return;
            const distance = Math.hypot(candidate.x - marker.x, candidate.y - marker.y);
            if (distance < closestDistance) {
                closest = candidate;
                closestDistance = distance;
            }
        });
        if (closest) {
            marker.text = closest.text;
            consumedMarkerLabelShapes.add(closest.id);
        }
    });

    // 4. Swimlane and Phase extraction
    const swimlaneCandidates: Array<{
        id: string;
        label: string;
        y: number;
        h: number;
        visioTop: number;
        visioHeight: number;
    }> = [];

    let detectedContainerTitle: string | undefined = undefined;

    extractedShapes.forEach(s => {
        const label = s.text.trim();
        if (isDiagramContainerShape(s) && label && !detectedContainerTitle) {
            detectedContainerTitle = label;
        }

        if (isSwimlaneShape(s) && label) {
            swimlaneCandidates.push({
                id: `${nodePrefix}lane-${s.id}`,
                label,
                y: s.y,
                h: s.h,
                visioTop: s.y + (s.h / 2),
                visioHeight: s.h,
            });
        }
    });

    // Sort swimlanes from top to bottom (highest Visio Y first)
    swimlaneCandidates.sort((a, b) => b.y - a.y);

    const hasSwimlanes = swimlaneCandidates.length > 0;
    const canvasMode: CanvasMode = hasSwimlanes ? 'swimlane' : 'blank';
    const axiomSwimlanes: Swimlane[] = [];

    if (hasSwimlanes) {
        const DEFAULT_LANE_HEIGHT = 300;
        swimlaneCandidates.forEach((lane, index) => {
            const calculatedHeight = Math.max(DEFAULT_LANE_HEIGHT, Math.round(lane.h * SCALE * 0.8));
            axiomSwimlanes.push({
                id: lane.id,
                label: lane.label,
                color: PALETTE_COLORS[index % PALETTE_COLORS.length] || 'blue',
                order: index,
                height: calculatedHeight,
                width: 3200,
            });
        });
    }

    function findSwimlaneForNode(nodeY: number) {
        if (!hasSwimlanes) return null;
        for (const lane of swimlaneCandidates) {
            const laneTop = lane.visioTop;
            const laneBottom = laneTop - lane.visioHeight;
            if (nodeY <= laneTop + 0.1 && nodeY >= laneBottom - 0.1) {
                return lane;
            }
        }
        let closest = swimlaneCandidates[0];
        let minDist = Math.abs(nodeY - closest.y);
        for (let i = 1; i < swimlaneCandidates.length; i++) {
            const d = Math.abs(nodeY - swimlaneCandidates[i].y);
            if (d < minDist) {
                minDist = d;
                closest = swimlaneCandidates[i];
            }
        }
        return closest;
    }

    // 5. Filter valid process nodes
    const validShapes: RawShape[] = [];
    const validShapeIds = new Set<string>();

    extractedShapes.forEach(shape => {
        if (consumedMarkerLabelShapes.has(shape.id)) {
            return;
        }

        if (isStructuralShape(shape) || isConnectorShape(shape)) {
            return;
        }

        if (lineMap.has(shape.id)) {
            return;
        }

        // CFF containers and swimlanes use nested shapes for titles, headers,
        // borders and other presentation-only content. They are not process
        // steps even when those child shapes contain text.
        if (hasStructuralAncestor(shape)) {
            return;
        }

        if (shape.parentId) {
            const parent = shapeById.get(shape.parentId);
            if (parent) {
                return;
            }
        }

        const normalizedText = normalizeComparableVisioText(shape.text);
        const normalizedDocumentTitle = normalizeComparableVisioText(documentTitle);
        const isUnconnectedDocumentTitle = !!normalizedDocumentTitle
            && normalizedText.startsWith(normalizedDocumentTitle)
            && !shape.masterInfo
            && !connectedEndpointIds.has(shape.id)
            && (shape.h <= 0.5 || shape.w >= shape.h * 3);
        if (isUnconnectedDocumentTitle) {
            return;
        }

        const mName = (shape.masterInfo?.nameU || shape.masterInfo?.name || '').toLowerCase();
        const hasText = !!shape.text;
        const isKnownMarker = (
            mName.includes('start') ||
            mName.includes('end') ||
            mName.includes('slut') ||
            mName.includes('gateway') ||
            mName.includes('decision')
        );

        if (!hasText && !isKnownMarker) {
            return;
        }

        validShapes.push(shape);
        validShapeIds.add(shape.id);
    });

    const minPinX = validShapes.length > 0 ? Math.min(...validShapes.map(s => s.x)) : 0;
    const maxPinY = validShapes.length > 0 ? Math.max(...validShapes.map(s => s.y)) : 0;

    function inferVisioHandle(
        shape: RawShape | undefined,
        point: Position | null,
        role: 'source' | 'target',
    ): string | undefined {
        if (!shape || !point) return undefined;
        const normalizedX = (point.x - shape.x) / Math.max(Math.abs(shape.w) / 2, 0.01);
        const normalizedY = (point.y - shape.y) / Math.max(Math.abs(shape.h) / 2, 0.01);
        let side: 'left' | 'right' | 'top' | 'bottom';
        if (Math.abs(normalizedX) >= Math.abs(normalizedY)) {
            side = normalizedX >= 0 ? 'right' : 'left';
        } else {
            // Visio Y grows upwards; canvas Y grows downwards.
            side = normalizedY >= 0 ? 'top' : 'bottom';
        }
        return `${role === 'source' ? 's' : 't'}-${side}`;
    }

    function toCanvasRoutingPoint(point: Position): Position {
        const xOffset = hasSwimlanes ? 120 : 100;
        const x = Math.round((point.x - minPinX) * SCALE + xOffset + 112);
        if (!hasSwimlanes) {
            return {
                x,
                y: Math.round((maxPinY - point.y) * SCALE + 148),
            };
        }

        const laneCandidate = findSwimlaneForNode(point.y);
        if (!laneCandidate) {
            return { x, y: Math.round((maxPinY - point.y) * SCALE + 100) };
        }
        const laneIdx = swimlaneCandidates.findIndex(lane => lane.id === laneCandidate.id);
        const cumY = axiomSwimlanes.slice(0, laneIdx).reduce((sum, lane) => sum + lane.height, 0);
        const relY = Math.max(0, Math.min(1,
            (laneCandidate.visioTop - point.y) / (laneCandidate.visioHeight || 1),
        ));
        return {
            x,
            y: Math.round(cumY + (relY * axiomSwimlanes[laneIdx].height)),
        };
    }

    function isConnectorEndpoint(point: Position, lineShape: RawShape): boolean {
        const endpoints = [
            lineShape.beginX !== null && lineShape.beginY !== null
                ? { x: lineShape.beginX, y: lineShape.beginY }
                : null,
            lineShape.endX !== null && lineShape.endY !== null
                ? { x: lineShape.endX, y: lineShape.endY }
                : null,
        ].filter((value): value is Position => value !== null);
        return endpoints.some(endpoint => Math.hypot(point.x - endpoint.x, point.y - endpoint.y) < 0.02);
    }

    // 6. Edge generation & Floating label extraction
    const axiomEdges: CanvasEdge[] = [];
    const floatingLabelShapes = new Set<string>();
    const consumedLabelShapes = new Set<string>();

    // Detect small unattached text shapes that serve as decision branch labels ("Ja", "Nej", etc.)
    validShapes.forEach(shape => {
        const hasNoConnections = !connectedEndpointIds.has(shape.id);
        if (isVisioBranchLabel(shape.text) && hasNoConnections && !shape.masterInfo) {
            floatingLabelShapes.add(shape.id);
        }
    });

    lineMap.forEach((ends, lineId) => {
        if (ends.length >= 2) {
            const beginEnd = ends.find(e => e.cell.includes('Begin'));
            const endEnd = ends.find(e => e.cell.includes('End'));

            const sourceNodeId = getRootTargetId(beginEnd ? beginEnd.nodeId : ends[0].nodeId);
            const targetNodeId = getRootTargetId(endEnd ? endEnd.nodeId : ends[1].nodeId);

            if (validShapeIds.has(sourceNodeId) && validShapeIds.has(targetNodeId) && sourceNodeId !== targetNodeId) {
                const lineShape = shapeById.get(lineId);
                const sourceShape = shapeById.get(sourceNodeId);
                const targetShape = shapeById.get(targetNodeId);
                let lineText = lineShape?.text || undefined;

                // Style detection: dashed if line pattern is not solid or if message flow
                const mName = (lineShape?.masterInfo?.nameU || lineShape?.masterInfo?.name || '').toLowerCase();
                const isDashed = (lineShape && lineShape.linePattern > 1) || mName.includes('message flow') || mName.includes('meddelandeflöde');

                // If no lineText, find the closest unclaimed floating label shape
                if (!lineText) {
                    if (sourceShape) {
                        let bestDist = Infinity;
                        let bestLabelId: string | null = null;
                        let bestLabelText: string | undefined = undefined;

                        const midX = lineShape ? lineShape.x : (targetShape ? (sourceShape.x + targetShape.x) / 2 : sourceShape.x);
                        const midY = lineShape ? lineShape.y : (targetShape ? (sourceShape.y + targetShape.y) / 2 : sourceShape.y);

                        for (const labelShapeId of floatingLabelShapes) {
                            if (consumedLabelShapes.has(labelShapeId)) continue;
                            const lShape = shapeById.get(labelShapeId);
                            if (lShape) {
                                const distToLine = Math.hypot(lShape.x - midX, lShape.y - midY);
                                const distToSource = Math.hypot(lShape.x - sourceShape.x, lShape.y - sourceShape.y);
                                const dist = Math.min(distToLine, distToSource);

                                if (dist < 2.5 && dist < bestDist) {
                                    bestDist = dist;
                                    bestLabelId = labelShapeId;
                                    bestLabelText = lShape.text;
                                }
                            }
                        }

                        if (bestLabelId && bestLabelText) {
                            lineText = bestLabelText;
                            consumedLabelShapes.add(bestLabelId);
                        }
                    }
                }

                const sourcePoint = lineShape && lineShape.beginX !== null && lineShape.beginY !== null
                    ? { x: lineShape.beginX, y: lineShape.beginY }
                    : null;
                const targetPoint = lineShape && lineShape.endX !== null && lineShape.endY !== null
                    ? { x: lineShape.endX, y: lineShape.endY }
                    : null;
                const routingPoints = lineShape?.geometryPoints
                    .filter(point => !isConnectorEndpoint(point, lineShape))
                    .map(toCanvasRoutingPoint);

                axiomEdges.push({
                    id: `${nodePrefix}edge-${lineId}`,
                    sourceId: `${nodePrefix}${sourceNodeId}`,
                    targetId: `${nodePrefix}${targetNodeId}`,
                    type: 'smoothstep',
                    style: isDashed ? 'dashed' : 'solid',
                    label: lineText || undefined,
                    sourceHandleId: inferVisioHandle(sourceShape, sourcePoint, 'source'),
                    targetHandleId: inferVisioHandle(targetShape, targetPoint, 'target'),
                    routingPoints: routingPoints && routingPoints.length > 0 ? routingPoints : undefined,
                });
            }
        }
    });

    // 7. Generate Axiom Nodes
    const axiomNodes: CanvasNode[] = [];

    validShapes.forEach(shape => {
        // Only remove labels that were actually consumed by a connector. An
        // unmatched "Ja"/"Nej" shape is safer to preserve than silently drop.
        if (consumedLabelShapes.has(shape.id)) {
            return;
        }

        const type = mapVisioTypeToAxiomType(
            shape.masterInfo,
            shape.nameU,
            shape.name,
            shape.text
        );

        let defaultW = 224;
        let defaultH = 96;
        if (type === 'decision') {
            defaultW = 240;
            defaultH = 180;
        } else if (type === 'start' || type === 'end') {
            defaultW = 160;
            defaultH = 80;
        } else if (type === 'post-it') {
            defaultW = Math.max(200, Math.min(320, Math.round(shape.w * SCALE * 0.8)));
            defaultH = Math.max(120, Math.min(240, Math.round(shape.h * SCALE * 0.8)));
        }

        let posX = 100;
        let posY = 100;
        let assignedLaneId: string | null = null;

        if (hasSwimlanes) {
            const laneCandidate = findSwimlaneForNode(shape.y);
            if (laneCandidate) {
                assignedLaneId = laneCandidate.id;
                const laneIdx = swimlaneCandidates.findIndex(l => l.id === laneCandidate.id);
                const cumY = axiomSwimlanes.slice(0, laneIdx).reduce((sum, l) => sum + l.height, 0);
                const laneHeight = axiomSwimlanes[laneIdx].height;

                // Relative position within Visio swimlane (0 at top, 1 at bottom)
                const relY = Math.max(0.1, Math.min(0.9, (laneCandidate.visioTop - shape.y) / (laneCandidate.visioHeight || 1)));
                posY = cumY + Math.max(20, Math.min(laneHeight - defaultH - 20, Math.round(relY * laneHeight - (defaultH / 2))));
            } else {
                posY = Math.round((maxPinY - shape.y) * SCALE + 100);
            }
            posX = Math.round((shape.x - minPinX) * SCALE + 120);
        } else {
            posX = Math.round((shape.x - minPinX) * SCALE + 100);
            posY = Math.round((maxPinY - shape.y) * SCALE + 100);
        }

        // Clean label: if label is empty and it's a start/end node, give a friendly label
        let label = shape.text;
        if (!label) {
            if (type === 'start') label = 'Start';
            else if (type === 'end') label = 'Slut';
            else label = shape.name || 'Unnamed';
        }

        axiomNodes.push({
            id: `${nodePrefix}${shape.id}`,
            type,
            label,
            position: { x: posX, y: posY },
            width: defaultW,
            height: defaultH,
            swimlaneId: assignedLaneId,
            data: {},
        });
    });

    // Normalize coordinates in blank mode
    if (!hasSwimlanes && axiomNodes.length > 0) {
        let minX = Infinity;
        let minY = Infinity;
        axiomNodes.forEach(n => {
            if (n.position.x < minX) minX = n.position.x;
            if (n.position.y < minY) minY = n.position.y;
        });
        axiomNodes.forEach(n => {
            n.position.x = (n.position.x - minX) + 100;
            n.position.y = (n.position.y - minY) + 100;
        });
    }

    // 8. Assign Smart Handles to Edges based on relative node positions
    const nodeById = new Map<string, CanvasNode>(axiomNodes.map(n => [n.id, n]));
    axiomEdges.forEach(edge => {
        const src = nodeById.get(edge.sourceId);
        const tgt = nodeById.get(edge.targetId);
        if (src && tgt) {
            const handles = getSmartHandles(src, tgt);
            edge.sourceHandleId ||= handles.sourceHandleId;
            edge.targetHandleId ||= handles.targetHandleId;
        }
    });

    return {
        graph: {
            nodes: axiomNodes,
            edges: axiomEdges,
            swimlanes: axiomSwimlanes,
            mode: canvasMode,
        },
        containerTitle: detectedContainerTitle,
    };
}

export interface VisioPageResult {
    id: string;
    name: string;
    title: string;
    graph: CanvasGraph;
}

/**
 * Extracts all foreground pages from a Visio file (.vsdx)
 */
export async function parseVisioDocument(file: File): Promise<VisioPageResult[]> {
    validateVisioSourceFile(file);
    const zip = await JSZip.loadAsync(file);
    validateVisioArchiveMetadata(Object.entries(zip.files).map(([filename, fileObject]) => {
        const sizedFile = fileObject as SizedZipObject;
        return {
            name: sizedFile.unsafeOriginalName || filename,
            directory: fileObject.dir,
            uncompressedSize: sizedFile._data?.uncompressedSize,
        };
    }));
    const parser = new DOMParser();

    // 1. Parse Masters & Relationships
    const masterRels: Record<string, string> = {};
    if (zip.files['visio/masters/_rels/masters.xml.rels']) {
        const relsXml = await readVisioXml(zip.files['visio/masters/_rels/masters.xml.rels'], 'masters.xml.rels');
        const relsDoc = parseVisioXml(parser, relsXml, 'masters.xml.rels');
        const relElements = relsDoc.getElementsByTagName('Relationship');
        for (let i = 0; i < relElements.length; i++) {
            const rId = relElements[i].getAttribute('Id');
            const target = relElements[i].getAttribute('Target');
            if (rId && target) masterRels[rId] = target;
        }
    }

    const mastersById = new Map<string, VisioMasterInfo>();
    if (zip.files['visio/masters/masters.xml']) {
        const mXml = await readVisioXml(zip.files['visio/masters/masters.xml'], 'masters.xml');
        const mDoc = parseVisioXml(parser, mXml, 'masters.xml');
        const masterElements = mDoc.getElementsByTagName('Master');
        for (let i = 0; i < masterElements.length; i++) {
            const mElem = masterElements[i];
            const id = mElem.getAttribute('ID');
            const name = mElem.getAttribute('Name') || '';
            const nameU = mElem.getAttribute('NameU') || name;
            const relChild = mElem.getElementsByTagName('Rel')[0];
            const relId = relChild?.getAttribute('r:id');
            const target = relId ? masterRels[relId] : undefined;

            if (id) {
                mastersById.set(id, { id, nameU, name });
                // If master file exists, check shape inner details
                if (target && zip.files[`visio/masters/${target}`]) {
                    const innerXml = await readVisioXml(zip.files[`visio/masters/${target}`], target);
                    const innerDoc = parseVisioXml(parser, innerXml, target);
                    const shape = innerDoc.getElementsByTagNameNS(VISIO_NS, 'Shape')[0];
                    if (shape) {
                        const sNameU = shape.getAttribute('NameU');
                        const sName = shape.getAttribute('Name');
                        const sType = shape.getAttribute('Type');
                        const existing = mastersById.get(id)!;
                        if (sNameU) existing.shapeNameU = sNameU;
                        if (sName) existing.shapeName = sName;
                        if (sType) existing.shapeType = sType;
                    }
                }
            }
        }
    }

    // 2. Parse Pages & Relationships
    const pageRels: Record<string, string> = {};
    if (zip.files['visio/pages/_rels/pages.xml.rels']) {
        const relsXml = await readVisioXml(zip.files['visio/pages/_rels/pages.xml.rels'], 'pages.xml.rels');
        const relsDoc = parseVisioXml(parser, relsXml, 'pages.xml.rels');
        const relElements = relsDoc.getElementsByTagName('Relationship');
        for (let i = 0; i < relElements.length; i++) {
            const rId = relElements[i].getAttribute('Id');
            const target = relElements[i].getAttribute('Target');
            if (rId && target) pageRels[rId] = target;
        }
    }

    interface PageEntry {
        id: string;
        name: string;
        nameU: string;
        isBg: boolean;
        targetFile: string;
    }

    let pageEntries: PageEntry[] = [];

    if (zip.files['visio/pages/pages.xml']) {
        const pagesXml = await readVisioXml(zip.files['visio/pages/pages.xml'], 'pages.xml');
        const pagesDoc = parseVisioXml(parser, pagesXml, 'pages.xml');
        const pElements = pagesDoc.getElementsByTagName('Page');
        for (let i = 0; i < pElements.length; i++) {
            const pElem = pElements[i];
            const id = pElem.getAttribute('ID') || String(i);
            const name = pElem.getAttribute('Name') || pElem.getAttribute('NameU') || `Page ${i + 1}`;
            const nameU = pElem.getAttribute('NameU') || name;
            const isBg = pElem.getAttribute('Background') === '1';
            const relChild = pElem.getElementsByTagName('Rel')[0];
            const relId = relChild?.getAttribute('r:id');
            const targetFile = relId && pageRels[relId] ? pageRels[relId] : `page${id}.xml`;

            pageEntries.push({ id, name, nameU, isBg, targetFile });
        }
    } else {
        // Fallback: check all page*.xml
        Object.keys(zip.files)
            .filter(f => f.startsWith('visio/pages/page') && f.endsWith('.xml') && !f.includes('rels'))
            .forEach((f, idx) => {
                pageEntries.push({
                    id: String(idx),
                    name: `Page ${idx + 1}`,
                    nameU: `Page ${idx + 1}`,
                    isBg: false,
                    targetFile: f.replace('visio/pages/', ''),
                });
            });
    }

    // Filter out background pages
    const foregroundPages = pageEntries.filter(p => !p.isBg);
    if (foregroundPages.length === 0) {
        throw new Error('No usable foreground pages found in the Visio file.');
    }

    const baseFileName = file.name.replace(/\.vsdx$/i, '');
    const results: VisioPageResult[] = [];

    for (let pageIdx = 0; pageIdx < foregroundPages.length; pageIdx++) {
        const pageEntry = foregroundPages[pageIdx];
        const pagePath = `visio/pages/${pageEntry.targetFile}`;
        const pageFileObj = zip.files[pagePath];
        if (!pageFileObj) {
            throw new Error(`The Visio file references a missing page (${pageEntry.name}).`);
        }

        const nodePrefix = foregroundPages.length > 1 ? `visio-p${pageIdx}-` : 'visio-';

        const pageXml = await readVisioXml(pageFileObj, pagePath);
        const pageDoc = parseVisioXml(parser, pageXml, pagePath);
        const { graph, containerTitle } = parsePageToGraph(
            pageDoc,
            mastersById,
            pageEntry.name,
            nodePrefix,
            baseFileName,
        );

        let processTitle = baseFileName;
        if (foregroundPages.length > 1) {
            processTitle = `${baseFileName} (${pageEntry.name})`;
        } else if (containerTitle) {
            processTitle = containerTitle;
        }

        results.push({
            id: pageEntry.id,
            name: pageEntry.name,
            title: processTitle,
            graph,
        });
    }

    if (results.length === 0) {
        throw new Error('No usable foreground pages found in the Visio file.');
    }

    return results;
}

/**
 * Imports a full Visio file as a Portfolio containing all foreground pages as separate Processes.
 */
export async function importVisioPortfolio(file: File): Promise<Portfolio> {
    const pageResults = await parseVisioDocument(file);

    const processes: Process[] = pageResults.map(p => ({
        id: generateId('process'),
        title: p.title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        graph: p.graph,
        mode: p.graph.mode || 'blank',
    }));

    const portfolio: Portfolio = {
        schemaVersion: CURRENT_PORTFOLIO_SCHEMA_VERSION,
        version: '1.0.0',
        lastModified: new Date().toISOString(),
        processes,
        processFolders: [],
        assets: [],
        assetCategories: [],
        incidents: [],
        journal: {
            entries: [],
            notebooks: [],
            folders: [],
            tags: [],
        },
        plugins: createEmptyPortfolioPluginState(),
    };

    const integrity = inspectPortfolioIntegrity(portfolio);
    if (!integrity.valid) {
        const summary = integrity.errors
            .slice(0, 3)
            .map(issue => issue.message)
            .join(' ');
        throw new Error(`The Visio import produced invalid references. ${summary}`);
    }

    return portfolio;
}

/**
 * Backwards-compatible import function returning the primary CanvasGraph
 */
export async function importVisioFile(file: File): Promise<CanvasGraph> {
    const pageResults = await parseVisioDocument(file);
    if (pageResults.length === 0) {
        throw new Error('No usable pages found in the Visio file.');
    }
    return pageResults[0].graph;
}
