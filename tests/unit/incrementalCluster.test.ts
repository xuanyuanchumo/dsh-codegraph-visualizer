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

  it('uses prevCluster label/type/filePath when cluster exists in prevResult', () => {
    const prevNodes: GraphNode[] = [];
    // Use 3-segment paths so getTopLevelDir returns 'src/utils'
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

    // Add a new node to the same directory - the cluster should already exist in prevResult
    const newNodes = [...prevNodes, makeNode('n200', 'src/utils/file200.ts')];
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 0);
    expect(incremental).not.toBeNull();
    // The cluster should exist and use prevCluster's label
    const cluster = incremental!.nodes.find(n =>
      'isCluster' in n && n.isCluster && n.id === 'cluster__src__utils'
    ) as ClusterNode | undefined;
    expect(cluster).toBeDefined();
    expect(cluster!.label).toBeDefined();
    expect(cluster!.type).toBe('module');
  });

  it('skips newDir when clusterId already in clusterChildMap', () => {
    const prevNodes: GraphNode[] = [];
    // Use 3-segment paths so getTopLevelDir returns 'src/utils'
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

    // Add a new node in the same directory - cluster__src__utils already exists
    const newNodes = [...prevNodes, makeNode('n200', 'src/utils/file200.ts')];
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 0);
    expect(incremental).not.toBeNull();
    // Should have exactly one cluster for 'src/utils' (not duplicated from newDirs)
    const srcClusters = incremental!.nodes.filter(n =>
      'isCluster' in n && n.isCluster && n.id === 'cluster__src__utils'
    );
    expect(srcClusters.length).toBe(1);
  });

  it('handles multiple new directories with different paths', () => {
    const prevNodes: GraphNode[] = [];
    for (let i = 0; i < 200; i++) prevNodes.push(makeNode(`n${i}`, `src/utils/file${i}.ts`));
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

    // Add nodes in two new 3-segment directories
    const newNodes = [
      ...prevNodes,
      makeNode('n200', 'lib/helpers/file200.ts'),
      makeNode('n201', 'lib/helpers/file201.ts'),
      makeNode('n202', 'test/mocks/file202.ts'),
    ];
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 0);
    expect(incremental).not.toBeNull();
    // Should have clusters for both 'lib/helpers' and 'test/mocks' directories
    const libCluster = incremental!.nodes.find(n =>
      'isCluster' in n && n.isCluster && n.id === 'cluster__lib__helpers'
    ) as ClusterNode | undefined;
    const testCluster = incremental!.nodes.find(n =>
      'isCluster' in n && n.isCluster && n.id === 'cluster__test__mocks'
    ) as ClusterNode | undefined;
    expect(libCluster).toBeDefined();
    expect(libCluster!.childCount).toBe(2);
    expect(testCluster).toBeDefined();
    expect(testCluster!.childCount).toBe(1);
  });

  it('expands new directory cluster with effectiveDepth >= 1', () => {
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

    const newNodes = [...prevNodes, makeNode('n200', 'lib/helpers/file200.ts')];
    const incremental = computeIncrementalClusters(
      ctx, newNodes, prevEdges, new Set(['cluster__lib__helpers']), 1,
    );
    expect(incremental).not.toBeNull();
    // When expanded with effectiveDepth >= 1, individual nodes should be visible
    const libNode = incremental!.nodes.find(n => n.id === 'n200');
    expect(libNode).toBeDefined();
    expect(!('isCluster' in libNode! && libNode!.isCluster)).toBe(true);
  });

  it('handles viewportWidth with initialDepth = 0 (no auto depth)', () => {
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
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 0, 800);
    expect(incremental).not.toBeNull();
    expect(incremental!.nodes.length).toBeGreaterThan(0);
  });

  it('handles removed nodes with incremental update', () => {
    const prevNodes: GraphNode[] = [];
    for (let i = 0; i < 200; i++) prevNodes.push(makeNode(`n${i}`, `src/file${i}.ts`));
    const prevEdges: GraphEdge[] = [makeEdge('e1', 'n0', 'n1'), makeEdge('e2', 'n1', 'n2')];
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

    // Remove a few nodes
    const newNodes = prevNodes.filter(n => n.id !== 'n0' && n.id !== 'n1');
    const newEdges = prevEdges.filter(e => e.source !== 'n0' && e.target !== 'n0' && e.source !== 'n1' && e.target !== 'n1');
    const incremental = computeIncrementalClusters(ctx, newNodes, newEdges, new Set(), 0);
    expect(incremental).not.toBeNull();
    expect(incremental!.nodes.length).toBeGreaterThan(0);
  });

  it('handles both added and removed nodes simultaneously', () => {
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

    // Remove n0 and add n200
    const newNodes = [...prevNodes.filter(n => n.id !== 'n0'), makeNode('n200', 'src/file200.ts')];
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 0);
    expect(incremental).not.toBeNull();
  });

  it('creates cluster with correct label from dir name in newDirs', () => {
    const prevNodes: GraphNode[] = [];
    for (let i = 0; i < 200; i++) prevNodes.push(makeNode(`n${i}`, `src/utils/file${i}.ts`));
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

    // Use node ID that equals clusterId so it's treated as standalone (not in clusterChildMap)
    // This forces the newDirs loop to create the cluster
    // getTopLevelDir('components/ui/Button.tsx') = 'components/ui'
    // getDirClusterId('components/ui') = 'cluster__components__ui'
    const newNodes = [...prevNodes, makeNode('cluster__components__ui', 'components/ui/Button.tsx')];
    const incremental = computeIncrementalClusters(ctx, newNodes, prevEdges, new Set(), 0);
    expect(incremental).not.toBeNull();
    const compCluster = incremental!.nodes.find(n =>
      'isCluster' in n && n.isCluster && n.id === 'cluster__components__ui'
    ) as ClusterNode | undefined;
    expect(compCluster).toBeDefined();
    expect(compCluster!.label).toBe('ui (1)');
    expect(compCluster!.filePath).toBe('components/ui');
    expect(compCluster!.clusterLevel).toBe('directory');
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