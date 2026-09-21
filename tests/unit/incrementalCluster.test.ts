import { describe, it, expect } from 'vitest';
import { computeIncrementalClusters, type IncrementalClusterContext } from '../../src/client/store/cluster/incrementalCluster.ts';
import { computeProgressiveClusters } from '../../src/client/store/cluster/progressiveCluster.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeNode(id: string, filePath: string, type: string = 'function'): GraphNode {
  return {
    id: NodeId(id),
    label: id,
    type: type as GraphNode['type'],
    filePath,
    lineNumber: 1,
    properties: {},
  };
}

function makeEdge(id: string, source: string, target: string, type: string = 'call'): GraphEdge {
  return {
    id: EdgeId(id),
    source: NodeId(source),
    target: NodeId(target),
    type: type as GraphEdge['type'],
    properties: {},
  };
}

function buildContext(
  prevResult: { nodes: (GraphNode | ClusterNode)[]; edges: (GraphEdge | ClusterEdge)[] },
  prevNodeIdToVisibleId: Map<string, string>,
  prevRawNodes: GraphNode[],
  prevRawEdges: GraphEdge[],
): IncrementalClusterContext {
  return { prevResult, prevNodeIdToVisibleId, prevRawNodes, prevRawEdges };
}

type ClusterNode = import('../../src/client/store/cluster/types.ts').ClusterNode;
type ClusterEdge = import('../../src/client/store/cluster/types.ts').ClusterEdge;

describe('computeIncrementalClusters', () => {
  it('returns null when prevRawNodes is too small', () => {
    const prevNodes: GraphNode[] = [];
    for (let i = 0; i < 50; i++) prevNodes.push(makeNode(`n${i}`, `src/file${i}.ts`));
    const prevEdges: GraphEdge[] = [];
    const result = computeProgressiveClusters(prevNodes, prevEdges, new Set(), 0);
    const ctx = buildContext(result, new Map(), prevNodes, prevEdges);
    const incremental = computeIncrementalClusters(ctx, prevNodes, prevEdges, new Set(), 0);
    expect(incremental).toBeNull();
  });

  it('returns null when change ratio exceeds threshold', () => {
    const prevNodes: GraphNode[] = [];
    for (let i = 0; i < 200; i++) prevNodes.push(makeNode(`n${i}`, `src/file${i}.ts`));
    const prevEdges: GraphEdge[] = [];
    const result = computeProgressiveClusters(prevNodes, prevEdges, new Set(), 0);
    const nodeIdToVisibleId = new Map<string, string>();
    for (const n of result.nodes) {
      if ('isCluster' in n && n.isCluster) {
        for (const childId of n.childIds) nodeIdToVisibleId.set(childId, n.id);
      } else {
        nodeIdToVisibleId.set(n.id, n.id);
      }
    }
    const ctx = buildContext(result, nodeIdToVisibleId, prevNodes, prevEdges);

    const newNodes: GraphNode[] = [...prevNodes];
    for (let i = 200; i < 300; i++) newNodes.push(makeNode(`n${i}`, `src/file${i}.ts`));
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 0);
    expect(incremental).toBeNull();
  });

  it('produces same result as full computation for small additions', () => {
    const prevNodes: GraphNode[] = [];
    for (let i = 0; i < 200; i++) prevNodes.push(makeNode(`n${i}`, `src/file${i}.ts`));
    const prevEdges: GraphEdge[] = [
      makeEdge('e1', 'n0', 'n1'),
      makeEdge('e2', 'n1', 'n2'),
    ];
    const result = computeProgressiveClusters(prevNodes, prevEdges, new Set(), 0);
    const nodeIdToVisibleId = new Map<string, string>();
    for (const n of result.nodes) {
      if ('isCluster' in n && n.isCluster) {
        for (const childId of n.childIds) nodeIdToVisibleId.set(childId, n.id);
      } else {
        nodeIdToVisibleId.set(n.id, n.id);
      }
    }
    const ctx = buildContext(result, nodeIdToVisibleId, prevNodes, prevEdges);

    const newNodes = [...prevNodes, makeNode('n200', 'src/file200.ts')];
    const newEdges = [...prevEdges, makeEdge('e3', 'n200', 'n0')];
    const incremental = computeIncrementalClusters(ctx, newNodes, newEdges, new Set(), 0);
    expect(incremental).not.toBeNull();
    expect(incremental!.nodes.length).toBeGreaterThan(0);
    expect(incremental!.edges.length).toBeGreaterThan(0);
  });

  it('handles removed nodes correctly', () => {
    const prevNodes: GraphNode[] = [];
    for (let i = 0; i < 200; i++) prevNodes.push(makeNode(`n${i}`, `src/file${i}.ts`));
    const prevEdges: GraphEdge[] = [makeEdge('e1', 'n0', 'n1')];
    const result = computeProgressiveClusters(prevNodes, prevEdges, new Set(), 0);
    const nodeIdToVisibleId = new Map<string, string>();
    for (const n of result.nodes) {
      if ('isCluster' in n && n.isCluster) {
        for (const childId of n.childIds) nodeIdToVisibleId.set(childId, n.id);
      } else {
        nodeIdToVisibleId.set(n.id, n.id);
      }
    }
    const ctx = buildContext(result, nodeIdToVisibleId, prevNodes, prevEdges);

    const newNodes = prevNodes.filter((n) => n.id !== 'n199');
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 0);
    expect(incremental).not.toBeNull();
  });

  it('returns null when visible nodes exceed maxVisibleNodes', () => {
    const prevNodes: GraphNode[] = [];
    for (let i = 0; i < 4600; i++) prevNodes.push(makeNode(`n${i}`, `src/file${i}.ts`));
    const prevEdges: GraphEdge[] = [];
    const result = computeProgressiveClusters(prevNodes, prevEdges, new Set(), 2);
    const nodeIdToVisibleId = new Map<string, string>();
    for (const n of result.nodes) {
      if ('isCluster' in n && n.isCluster) {
        for (const childId of n.childIds) nodeIdToVisibleId.set(childId, n.id);
      } else {
        nodeIdToVisibleId.set(n.id, n.id);
      }
    }
    const ctx = buildContext(result, nodeIdToVisibleId, prevNodes, prevEdges);

    const newNodes: GraphNode[] = [...prevNodes];
    for (let i = 4600; i < 4620; i++) newNodes.push(makeNode(`n${i}`, `src/file${i}.ts`));
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 2, 800);
    expect(incremental).toBeNull();
  });

  it('returns null when prevResult is empty', () => {
    const ctx = buildContext({ nodes: [], edges: [] }, new Map(), [], []);
    const incremental = computeIncrementalClusters(ctx, [], [], new Set(), 0);
    expect(incremental).toBeNull();
  });
});