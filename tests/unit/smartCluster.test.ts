import { describe, it, expect } from 'vitest';
import { computeSmartClusters } from '../../src/client/store/cluster/smartCluster.ts';
import { SmartClusterStrategy } from '../../src/client/store/cluster/SmartClusterStrategy.ts';
import { makeNode, makeEdge } from '../helpers.ts';

describe('computeSmartClusters', () => {
  it('returns empty result for empty nodes', () => {
    const result = computeSmartClusters([], [], new Set());
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('keeps isolated nodes as-is (no cluster)', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/b.ts', 2),
    ];
    const result = computeSmartClusters(nodes, [], new Set());
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.some((n) => 'isCluster' in n && n.isCluster)).toBe(false);
  });

  it('clusters connected nodes when not expanded', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/b.ts', 2),
      makeNode('n3', 'C', 'function', 'src/c.ts', 3),
    ];
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n2', 'n3', 'call'),
    ];
    const result = computeSmartClusters(nodes, edges, new Set());
    const clusterNodes = result.nodes.filter((n) => 'isCluster' in n && n.isCluster);
    expect(clusterNodes.length).toBeGreaterThanOrEqual(1);
    const cluster = clusterNodes[0] as { isCluster: true; childCount: number; childIds: string[] };
    expect(cluster.childCount).toBe(3);
    expect(cluster.childIds).toHaveLength(3);
  });

  it('expands cluster when cluster id is in expandedNodeIds', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/b.ts', 2),
    ];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const collapsed = computeSmartClusters(nodes, edges, new Set());
    const cluster = collapsed.nodes.find((n) => 'isCluster' in n && n.isCluster) as
      { isCluster: true; id: string } | undefined;
    expect(cluster).toBeDefined();
    const expanded = new Set<string>([cluster!.id]);
    const result = computeSmartClusters(nodes, edges, expanded);
    const clusterNodes = result.nodes.filter((n) => 'isCluster' in n && n.isCluster);
    expect(clusterNodes).toHaveLength(0);
    expect(result.nodes).toHaveLength(2);
  });

  it('aggregates edges between clusters', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/b.ts', 2),
      makeNode('n3', 'C', 'function', 'src/c.ts', 3),
      makeNode('n4', 'D', 'function', 'src/d.ts', 4),
    ];
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n3', 'n4', 'call'),
      makeEdge('e3', 'n1', 'n3', 'import'),
    ];
    const result = computeSmartClusters(nodes, edges, new Set());
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('uses primary node label and file for cluster', () => {
    const nodes = [
      makeNode('n1', 'MyFunc', 'function', 'src/myFile.ts', 1),
      makeNode('n2', 'Other', 'function', 'src/other.ts', 2),
    ];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const result = computeSmartClusters(nodes, edges, new Set());
    const cluster = result.nodes.find((n) => 'isCluster' in n && n.isCluster) as
      { isCluster: true; label: string; type: string; filePath: string } | undefined;
    expect(cluster).toBeDefined();
    expect(cluster!.label).toContain('MyFunc');
    expect(cluster!.type).toBe('function');
  });

  it('handles single node with no edges', () => {
    const nodes = [makeNode('n1', 'Solo', 'function', 'src/solo.ts', 1)];
    const result = computeSmartClusters(nodes, [], new Set());
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.id).toBe('n1');
  });

  it('preserves edges between non-clustered (isolated) nodes', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/b.ts', 2),
    ];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const collapsed = computeSmartClusters(nodes, edges, new Set());
    const cluster = collapsed.nodes.find((n) => 'isCluster' in n && n.isCluster) as
      { isCluster: true; id: string } | undefined;
    expect(cluster).toBeDefined();
    const expanded = new Set<string>([cluster!.id]);
    const result = computeSmartClusters(nodes, edges, expanded);
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SmartClusterStrategy', () => {
  it('delegates to computeSmartClusters', () => {
    const strategy = new SmartClusterStrategy();
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/b.ts', 2),
    ];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const result = strategy.compute(nodes, edges, new Set());
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for empty input', () => {
    const strategy = new SmartClusterStrategy();
    const result = strategy.compute([], [], new Set());
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});