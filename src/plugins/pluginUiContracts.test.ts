import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/plugins/protocol/ui-wire-v1.json';
import {
    PluginUiContractError,
    PluginUiInputSchema,
    PluginUiResultSchema,
    parsePluginUiInputJson,
    parsePluginUiResultJson,
} from './pluginUiContracts';
import { PLUGIN_UI_LIMITS } from './pluginUiProtocol';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const clone = <T>(value: T): T => structuredClone(value);

function patch(document: Json, pointer: string, value: Json): Json {
    if (!pointer) return document;
    const parts = pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    let parent = document as Record<string, Json> | Json[];
    for (const part of parts.slice(0, -1)) parent = (parent as Record<string, Json>)[part] as Record<string, Json> | Json[];
    (parent as Record<string, Json>)[parts[parts.length - 1]] = value;
    return document;
}

describe('plugin composed UI wire contracts', () => {
    it.each(fixture.cases)('$name', testCase => {
        const source = clone(testCase.document === 'input' ? fixture.input : fixture.result) as Json;
        const candidate = testCase.pointer ? patch(source, testCase.pointer, testCase.value as Json) : source;
        const schema = testCase.document === 'input' ? PluginUiInputSchema : PluginUiResultSchema;
        expect(schema.safeParse(candidate).success).toBe(testCase.valid);
    });

    it.each(fixture.rawCases)('$name', testCase => {
        const parse = testCase.document === 'input' ? parsePluginUiInputJson : parsePluginUiResultJson;
        try { parse(testCase.json); throw new Error('Expected parsing to fail.'); }
        catch (error) {
            expect(error).toBeInstanceOf(PluginUiContractError);
            expect((error as PluginUiContractError).code).toBe(testCase.code);
        }
    });

    it('parses the canonical request and result without applying effects', () => {
        expect(parsePluginUiInputJson(JSON.stringify(fixture.input))).toEqual(fixture.input);
        expect(parsePluginUiResultJson(JSON.stringify(fixture.result))).toEqual(fixture.result);
    });

    it.each(fixture.effectSamples)('accepts the explicit $kind payload', effect => {
        const result = clone(fixture.result) as unknown as { effects: Json[] };
        result.effects = [effect as unknown as Json];
        expect(PluginUiResultSchema.safeParse(result).success).toBe(true);
    });

    it.each(fixture.nodeSamples)('accepts the explicit $type primitive', node => {
        const result = clone(fixture.result) as unknown as { tree: Json };
        result.tree = {
            key: 'sample-root', type: 'stack', direction: 'vertical', gap: 'none', wrap: false,
            children: [node as unknown as Json],
        };
        expect(PluginUiResultSchema.safeParse(result).success).toBe(true);
    });

    it('counts Unicode as UTF-8 bytes at the state, tree, and wire boundaries', () => {
        const result = clone(fixture.result) as unknown as { state: Json };
        result.state = { value: 'å'.repeat(PLUGIN_UI_LIMITS.stateBytes / 2 + 1) };
        expect(PluginUiResultSchema.safeParse(result).success).toBe(false);
        expect(() => parsePluginUiInputJson(' '.repeat(PLUGIN_UI_LIMITS.requestBytes + 1)))
            .toThrow(expect.objectContaining({ code: 'REQUEST_TOO_LARGE' }));
        expect(() => parsePluginUiResultJson(' '.repeat(PLUGIN_UI_LIMITS.resultBytes + 1)))
            .toThrow(expect.objectContaining({ code: 'RESULT_TOO_LARGE' }));
        const inputJson = JSON.stringify(fixture.input);
        const resultJson = JSON.stringify(fixture.result);
        expect(parsePluginUiInputJson(inputJson + ' '.repeat(PLUGIN_UI_LIMITS.requestBytes - inputJson.length))).toBeDefined();
        expect(parsePluginUiResultJson(resultJson + ' '.repeat(PLUGIN_UI_LIMITS.resultBytes - resultJson.length))).toBeDefined();
    });

    it('enforces tree depth, child count, node count and one dialog', () => {
        const container = (key: string, children: Json[]) => ({ key, type: 'stack', direction: 'vertical', gap: 'none', wrap: false, children });
        const nested = (depth: number): Json => {
            let tree: Json = { key: 'leaf', type: 'text', text: '', role: 'body', tone: 'default' };
            for (let level = 1; level < depth; level += 1) tree = container(`depth:${level}`, [tree]);
            return tree;
        };
        const result = clone(fixture.result) as unknown as { tree: Json; effects: Json[] };
        result.tree = nested(PLUGIN_UI_LIMITS.treeDepth);
        expect(PluginUiResultSchema.safeParse(result).success).toBe(true);
        result.tree = nested(PLUGIN_UI_LIMITS.treeDepth + 1);
        expect(PluginUiResultSchema.safeParse(result).success).toBe(false);
        const leaves = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({ key: `${prefix}:${index}`, type: 'text', text: '', role: 'body', tone: 'default' }));
        result.tree = container('root', leaves('child', PLUGIN_UI_LIMITS.childrenPerNode));
        expect(PluginUiResultSchema.safeParse(result).success).toBe(true);
        result.tree = container('root', leaves('child', PLUGIN_UI_LIMITS.childrenPerNode + 1));
        expect(PluginUiResultSchema.safeParse(result).success).toBe(false);
        const exactBranches = Array.from({ length: 10 }, (_, index) => (
            container(`branch:${index}`, leaves(`branch:${index}:leaf`, index === 9 ? 89 : 100))
        ));
        result.tree = container('root', exactBranches);
        expect(PluginUiResultSchema.safeParse(result).success).toBe(true);
        (exactBranches[9] as { children: Json[] }).children.push({ key: 'node:1001', type: 'text', text: '', role: 'body', tone: 'default' });
        result.tree = container('root', exactBranches);
        expect(PluginUiResultSchema.safeParse(result).success).toBe(false);
        const dialog = (key: string) => ({ key, type: 'dialog', label: 'Dialog', closeActionId: `close:${key}`, dirty: false, children: [] });
        result.tree = container('root', [dialog('one'), dialog('two')]);
        expect(PluginUiResultSchema.safeParse(result).success).toBe(false);
    });

    it('rejects duplicate effects and more than one storage batch', () => {
        const result = clone(fixture.result) as unknown as { effects: Json[] };
        result.effects = [clone(result.effects[0]), clone(result.effects[0])];
        expect(PluginUiResultSchema.safeParse(result).success).toBe(false);
        result.effects = [
            { id: 'one', kind: 'storage.document.transact', payload: { schema: 'axiom.plugin-storage-transaction', schemaVersion: 1, scope: 'portfolio', expectedPortfolioRevision: 7, operations: [{ operationId: 'a', kind: 'delete', key: 'a', expectedDocumentVersion: null }] } },
            { id: 'two', kind: 'storage.document.transact', payload: { schema: 'axiom.plugin-storage-transaction', schemaVersion: 1, scope: 'portfolio', expectedPortfolioRevision: 7, operations: [{ operationId: 'b', kind: 'delete', key: 'b', expectedDocumentVersion: null }] } },
        ];
        expect(PluginUiResultSchema.safeParse(result).success).toBe(false);
    });
});
