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

  it('marks module nodes as entry points', () => {
    const mod = makeNode('mod1', 'myModule', 'module', '/index.ts', 1);
    const func = makeNode('func1', 'myFunc', 'function', '/index.ts', 5);
    const nodes = [mod, func];
    const edges: GraphEdge[] = [
      makeEdge('e1', 'mod1', 'func1', 'contains'),
    ];

    const result = analyzer.analyze(nodes, edges);
    expect(result.deadNodes).toHaveLength(0);
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