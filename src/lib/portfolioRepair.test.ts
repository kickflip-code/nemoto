import { describe, expect, it } from 'vitest';
import { emptyPortfolio } from '../stores/slices/coreSlice';
import { decodePortfolioValue } from './portfolioCodec';
import { inspectRepairProcesses, prepareProcessRepair } from './portfolioRepair';

const process = (id: string, type = 'action') => ({
    id, title: id, description: 'Keep this story', createdAt: '', updatedAt: '',
    graph: { nodes: [{ id: `${id}-node`, type, label: 'A step', position: { x: 0, y: 0 } }], edges: [], swimlanes: [] },
});
const fixture = () => ({ ...structuredClone(emptyPortfolio), processes: [process('valid'), process('broken', 'subprocess')] });

describe('explicit process recovery', () => {
    it('lists rejected processes without admitting them to the model or changing the input', () => {
        const raw = fixture();
        const original = structuredClone(raw);
        const rows = inspectRepairProcesses(raw);
        expect(rows[0].issues).toEqual([]);
        expect(rows[1].issues.join(' ')).toContain('graph.nodes.0.type');
        expect(() => decodePortfolioValue(raw)).toThrow();
        expect(raw).toEqual(original);
    });

    it('keeps healthy nested graphs, Journal text, resources and unknown fields when removing a selected process', () => {
        const healthy = { ...process('valid'), ...{
            graph: { nodes: [{ ...process('valid').graph.nodes[0], subGraphId: 'child' }], edges: [], swimlanes: [] },
            subGraphs: { child: { nodes: [], edges: [], swimlanes: [] } },
        } };
        const raw = { ...fixture(), processes: [healthy, process('broken', 'subprocess')],
            extensions: { evidence: { untouched: true } },
            assets: [{ id: 'resource', name: 'Preserved resource', type: 'systems' }],
            journal: { notebooks: [{ id: 'notes', title: 'Notes', createdAt: '', updatedAt: '' }], tags: [], folders: [], entries: [{
                id: 'note', notebookId: 'notes', title: 'Evidence', content: '<p>Keep the incident history.</p>',
                tags: [], linkedContext: [{ type: 'process', id: 'broken' }], createdAt: '', updatedAt: '',
            }] },
        };
        const before = structuredClone(raw);
        const result = prepareProcessRepair(raw, [1]);
        expect(result.candidate).toEqual({ ...before, processes: [before.processes[0]] });
        expect(result.portfolio.processes).toHaveLength(1);
        expect(decodePortfolioValue(result.candidate).integrity.valid).toBe(true);
        expect(result.portfolio.journal.entries[0].content).toContain('Keep the incident history.');
        expect(result.warnings.some(warning => warning.code === 'dangling-journal-reference')).toBe(true);
        expect(raw).toEqual(before);
    });

    it('does not silently remove invalid entries or accept remaining invalid processes', () => {
        expect(() => prepareProcessRepair(fixture(), [])).toThrow();
        expect(() => prepareProcessRepair(fixture(), [0])).toThrow();
        expect(() => prepareProcessRepair(fixture(), [2])).toThrow(/selection/);
    });

    it('uses entry indexes to let the user resolve duplicate IDs', () => {
        const raw = { ...fixture(), processes: [process('same'), process('same')] };
        expect(() => prepareProcessRepair(raw, [])).toThrow(/reference or ID/);
        expect(prepareProcessRepair(raw, [1]).portfolio.processes).toHaveLength(1);
    });

    it('keeps non-process errors and future versions blocked instead of deleting other data', () => {
        expect(() => prepareProcessRepair({ ...fixture(), assets: [{ id: 'bad' }] }, [1])).toThrow();
        expect(() => prepareProcessRepair({ ...fixture(), schemaVersion: 99999 }, [1])).toThrow(/schema version/);
        expect(() => inspectRepairProcesses('invalid json')).toThrow(/readable/);
    });
});
