import { describe, it, expect } from 'vitest';
import { computeDirectoryClusters } from '../../src/client/store/cluster/directoryCluster.ts';
import { makeNode, makeEdge } from '../helpers.ts';

describe('computeDirectoryClusters', () => {
  it('clusters nodes by top-level directory when not expanded', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/mod1/b.ts', 2),
      makeNode('n3', 'C', 'function', 'src/mod2/c.ts', 3),
    ];
    const result = computeDirectoryClusters(nodes, [], new Set());
    const clusterNodes = result.nodes.filter((n) => 'isCluster' in n && n.isCluster);
    expect(clusterNodes.length).toBe(2);
    for (const c of clusterNodes) {
      const cluster = c as { isCluster: true; childCount: number; clusterLevel: string };
      expect(cluster.clusterLevel).toBe('directory');
    }
  });

  it('expands directory cluster when cluster id in expandedDirs', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/mod1/b.ts', 2),
    ];
    const clusterId = 'cluster__src__mod1';
    const result = computeDirectoryClusters(nodes, [], new Set([clusterId]));
    const dirClusters = result.nodes.filter((n) =>
      'isCluster' in n && n.isCluster && (n as { clusterLevel?: string }).clusterLevel === 'directory',
    );
    expect(dirClusters).toHaveLength(0);
  });

  it('expands directory cluster when dirPath in expandedDirs', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
    ];
    const result = computeDirectoryClusters(nodes, [], new Set(['src/mod1']));
    const dirClusters = result.nodes.filter((n) =>
      'isCluster' in n && n.isCluster && (n as { clusterLevel?: string }).clusterLevel === 'directory',
    );
    expect(dirClusters).toHaveLength(0);
  });

  it('creates file-level clusters within expanded directory', () => {
    const parent = makeNode('file1', 'a.ts', 'module', 'src/mod1/a.ts', 0);
    const child1 = makeNode('fn1', 'foo', 'function', 'src/mod1/a.ts', 1, {}, 'file1');
    const child2 = makeNode('fn2', 'bar', 'function', 'src/mod1/a.ts', 5, {}, 'file1');
    const nodes = [parent, child1, child2];
    const clusterId = 'cluster__src__mod1';
    const result = computeDirectoryClusters(nodes, [], new Set([clusterId]));
    const fileClusters = result.nodes.filter((n) =>
      'isCluster' in n && n.isCluster && (n as { clusterLevel?: string }).clusterLevel === 'file',
    );
    expect(fileClusters.length).toBe(1);
  });

  it('expands file cluster within directory when filecluster id in expandedDirs', () => {
    const parent = makeNode('file1', 'a.ts', 'module', 'src/mod1/a.ts', 0);
    const child = makeNode('fn1', 'foo', 'function', 'src/mod1/a.ts', 1, {}, 'file1');
    const nodes = [parent, child];
    const dirClusterId = 'cluster__src__mod1';
    const fileClusterId = 'filecluster__file1';
    const result = computeDirectoryClusters(nodes, [], new Set([dirClusterId, fileClusterId]));
    const fileClusters = result.nodes.filter((n) =>
      'isCluster' in n && n.isCluster && (n as { clusterLevel?: string }).clusterLevel === 'file',
    );
    expect(fileClusters).toHaveLength(0);
  });

  it('handles module nodes within directory (kept as-is)', () => {
    const nodes = [makeNode('m1', 'mod.ts', 'module', 'src/mod1/mod.ts', 0)];
    const result = computeDirectoryClusters(nodes, [], new Set(['cluster__src__mod1']));
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.id).toBe('m1');
  });

  it('handles crates/ paths', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'crates/core/a.ts', 1),
      makeNode('n2', 'B', 'function', 'crates/core/b.ts', 2),
      makeNode('n3', 'C', 'function', 'crates/utils/c.ts', 3),
    ];
    const result = computeDirectoryClusters(nodes, [], new Set());
    const clusterNodes = result.nodes.filter((n) => 'isCluster' in n && n.isCluster);
    expect(clusterNodes.length).toBe(2);
  });

  it('handles Windows drive letter paths', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'C:/proj/src/mod1/a.ts', 1),
      makeNode('n2', 'B', 'function', 'C:/proj/src/mod1/b.ts', 2),
    ];
    const result = computeDirectoryClusters(nodes, [], new Set());
    const clusterNodes = result.nodes.filter((n) => 'isCluster' in n && n.isCluster);
    expect(clusterNodes.length).toBe(1);
  });

  it('handles short file paths (<=2 segments)', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const result = computeDirectoryClusters(nodes, [], new Set());
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('aggregates edges between directory clusters', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/mod2/b.ts', 2),
    ];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const result = computeDirectoryClusters(nodes, edges, new Set());
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves edges within expanded directories', () => {
    const nodes = [
      makeNode('n1', 'A', 'function', 'src/mod1/a.ts', 1),
      makeNode('n2', 'B', 'function', 'src/mod1/b.ts', 2),
    ];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const result = computeDirectoryClusters(nodes, edges, new Set(['cluster__src__mod1']));
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('handles node with empty filePath', () => {
    const nodes = [makeNode('n1', 'A', 'function', '', 1)];
    const result = computeDirectoryClusters(nodes, [], new Set());
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
  });
});