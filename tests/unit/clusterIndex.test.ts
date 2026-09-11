import { describe, it, expect } from 'vitest';
import { computeClusteredGraph, registerClusterStrategy } from '../../src/client/store/cluster/index.ts';
import type { ClusterStrategy } from '../../src/client/store/cluster/ClusterStrategy.ts';
import { makeNode, makeEdge } from '../helpers.ts';

describe('computeClusteredGraph', () => {
  it('throws for unknown cluster level', () => {
    expect(() => computeClusteredGraph([], [], 'unknown', new Set())).toThrow();
  });

  it('computes progressive clusters with depth 0 (directory level)', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/mod2/b.ts', 2),
    ];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const result = computeClusteredGraph(nodes, edges, 'progressive', new Set(), 0);
    expect(result.nodes.length).toBeGreaterThan(0);
    const clusterNodes = result.nodes.filter((n) => 'isCluster' in n && n.isCluster);
    expect(clusterNodes.length).toBeGreaterThan(0);
  });

  it('computes progressive clusters with depth 1 (file level)', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/mod1/a.ts', 2, {}, 'n1'),
    ];
    const result = computeClusteredGraph(nodes, [], 'progressive', new Set(), 1);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('computes progressive clusters with depth 2 (function level)', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/mod1/a.ts', 2),
    ];
    const result = computeClusteredGraph(nodes, [], 'progressive', new Set(), 2);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('computes progressive clusters with default depth', () => {
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
    registerClusterStrategy('custom', customStrategy);
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const edges = [makeEdge('e1', 'n1', 'n1', 'call')];
    const result = computeClusteredGraph(nodes, edges, 'custom', new Set());
    expect(result.nodes).toBe(nodes);
    expect(result.edges).toBe(edges);
  });
});
