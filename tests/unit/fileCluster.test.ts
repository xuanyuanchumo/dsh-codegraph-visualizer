import { describe, it, expect } from 'vitest';
import { computeFileClusters } from '../../src/client/store/cluster/fileCluster.ts';
import { FileClusterStrategy } from '../../src/client/store/cluster/FileClusterStrategy.ts';
import { makeNode, makeEdge } from '../helpers.ts';

describe('computeFileClusters', () => {
  it('keeps module nodes as-is', () => {
    const nodes = [makeNode('m1', 'module.ts', 'module', 'src/module.ts', 0)];
    const result = computeFileClusters(nodes, [], new Set());
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.id).toBe('m1');
  });

  it('clusters nodes by filePath fallback when parentId missing', () => {
    const nodes = [makeNode('n1', 'root', 'function', 'src/root.ts', 1)];
    const result = computeFileClusters(nodes, [], new Set());
    const cluster = result.nodes.find((n) => 'isCluster' in n && n.isCluster) as
      { isCluster: true; label: string; childCount: number } | undefined;
    expect(cluster).toBeDefined();
    expect(cluster!.childCount).toBe(1);
    expect(cluster!.label).toContain('root');
  });

  it('keeps nodes without parentId and filePath as-is', () => {
    const node = makeNode('n1', 'root', 'function', '', 1);
    const result = computeFileClusters([node], [], new Set());
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.id).toBe('n1');
  });

  it('clusters child nodes by parent file when not expanded', () => {
    const parent = makeNode('file1', 'a.ts', 'module', 'src/a.ts', 0);
    const child1 = makeNode('fn1', 'foo', 'function', 'src/a.ts', 1, {}, 'file1');
    const child2 = makeNode('fn2', 'bar', 'function', 'src/a.ts', 5, {}, 'file1');
    const nodes = [parent, child1, child2];
    const result = computeFileClusters(nodes, [], new Set());
    const clusterNodes = result.nodes.filter((n) => 'isCluster' in n && n.isCluster);
    expect(clusterNodes).toHaveLength(1);
    const cluster = clusterNodes[0] as { isCluster: true; childCount: number; label: string };
    expect(cluster.childCount).toBe(2);
    expect(cluster.label).toContain('a.ts');
  });

  it('expands file cluster when fileClusterId in expandedFiles', () => {
    const parent = makeNode('file1', 'a.ts', 'module', 'src/a.ts', 0);
    const child1 = makeNode('fn1', 'foo', 'function', 'src/a.ts', 1, {}, 'file1');
    const nodes = [parent, child1];
    const fileClusterId = 'filecluster__file1';
    const result = computeFileClusters(nodes, [], new Set([fileClusterId]));
    const clusterNodes = result.nodes.filter((n) => 'isCluster' in n && n.isCluster);
    expect(clusterNodes).toHaveLength(0);
    expect(result.nodes).toHaveLength(2);
  });

  it('expands file cluster when parentFileId in expandedFiles', () => {
    const parent = makeNode('file1', 'a.ts', 'module', 'src/a.ts', 0);
    const child1 = makeNode('fn1', 'foo', 'function', 'src/a.ts', 1, {}, 'file1');
    const nodes = [parent, child1];
    const result = computeFileClusters(nodes, [], new Set(['file1']));
    const clusterNodes = result.nodes.filter((n) => 'isCluster' in n && n.isCluster);
    expect(clusterNodes).toHaveLength(0);
  });

  it('uses parent node label for cluster label', () => {
    const parent = makeNode('file1', 'myModule.ts', 'module', 'src/myModule.ts', 0);
    const child = makeNode('fn1', 'foo', 'function', 'src/myModule.ts', 1, {}, 'file1');
    const nodes = [parent, child];
    const result = computeFileClusters(nodes, [], new Set());
    const cluster = result.nodes.find((n) => 'isCluster' in n && n.isCluster) as
      { isCluster: true; label: string } | undefined;
    expect(cluster).toBeDefined();
    expect(cluster!.label).toContain('myModule.ts');
  });

  it('uses fallback label from parentFileId when parent node missing', () => {
    const child = makeNode('fn1', 'foo', 'function', 'src/a.ts', 1, {}, 'missingParent');
    const nodes = [child];
    const result = computeFileClusters(nodes, [], new Set());
    const cluster = result.nodes.find((n) => 'isCluster' in n && n.isCluster) as
      { isCluster: true; label: string } | undefined;
    expect(cluster).toBeDefined();
    expect(cluster!.label).toContain('missingParent');
  });

  it('aggregates edges between file clusters', () => {
    const parentA = makeNode('fileA', 'a.ts', 'module', 'src/a.ts', 0);
    const parentB = makeNode('fileB', 'b.ts', 'module', 'src/b.ts', 0);
    const fnA = makeNode('fnA', 'foo', 'function', 'src/a.ts', 1, {}, 'fileA');
    const fnB = makeNode('fnB', 'bar', 'function', 'src/b.ts', 1, {}, 'fileB');
    const nodes = [parentA, parentB, fnA, fnB];
    const edges = [makeEdge('e1', 'fnA', 'fnB', 'call')];
    const result = computeFileClusters(nodes, edges, new Set());
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('handles nodes with special characters in parentId', () => {
    const parent = makeNode('src:path:file', 'a.ts', 'module', 'src/a.ts', 0);
    const child = makeNode('fn1', 'foo', 'function', 'src/a.ts', 1, {}, 'src:path:file');
    const nodes = [parent, child];
    const result = computeFileClusters(nodes, [], new Set());
    const cluster = result.nodes.find((n) => 'isCluster' in n && n.isCluster);
    expect(cluster).toBeDefined();
  });
});

describe('FileClusterStrategy', () => {
  it('delegates to computeFileClusters', () => {
    const strategy = new FileClusterStrategy();
    const parent = makeNode('file1', 'a.ts', 'module', 'src/a.ts', 0);
    const child = makeNode('fn1', 'foo', 'function', 'src/a.ts', 1, {}, 'file1');
    const nodes = [parent, child];
    const result = strategy.compute(nodes, [], new Set());
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('returns module nodes as-is', () => {
    const strategy = new FileClusterStrategy();
    const nodes = [makeNode('m1', 'mod.ts', 'module', 'src/mod.ts', 0)];
    const result = strategy.compute(nodes, [], new Set());
    expect(result.nodes).toHaveLength(1);
  });
});