import type { DependencyEntityType, DependencyRelation, DependencyViewNode } from './dependencyGraph';

export interface DependencyNodeLayout {
    id: string;
    position: { x: number; y: number };
    width: number;
    height: number;
}

const CARD_WIDTH = 200;
const CARD_HEIGHT = 72;

const TYPE_ORDER: DependencyEntityType[] = ['process', 'node', 'asset', 'entry', 'tag'];

function compareNodes(a: DependencyViewNode, b: DependencyViewNode): number {
    return TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
        || a.label.localeCompare(b.label)
        || a.id.localeCompare(b.id);
}

function getDimensions(node: DependencyViewNode): { width: number; height: number } {
    if (node.type === 'tag') return { width: 170, height: 64 };
    if (node.type === 'entry') return { width: 190, height: 68 };
    if (node.isFocal) return { width: 230, height: 84 };
    return { width: CARD_WIDTH, height: CARD_HEIGHT };
}

function positionAtCenter(
    node: DependencyViewNode,
    centerX: number,
    centerY: number,
): DependencyNodeLayout {
    const { width, height } = getDimensions(node);
    return {
        id: node.id,
        position: { x: centerX - width / 2, y: centerY - height / 2 },
        width,
        height,
    };
}

function layoutRadially(nodes: DependencyViewNode[], focal: DependencyViewNode): DependencyNodeLayout[] {
    const result: DependencyNodeLayout[] = [positionAtCenter(focal, 0, 0)];
    const depthGroups = new Map<number, DependencyViewNode[]>();

    for (const node of nodes) {
        if (node.id === focal.id) continue;
        const depth = Math.max(1, node.depth || 1);
        const group = depthGroups.get(depth);
        if (group) group.push(node);
        else depthGroups.set(depth, [node]);
    }

    for (const [depth, unsortedGroup] of [...depthGroups].sort(([a], [b]) => a - b)) {
        const remaining = [...unsortedGroup].sort(compareNodes);
        let ringIndex = 0;

        while (remaining.length > 0) {
            const radius = 330 + (depth - 1) * 300 + ringIndex * 190;
            const capacity = Math.max(8, Math.floor((2 * Math.PI * radius) / 250));
            const ringNodes = remaining.splice(0, capacity);
            const offset = depth * 0.37 + ringIndex * 0.21;

            ringNodes.forEach((node, index) => {
                const angle = offset + (index / ringNodes.length) * 2 * Math.PI;
                result.push(positionAtCenter(
                    node,
                    Math.cos(angle) * radius,
                    Math.sin(angle) * radius,
                ));
            });

            ringIndex += 1;
        }
    }

    return result;
}

function directedDistances(
    focalId: string,
    relations: DependencyRelation[],
    direction: 'incoming' | 'outgoing',
): Map<string, number> {
    const adjacency = new Map<string, string[]>();

    for (const relation of relations) {
        const from = direction === 'outgoing' ? relation.source : relation.target;
        const to = direction === 'outgoing' ? relation.target : relation.source;
        const neighbors = adjacency.get(from) || [];
        neighbors.push(to);
        adjacency.set(from, neighbors);
    }

    for (const neighbors of adjacency.values()) neighbors.sort();

    const distances = new Map<string, number>([[focalId, 0]]);
    const queue = [focalId];

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        const nextDistance = (distances.get(current) || 0) + 1;
        for (const neighbor of adjacency.get(current) || []) {
            if (distances.has(neighbor)) continue;
            distances.set(neighbor, nextDistance);
            queue.push(neighbor);
        }
    }

    return distances;
}

function branchRanks(focalId: string, relations: DependencyRelation[]): Map<string, number> {
    const adjacency = new Map<string, Array<{ id: string; outgoing: boolean }>>();
    for (const relation of relations) {
        const sourceNeighbors = adjacency.get(relation.source) || [];
        sourceNeighbors.push({ id: relation.target, outgoing: true });
        adjacency.set(relation.source, sourceNeighbors);

        const targetNeighbors = adjacency.get(relation.target) || [];
        targetNeighbors.push({ id: relation.source, outgoing: false });
        adjacency.set(relation.target, targetNeighbors);
    }

    for (const neighbors of adjacency.values()) {
        neighbors.sort((a, b) => a.id.localeCompare(b.id) || Number(a.outgoing) - Number(b.outgoing));
    }

    const ranks = new Map<string, number>([[focalId, 0]]);
    const queue = [focalId];

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        const currentRank = ranks.get(current) || 0;
        for (const neighbor of adjacency.get(current) || []) {
            if (ranks.has(neighbor.id)) continue;
            const sign = currentRank === 0
                ? (neighbor.outgoing ? 1 : -1)
                : Math.sign(currentRank);
            ranks.set(neighbor.id, sign * (Math.abs(currentRank) + 1));
            queue.push(neighbor.id);
        }
    }

    return ranks;
}

/**
 * Places a selected focal point between the entities that feed into it and the
 * entities it affects. Each additional directed hop gets its own outer column.
 */
export function layoutFocusedDependencyGraph(
    nodes: DependencyViewNode[],
    relations: DependencyRelation[],
): DependencyNodeLayout[] {
    if (nodes.length === 0) return [];
    const focal = nodes.find(node => node.isFocal);
    if (!focal) return layoutByType(nodes);

    const incoming = directedDistances(focal.id, relations, 'incoming');
    const outgoing = directedDistances(focal.id, relations, 'outgoing');
    const fallbackRanks = branchRanks(focal.id, relations);
    const ranks = new Map<number, DependencyViewNode[]>();

    for (const node of nodes) {
        if (node.id === focal.id) continue;
        const incomingDistance = incoming.get(node.id);
        const outgoingDistance = outgoing.get(node.id);
        const directIncoming = relations.some(relation => relation.source === node.id && relation.target === focal.id);
        const directOutgoing = relations.some(relation => relation.source === focal.id && relation.target === node.id);
        let rank: number;

        if (directIncoming !== directOutgoing) {
            rank = directIncoming ? -1 : 1;
        } else if (incomingDistance !== undefined && outgoingDistance === undefined) {
            rank = -incomingDistance;
        } else if (outgoingDistance !== undefined && incomingDistance === undefined) {
            rank = outgoingDistance;
        } else if (incomingDistance !== undefined && outgoingDistance !== undefined && incomingDistance !== outgoingDistance) {
            rank = incomingDistance < outgoingDistance ? -incomingDistance : outgoingDistance;
        } else {
            rank = fallbackRanks.get(node.id) || Math.max(1, node.depth || 1);
        }

        const column = ranks.get(rank) || [];
        column.push(node);
        ranks.set(rank, column);
    }

    const result = [positionAtCenter(focal, 0, 0)];
    const columnGap = 380;
    const rowGap = 112;

    for (const [rank, column] of [...ranks].sort(([a], [b]) => a - b)) {
        column.sort(compareNodes);
        column.forEach((node, index) => {
            const centerY = (index - (column.length - 1) / 2) * rowGap;
            result.push(positionAtCenter(node, rank * columnGap, centerY));
        });
    }

    return result;
}

function layoutByType(nodes: DependencyViewNode[]): DependencyNodeLayout[] {
    const groups = new Map<DependencyEntityType, DependencyViewNode[]>();
    for (const node of nodes) {
        const group = groups.get(node.type);
        if (group) group.push(node);
        else groups.set(node.type, [node]);
    }

    const result: DependencyNodeLayout[] = [];
    const groupGap = 180;
    const columnGap = 240;
    const rowGap = 112;
    let cursorX = 0;

    for (const type of TYPE_ORDER) {
        const group = (groups.get(type) || []).sort(compareNodes);
        if (group.length === 0) continue;

        const rows = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(group.length * 1.5))));
        const columns = Math.ceil(group.length / rows);
        const groupWidth = Math.max(CARD_WIDTH, (columns - 1) * columnGap + CARD_WIDTH);
        const groupHeight = Math.max(CARD_HEIGHT, (Math.min(rows, group.length) - 1) * rowGap + CARD_HEIGHT);

        group.forEach((node, index) => {
            const column = Math.floor(index / rows);
            const row = index % rows;
            const centerX = cursorX + column * columnGap + CARD_WIDTH / 2;
            const centerY = row * rowGap - groupHeight / 2 + CARD_HEIGHT / 2;
            result.push(positionAtCenter(node, centerX, centerY));
        });

        cursorX += groupWidth + groupGap;
    }

    const minX = Math.min(...result.map(item => item.position.x), 0);
    const maxX = Math.max(...result.map(item => item.position.x + item.width), 0);
    const centerOffset = (minX + maxX) / 2;

    return result.map(item => ({
        ...item,
        position: { ...item.position, x: item.position.x - centerOffset },
    }));
}

export function layoutProcessScope(
    nodes: DependencyViewNode[],
    relations: DependencyRelation[],
): DependencyNodeLayout[] {
    const processes = nodes.filter(node => node.type === 'process').sort(compareNodes);
    const assets = nodes.filter(node => node.type === 'asset').sort(compareNodes);
    const assetProcessIds = new Map<string, Set<string>>();

    for (const relation of relations) {
        if (relation.type !== 'process-resource') continue;
        const processIds = assetProcessIds.get(relation.target) || new Set<string>();
        processIds.add(relation.source);
        assetProcessIds.set(relation.target, processIds);
    }

    const sharedAssets = assets
        .filter(asset => (assetProcessIds.get(asset.id)?.size || 0) > 1)
        .sort((a, b) =>
            (assetProcessIds.get(b.id)?.size || 0) - (assetProcessIds.get(a.id)?.size || 0)
            || compareNodes(a, b),
        );
    const localAssetsByProcess = new Map<string, DependencyViewNode[]>();
    const unassignedAssets: DependencyViewNode[] = [];

    for (const asset of assets) {
        const processIds = [...(assetProcessIds.get(asset.id) || [])];
        if (processIds.length !== 1) {
            if (processIds.length === 0) unassignedAssets.push(asset);
            continue;
        }
        const group = localAssetsByProcess.get(processIds[0]) || [];
        group.push(asset);
        localAssetsByProcess.set(processIds[0], group);
    }
    for (const group of localAssetsByProcess.values()) group.sort(compareNodes);

    const result: DependencyNodeLayout[] = [];
    const rowGap = 96;
    const groupGap = 64;
    let cursorY = 0;

    for (const process of processes) {
        const localAssets = localAssetsByProcess.get(process.id) || [];
        const rowCount = Math.max(1, localAssets.length);
        const processY = cursorY + ((rowCount - 1) * rowGap) / 2;
        result.push(positionAtCenter(process, 0, processY));
        localAssets.forEach((asset, index) => {
            result.push(positionAtCenter(asset, -380, cursorY + index * rowGap));
        });
        cursorY += rowCount * rowGap + groupGap;
    }

    if (result.length > 0) {
        const minY = Math.min(...result.map(item => item.position.y));
        const maxY = Math.max(...result.map(item => item.position.y + item.height));
        const offsetY = (minY + maxY) / 2;
        result.forEach(item => {
            item.position.y -= offsetY;
        });
    }

    const rightAssets = [...sharedAssets, ...unassignedAssets];
    rightAssets.forEach((asset, index) => {
        const centerY = (index - (rightAssets.length - 1) / 2) * rowGap;
        result.push(positionAtCenter(asset, 380, centerY));
    });

    return result;
}

export function layoutDependencyGraph(nodes: DependencyViewNode[]): DependencyNodeLayout[] {
    if (nodes.length === 0) return [];
    const focal = nodes.find(node => node.isFocal);
    return focal ? layoutRadially(nodes, focal) : layoutByType(nodes);
}
