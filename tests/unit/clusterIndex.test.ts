import { describe, it, expect } from 'vitest';
import { computeClusteredGraph, registerClusterStrategy } from '../../src/client/store/cluster/index.ts';
import type { ClusterStrategy } from '../../src/client/store/cluster/ClusterStrategy.ts';
import { makeNode, makeEdge } from '../helpers.ts';

describe('computeClusteredGraph', () => {
  it('throws for unknown cluster level', () => {
    expect(() => computeClusteredGraph([], [], 'directory' as never, new Set())).not.toThrow();
  });

  it('computes directory clusters', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/mod2/b.ts', 2),
    ];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const result = computeClusteredGraph(nodes, edges, 'directory', new Set());
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('computes file clusters', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/mod1/a.ts', 2, {}, 'n1'),
    ];
    const result = computeClusteredGraph(nodes, [], 'file', new Set());
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('computes function clusters', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/mod1/a.ts', 2),
    ];
    const result = computeClusteredGraph(nodes, [], 'function', new Set());
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('computes progressive clusters', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/mod1/a.ts', 2),
    ];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const result = computeClusteredGraph(nodes, edges, 'progressive', new Set());
    expect(result.nodes.length).toBeGreaterThan(0);
  });
});

describe('registerClusterStrategy', () => {
  it('registers a custom strategy', () => {
    const customStrategy: ClusterStrategy = {
      compute: (nodes, edges) => ({ nodes, edges }),
    };
    registerClusterStrategy('directory', customStrategy);
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const edges = [makeEdge('e1', 'n1', 'n1', 'call')];
    const result = computeClusteredGraph(nodes, edges, 'directory', new Set());
    expect(result.nodes).toBe(nodes);
    expect(result.edges).toBe(edges);
  });
});