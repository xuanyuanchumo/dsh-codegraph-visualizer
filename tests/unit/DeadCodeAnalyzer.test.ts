import { describe, it, expect } from 'vitest';
import { DeadCodeAnalyzer } from '../../src/shared/analysis/DeadCodeAnalyzer.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { makeNode, makeEdge } from '../helpers.ts';

describe('DeadCodeAnalyzer', () => {
  const analyzer = new DeadCodeAnalyzer();

  it('returns empty result for empty input', () => {
    const result = analyzer.analyze([], []);
    expect(result.deadNodes).toHaveLength(0);
    expect(result.stats.total).toBe(0);
  });

  it('identifies no-incoming nodes (suspected dead code)', () => {
    const main = makeNode('main', 'main', 'function', '/app.ts', 1);
    const unused = makeNode('unused', 'unusedFunc', 'function', '/util.ts', 5);
    const nodes = [main, unused];
    const edges: GraphEdge[] = [];

    const result = analyzer.analyze(nodes, edges);
    expect(result.deadNodes).toHaveLength(1);
    expect(result.deadNodes[0]!.nodeId).toBe('unused');
    expect(result.deadNodes[0]!.category).toBe('no-incoming');
    expect(result.deadNodes[0]!.confidence).toBe('suspected');
  });

  it('does not mark entry points as dead code', () => {
    const main = makeNode('main', 'main', 'function', '/app.ts', 1);
    const handler = makeNode('handler', 'handleRequest', 'function', '/server.ts', 1);
    const exported = makeNode('exp', 'exportedFunc', 'function', '/lib.ts', 1, { isExported: true });
    const nodes = [main, handler, exported];
    const edges: GraphEdge[] = [];

    const result = analyzer.analyze(nodes, edges);
    expect(result.deadNodes).toHaveLength(0);
    expect(result.entryNodes.length).toBeGreaterThanOrEqual(3);
  });

  it('identifies orphan subgraphs (confirmed dead code)', () => {
    const main = makeNode('main', 'main', 'function', '/app.ts', 1);
    const orphanA = makeNode('orphanA', 'orphanA', 'function', '/dead.ts', 1);
    const orphanB = makeNode('orphanB', 'orphanB', 'function', '/dead.ts', 10);
    const nodes = [main, orphanA, orphanB];
    const edges: GraphEdge[] = [
      makeEdge('e1', 'orphanA', 'orphanB', 'call'),
    ];

    const result = analyzer.analyze(nodes, edges);
    expect(result.deadNodes).toHaveLength(2);
    expect(result.deadNodes.find((d) => d.nodeId === 'orphanA')?.category).toBe('no-incoming');
    expect(result.deadNodes.find((d) => d.nodeId === 'orphanB')?.category).toBe('orphan');
    expect(result.deadNodes.find((d) => d.nodeId === 'orphanB')?.confidence).toBe('confirmed');
  });

  it('identifies unreachable nodes from entry points', () => {
    const main = makeNode('main', 'main', 'function', '/app.ts', 1);
    const reachable = makeNode('reachable', 'helper', 'function', '/util.ts', 1);
    const unreachable = makeNode('unreachable', 'deadHelper', 'function', '/dead.ts', 1);
    const nodes = [main, reachable, unreachable];
    const edges: GraphEdge[] = [
      makeEdge('e1', 'main', 'reachable', 'call'),
    ];

    const result = analyzer.analyze(nodes, edges);
    expect(result.deadNodes).toHaveLength(1);
    expect(result.deadNodes[0]!.nodeId).toBe('unreachable');
    expect(result.deadNodes[0]!.category).toBe('no-incoming');
  });

  it('keeps module nodes as entry points but not their containment as liveness', () => {
    const mod = makeNode('mod1', 'myModule', 'module', '/index.ts', 1);
    const uncalled = makeNode('func1', 'myFunc', 'function', '/index.ts', 5);
    const nodes = [mod, uncalled];
    const edges: GraphEdge[] = [
      makeEdge('e1', 'mod1', 'func1', 'contains'),
    ];

    const result = analyzer.analyze(nodes, edges);
    expect(result.entryNodes).toContain('mod1');
    // Containment is structure, not usage: nothing references the symbol, so it is
    // suspected dead code instead of being silently kept alive by its module.
    expect(result.deadNodes).toHaveLength(1);
    expect(result.deadNodes[0]!.nodeId).toBe('func1');
    expect(result.deadNodes[0]!.category).toBe('no-incoming');
    expect(result.deadNodes[0]!.confidence).toBe('suspected');
  });

  it('keeps a contained symbol alive when a reference edge reaches it', () => {
    const mod = makeNode('mod1', 'myModule', 'module', '/index.ts', 1);
    const exported = makeNode('exp', 'exportedFunc', 'function', '/index.ts', 3, { isExported: true });
    const helper = makeNode('helper', 'helper', 'function', '/index.ts', 8);
    const nodes = [mod, exported, helper];
    const edges: GraphEdge[] = [
      makeEdge('e1', 'mod1', 'exported', 'contains'),
      makeEdge('e2', 'mod1', 'helper', 'contains'),
      makeEdge('e3', 'exp', 'helper', 'call'),
    ];

    const result = analyzer.analyze(nodes, edges);
    expect(result.deadNodes).toHaveLength(0);
  });

  it('reports reference degrees, not structural connection counts', () => {
    const mod = makeNode('mod1', 'myModule', 'module', '/index.ts', 1);
    const exported = makeNode('exp', 'exportedFunc', 'function', '/index.ts', 3, { isExported: true });
    const used = makeNode('used', 'usedHelper', 'function', '/index.ts', 5);
    const orphanNode = makeNode('orphan', 'orphanCaller', 'function', '/dead.ts', 9);
    const nodes = [mod, exported, used, orphanNode];
    const edges: GraphEdge[] = [
      makeEdge('e1', 'mod1', 'used', 'contains'),
      makeEdge('e2', 'mod1', 'orphan', 'contains'),
      makeEdge('e3', 'exp', 'used', 'call'),
      makeEdge('e4', 'orphan', 'used', 'call'),
    ];

    const result = analyzer.analyze(nodes, edges);
    // `orphanCaller` is contained by an entry module but nothing references it, so it is dead;
    // its single outgoing reference is reported while the `contains` edge is not counted.
    expect(result.deadNodes).toHaveLength(1);
    expect(result.deadNodes[0]!.nodeId).toBe('orphan');
    expect(result.deadNodes[0]!.inDegree).toBe(0);
    expect(result.deadNodes[0]!.outDegree).toBe(1);
  });

  it('surfaces a containment-only graph that used to report nothing (J0 Round 11)', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 5; i++) {
      nodes.push(makeNode(`mod${i}`, `module${i}`, 'module', `/m${i}.ts`, 1));
      nodes.push(makeNode(`fn${i}`, `helper${i}`, 'function', `/m${i}.ts`, 4));
      edges.push(makeEdge(`c${i}`, `mod${i}`, `fn${i}`, 'contains'));
    }

    const result = analyzer.analyze(nodes, edges);
    expect(result.deadNodes).toHaveLength(5);
    expect(result.stats.suspected).toBe(5);
    expect(result.stats.confirmed).toBe(0);
  });

  it('computes stats correctly', () => {
    const main = makeNode('main', 'main', 'function', '/app.ts', 1);
    const suspected = makeNode('suspected', 'unused', 'function', '/util.ts', 1);
    const orphan = makeNode('orphan', 'orphan', 'function', '/dead.ts', 1);
    const orphanCaller = makeNode('caller', 'caller', 'function', '/dead.ts', 10);
    const nodes = [main, suspected, orphan, orphanCaller];
    const edges: GraphEdge[] = [
      makeEdge('e1', 'orphan', 'caller', 'call'),
    ];

    const result = analyzer.analyze(nodes, edges);
    expect(result.stats.total).toBe(3);
    expect(result.stats.suspected).toBe(2);
    expect(result.stats.confirmed).toBe(1);
    expect(result.stats.byCategory['no-incoming']).toBe(2);
    expect(result.stats.byCategory.orphan).toBe(1);
  });

  it('sorts dead nodes by confidence (confirmed first)', () => {
    const main = makeNode('main', 'main', 'function', '/app.ts', 1);
    const suspected = makeNode('suspected', 'unused', 'function', '/util.ts', 1);
    const orphan = makeNode('orphan', 'orphan', 'function', '/dead.ts', 1);
    const orphanCaller = makeNode('caller', 'caller', 'function', '/dead.ts', 10);
    const nodes = [main, suspected, orphan, orphanCaller];
    const edges: GraphEdge[] = [
      makeEdge('e1', 'orphan', 'caller', 'call'),
    ];

    const result = analyzer.analyze(nodes, edges);
    expect(result.deadNodes[0]!.confidence).toBe('confirmed');
  });

  it('handles handler pattern as entry point', () => {
    const handler = makeNode('h1', 'handleRequest', 'function', '/server.ts', 1);
    const dead = makeNode('d1', 'deadFunc', 'function', '/util.ts', 1);
    const nodes = [handler, dead];
    const edges: GraphEdge[] = [];

    const result = analyzer.analyze(nodes, edges);
    expect(result.deadNodes).toHaveLength(1);
    expect(result.deadNodes[0]!.nodeId).toBe('d1');
  });

  it('handles event pattern as entry point', () => {
    const listener = makeNode('l1', 'onClick', 'function', '/ui.ts', 1);
    const dead = makeNode('d1', 'deadFunc', 'function', '/util.ts', 1);
    const nodes = [listener, dead];
    const edges: GraphEdge[] = [];

    const result = analyzer.analyze(nodes, edges);
    expect(result.deadNodes).toHaveLength(1);
    expect(result.deadNodes[0]!.nodeId).toBe('d1');
  });

  it('handles CLI pattern as entry point', () => {
    const cli = makeNode('c1', 'main', 'function', '/cli.ts', 1);
    const dead = makeNode('d1', 'deadFunc', 'function', '/util.ts', 1);
    const nodes = [cli, dead];
    const edges: GraphEdge[] = [];

    const result = analyzer.analyze(nodes, edges);
    expect(result.deadNodes).toHaveLength(1);
    expect(result.deadNodes[0]!.nodeId).toBe('d1');
  });
});