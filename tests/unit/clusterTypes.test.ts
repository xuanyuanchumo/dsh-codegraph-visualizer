import { describe, it, expect } from 'vitest';
import { aggregateEdges, getDependencyGroup } from '../../src/client/store/cluster/types.ts';
import { makeEdge, makeNode } from '../helpers.ts';
import type { GraphEdge, GraphNode } from '../../src/types/index.ts';

describe('aggregateEdges', () => {
  it('skips edges when source or target not in nodeIdToVisibleId', () => {
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'c1']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    expect(result).toHaveLength(0);
  });

  it('skips self-loop edges where source and target map to same visible id', () => {
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'c1'], ['n2', 'c1']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    expect(result).toHaveLength(0);
  });

  it('aggregates multiple edges between same cluster pair into one ClusterEdge', () => {
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n1', 'n2', 'import'),
      makeEdge('e3', 'n1', 'n2', 'call'),
    ];
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'dircluster__c0'], ['n2', 'dircluster__c1']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    expect(result).toHaveLength(1);
    const edge = result[0] as GraphEdge & { isCluster: true; aggregatedCount: number };
    expect(edge.isCluster).toBe(true);
    expect(edge.aggregatedCount).toBe(3);
    expect(edge.source).toBe('dircluster__c0');
    expect(edge.target).toBe('dircluster__c1');
  });

  it('uses dependency type when multiple edge types are aggregated', () => {
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n1', 'n2', 'import'),
    ];
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'dircluster__c0'], ['n2', 'dircluster__c1']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    expect(result).toHaveLength(1);
    const edge = result[0] as GraphEdge;
    expect(edge.type).toBe('dependency');
  });

  it('uses single edge type when only one type is aggregated', () => {
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n1', 'n2', 'call'),
    ];
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'dircluster__c0'], ['n2', 'dircluster__c1']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    expect(result).toHaveLength(1);
    const edge = result[0] as GraphEdge;
    expect(edge.type).toBe('call');
  });

  it('keeps original edges when both endpoints are non-cluster nodes', () => {
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n1', 'n2', 'import'),
    ];
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'n1'], ['n2', 'n2']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('e1');
    expect(result[1]!.id).toBe('e2');
  });

  it('creates ClusterEdge when source is cluster and target is non-cluster', () => {
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'dircluster__c0'], ['n2', 'n2']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    expect(result).toHaveLength(1);
    const edge = result[0] as GraphEdge & { isCluster: boolean };
    expect(edge.isCluster).toBe(true);
  });

  it('creates ClusterEdge when target is cluster and source is non-cluster', () => {
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'n1'], ['n2', 'filecluster__c0']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    expect(result).toHaveLength(1);
    const edge = result[0] as GraphEdge & { isCluster: boolean };
    expect(edge.isCluster).toBe(true);
  });

  it('creates ClusterEdge with smartcluster prefix', () => {
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'smartcluster__c0'], ['n2', 'n2']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    expect(result).toHaveLength(1);
    const edge = result[0] as GraphEdge & { isCluster: boolean };
    expect(edge.isCluster).toBe(true);
  });

  it('handles mixed cluster and non-cluster edges', () => {
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n3', 'n4', 'import'),
      makeEdge('e3', 'n1', 'n4', 'call'),
    ];
    const nodeIdToVisibleId = new Map<string, string>([
      ['n1', 'dircluster__c0'],
      ['n2', 'dircluster__c1'],
      ['n3', 'n3'],
      ['n4', 'n4'],
    ]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    const clusterEdges = result.filter((e) => 'isCluster' in e && e.isCluster);
    const plainEdges = result.filter((e) => !('isCluster' in e) || !e.isCluster);
    expect(clusterEdges.length).toBeGreaterThanOrEqual(1);
    expect(plainEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for empty edges', () => {
    const result = aggregateEdges([], new Map(), 'dircluster__');
    expect(result).toHaveLength(0);
  });

  it('handles edges where some endpoints are missing from map', () => {
    const edges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n2', 'n3', 'call'),
    ];
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'n1'], ['n2', 'n2']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe('n1');
    expect(result[0]!.target).toBe('n2');
  });

  it('creates ClusterEdge when non-cluster edge count exceeds threshold (>20)', () => {
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 25; i++) {
      edges.push(makeEdge(`e${i}`, 'n1', 'n2', 'call'));
    }
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'n1'], ['n2', 'n2']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    expect(result).toHaveLength(1);
    const edge = result[0] as GraphEdge & { isCluster: boolean; aggregatedCount: number };
    expect(edge.isCluster).toBe(true);
    expect(edge.aggregatedCount).toBe(25);
  });

  it('keeps original edges when non-cluster edge count is at threshold (<=20)', () => {
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 20; i++) {
      edges.push(makeEdge(`e${i}`, 'n1', 'n2', 'call'));
    }
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'n1'], ['n2', 'n2']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'dircluster__');
    expect(result).toHaveLength(20);
    expect(result.every((e) => !('isCluster' in e) || !e.isCluster)).toBe(true);
  });

  it('creates ClusterEdge with funccluster prefix for non-cluster over threshold', () => {
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 25; i++) {
      edges.push(makeEdge(`e${i}`, 'n1', 'n2', 'call'));
    }
    const nodeIdToVisibleId = new Map<string, string>([['n1', 'n1'], ['n2', 'n2']]);
    const result = aggregateEdges(edges, nodeIdToVisibleId, 'funccluster__');
    expect(result).toHaveLength(1);
    const edge = result[0] as GraphEdge & { isCluster: boolean };
    expect(edge.isCluster).toBe(true);
  });
});

describe('getDependencyGroup', () => {
  it('returns dep group string when node has depType property', () => {
    const node = makeNode('n1', 'lodash', 'module', 'package.json', 0);
    node.properties = { depType: 'npm' };
    expect(getDependencyGroup(node)).toBe('dep:npm');
  });

  it('returns null when node has no depType property', () => {
    const node = makeNode('n1', 'foo', 'function', 'a.ts', 1);
    expect(getDependencyGroup(node)).toBeNull();
  });

  it('returns null when depType is not a string', () => {
    const node = makeNode('n1', 'foo', 'function', 'a.ts', 1);
    node.properties = { depType: 123 };
    expect(getDependencyGroup(node)).toBeNull();
  });

  it('returns null when properties is empty', () => {
    const node = makeNode('n1', 'foo', 'function', 'a.ts', 1);
    node.properties = {};
    expect(getDependencyGroup(node)).toBeNull();
  });
});