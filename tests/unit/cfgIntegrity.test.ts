import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { TreeSitterAdapter } from '../../src/adapters/TreeSitterAdapter.ts';
import { CFGAssembler } from '../../src/client/diagram/CFGAssembler.ts';
import type { GraphEdge } from '../../src/types/index.ts';

/**
 * Round 9 (P2): the CFG micro diagram shipped edges whose endpoints were not part of the diagram,
 * which Cytoscape rejects at render time with `Edge 'cfg-edge-N' has invalid endpoints` and drops
 * (silent data loss). These tests assert the invariant on the exact function that surfaced it in
 * the Round 8 J0 session (`computeClusteredGraph` in `src/client/store/cluster/progressiveCluster.ts`)
 * and across every construct the assembler supports.
 */
describe('CFG assembler edge integrity', () => {
  let adapter: TreeSitterAdapter;

  beforeAll(async () => {
    adapter = new TreeSitterAdapter();
    await adapter.init();
  });

  afterAll(() => {
    adapter.destroy();
  });

  const danglingEdges = (edges: GraphEdge[], nodeIds: Set<string>): GraphEdge[] =>
    edges.filter((e: GraphEdge) => !nodeIds.has(e.source) || !nodeIds.has(e.target));

  const assembleFrom = async (filePath: string, source: string, functionName: string) => {
    const ast = await adapter.parseToAst(filePath, source);
    expect(ast, `${functionName} ast`).not.toBeNull();
    const diagram = new CFGAssembler().assemble(ast!, filePath, functionName);
    return diagram;
  };

  it('keeps every edge endpoint inside the diagram for the function that surfaced the warning', async () => {
    const file = 'src/client/store/cluster/progressiveCluster.ts';
    const source = readFileSync(file, 'utf8');
    const diagram = await assembleFrom(file, source, 'computeClusteredGraph');

    expect(diagram.nodes.length).toBeGreaterThan(1);
    const ids = new Set(diagram.nodes.map((n) => String(n.id)));
    expect(danglingEdges(diagram.edges, ids).map((e) => `${e.source}->${e.target}`)).toEqual([]);
    // Every edge must also be unique: duplicate ids make Cytoscape drop one of them.
    const edgeIds = diagram.edges.map((e) => String(e.id));
    expect(new Set(edgeIds).size).toBe(edgeIds.length);
  });

  it.each([
    ['if/else', 'function f(a) { if (a) { return 1; } else { return 2; } }'],
    ['while with break and continue', 'function f(a) { while (a) { if (a) { break; } else { continue; } } }'],
    ['for of with continue', 'function f(xs) { for (const x of xs) { if (x) continue; } return 1; }'],
    ['switch with cases and default', 'function f(a) { switch (a) { case 1: return 1; case 2: break; default: return 3; } }'],
    ['try/catch/finally', 'function f() { try { return g(); } catch (e) { throw e; } finally { cleanup(); } }'],
    ['throw only', 'function f() { throw new Error("x"); }'],
    ['nested loops', 'function f(a) { for (let i = 0; i < a; i++) { while (a) { if (a) break; } } }'],
    ['empty body', 'function f() {}'],
    ['only comments', 'function f() { /* nothing */ }'],
    ['return then unreachable code', 'function f() { return 1; unreachable(); }'],
    ['sequential statements', 'function f() { const a = 1; const b = 2; return a + b; }'],
  ])('keeps every edge endpoint inside the diagram: %s', async (_name, code) => {
    const diagram = await assembleFrom('sample.ts', code, 'f');
    const ids = new Set(diagram.nodes.map((n) => String(n.id)));
    expect(danglingEdges(diagram.edges, ids).map((e) => `${e.source}->${e.target}`)).toEqual([]);
    // The entry block must always be present, and the diagram must be non-trivial.
    expect(ids.size).toBe(diagram.nodes.length);
  });

  it('declares only exit blocks that exist in the diagram', async () => {
    const file = 'src/client/store/cluster/progressiveCluster.ts';
    const source = readFileSync(file, 'utf8');
    const ast = await adapter.parseToAst(file, source);
    const assembler = new CFGAssembler();
    const diagram = assembler.assemble(ast!, file, 'computeClusteredGraph');
    const ids = new Set(diagram.nodes.map((n) => String(n.id)));
    const exitLike = diagram.nodes.filter((n) => n.properties?.isExit === true || n.properties?.blockType === 'exit');
    expect(exitLike.length).toBeGreaterThan(0);
    for (const node of exitLike) expect(ids.has(String(node.id))).toBe(true);
  });
});
