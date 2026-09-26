import { describe, it, expect } from 'vitest';
import { computeIncrementalClusters, tryIncrementalOrFull, type IncrementalClusterContext } from '../../src/client/store/cluster/incrementalCluster.ts';
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

  it('handles expanded directory cluster with new nodes', () => {
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

    const newNodes = [...prevNodes, makeNode('n200', 'src/file200.ts')];
    const clusterId = 'cluster__src';
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set([clusterId]), 0);
    expect(incremental).not.toBeNull();
  });

  it('returns null when expanded cluster has too many nodes for subgroup', () => {
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
    for (let i = 200; i < 800; i++) newNodes.push(makeNode(`n${i}`, `src/file${i}.ts`));
    const clusterId = 'cluster__src';
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set([clusterId]), 0);
    expect(incremental).toBeNull();
  });

  it('handles nodes with dependency group (depType property)', () => {
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

    const depNode = makeNode('n200', 'src/file200.ts');
    depNode.properties = { depType: 'react' };
    const newNodes = [...prevNodes, depNode];
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 0);
    expect(incremental).not.toBeNull();
    expect(incremental!.nodes.some(n => n.id === 'cluster__dep__react')).toBe(true);
  });

  it('handles nodes without filePath (uses node.id as dir)', () => {
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

    const noFilePathNode: GraphNode = {
      id: NodeId('n200'),
      label: 'n200',
      type: 'function',
      filePath: '',
      lineNumber: 1,
      properties: {},
    };
    const newNodes = [...prevNodes, noFilePathNode];
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 0);
    expect(incremental).not.toBeNull();
    expect(incremental!.nodes.some(n => n.id === 'cluster__n200')).toBe(true);
  });

  it('skips dir when prevIds contains the dir value', () => {
    const prevNodes: GraphNode[] = [];
    prevNodes.push(makeNode('src/file200.ts', 'src/special.ts'));
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

    const newNodes = [...prevNodes, makeNode('n200', 'src/file200.ts')];
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 0);
    expect(incremental).not.toBeNull();
  });

  it('uses dynamic maxVisibleNodes and autoClusterDepth with viewportWidth', () => {
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

    const newNodes = [...prevNodes, makeNode('n200', 'src/file200.ts')];
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 1, 1200);
    expect(incremental).not.toBeNull();
    expect(incremental!.nodes.length).toBeGreaterThan(0);
  });

  it('creates cluster node for new directory in newDirs (non-expanded)', () => {
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

    const newNodes = [...prevNodes, makeNode('cluster__lib__file.ts', 'lib/file.ts')];
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 0);
    expect(incremental).not.toBeNull();
    const libCluster = incremental!.nodes.find(n =>
      n.id === 'cluster__lib__file.ts' && 'isCluster' in n && n.isCluster
    );
    expect(libCluster).toBeDefined();
    expect((libCluster as ClusterNode).childCount).toBe(1);
    expect((libCluster as ClusterNode).label).toBe('file.ts (1)');
  });

  it('expands new directory cluster when expandedNodeIds contains it', () => {
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

    const newNodes = [...prevNodes, makeNode('cluster__lib__file.ts', 'lib/file.ts')];
    const incremental = computeIncrementalClusters(
      ctx, newNodes, prevEdges, new Set(['cluster__lib__file.ts']), 1,
    );
    expect(incremental).not.toBeNull();
    const libNode = incremental!.nodes.find(n =>
      n.id === 'cluster__lib__file.ts' && !('isCluster' in n && n.isCluster)
    );
    expect(libNode).toBeDefined();
  });

  it('expands cluster children when isExpanded and within subgroup limit', () => {
    const prevNodes: GraphNode[] = [];
    for (let i = 0; i < 200; i++) prevNodes.push(makeNode(`n${i}`, `src/utils/file${i}.ts`));
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

    const newNodes = [...prevNodes, makeNode('n200', 'src/utils/file200.ts')];
    const incremental = computeIncrementalClusters(
      ctx, newNodes, prevEdges, new Set(['cluster__src__utils']), 0,
    );
    expect(incremental).not.toBeNull();
    // When expanded, individual nodes should be visible (not clustered)
    expect(incremental!.nodes.some(n => n.id === 'n0' && !('isCluster' in n && n.isCluster))).toBe(true);
    expect(incremental!.nodes.some(n => n.id === 'n200' && !('isCluster' in n && n.isCluster))).toBe(true);
  });

  it('returns null when expanded cluster exceeds subgroup limit', () => {
    const prevNodes: GraphNode[] = [];
    for (let i = 0; i < 500; i++) prevNodes.push(makeNode(`n${i}`, `src/utils/file${i}.ts`));
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

    const newNodes = [...prevNodes, makeNode('n500', 'src/utils/file500.ts')];
    const incremental = computeIncrementalClusters(
      ctx, newNodes, prevEdges, new Set(['cluster__src__utils']), 0,
    );
    expect(incremental).toBeNull();
  });
});

describe('tryIncrementalOrFull', () => {
  it('falls back to full computation when ctx is null', () => {
    const nodes = [makeNode('a', 'src/foo.ts')];
    const edges: GraphEdge[] = [];
    const result = tryIncrementalOrFull(null, nodes, edges, new Set(), 0);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('uses incremental result when available', () => {
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
    const newNodes = [...prevNodes, makeNode('n200', 'src/file200.ts')];
    const incrementalResult = tryIncrementalOrFull(ctx, newNodes, prevEdges, new Set(), 0);
    expect(incrementalResult.nodes.length).toBeGreaterThan(0);
  });

  it('falls back to full when incremental returns null', () => {
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
    for (let i = 200; i < 400; i++) newNodes.push(makeNode(`n${i}`, `src/file${i}.ts`));
    const fullResult = tryIncrementalOrFull(ctx, newNodes, prevEdges, new Set(), 0);
    expect(fullResult.nodes.length).toBeGreaterThan(0);
  });
});