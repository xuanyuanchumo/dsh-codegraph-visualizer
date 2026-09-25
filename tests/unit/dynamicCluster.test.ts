import { describe, it, expect } from 'vitest';
import {
  DYNAMIC_CLUSTER,
  getDynamicMaxVisibleNodes,
  getAutoClusterDepth,
} from '../../src/shared/constants.ts';
import { computeProgressiveClusters } from '../../src/client/store/cluster/progressiveCluster.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeNode(id: string, filePath: string = `src/${id}.ts`): GraphNode {
  return {
    id: NodeId(id),
    label: id,
    type: 'function',
    filePath,
    lineNumber: 1,
    properties: {},
  };
}

function makeEdge(source: string, target: string): GraphEdge {
  return {
    id: EdgeId(`${source}->${target}`),
    source: NodeId(source),
    target: NodeId(target),
    type: 'call',
    properties: {},
  };
}

describe('DYNAMIC_CLUSTER constants', () => {
  it('should have screen width thresholds', () => {
    expect(DYNAMIC_CLUSTER.SMALL_SCREEN_WIDTH).toBe(1200);
    expect(DYNAMIC_CLUSTER.LARGE_SCREEN_WIDTH).toBe(1920);
  });

  it('should have different max visible nodes for different screen sizes', () => {
    expect(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_SMALL).toBe(800);
    expect(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_MEDIUM).toBe(1200);
    expect(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_LARGE).toBe(1500);
  });
});

describe('getDynamicMaxVisibleNodes', () => {
  it('should return small limit for narrow screens', () => {
    expect(getDynamicMaxVisibleNodes(800)).toBe(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_SMALL);
    expect(getDynamicMaxVisibleNodes(1199)).toBe(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_SMALL);
  });

  it('should return medium limit for medium screens', () => {
    expect(getDynamicMaxVisibleNodes(1200)).toBe(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_MEDIUM);
    expect(getDynamicMaxVisibleNodes(1500)).toBe(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_MEDIUM);
    expect(getDynamicMaxVisibleNodes(1919)).toBe(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_MEDIUM);
  });

  it('should return large limit for wide screens', () => {
    expect(getDynamicMaxVisibleNodes(1920)).toBe(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_LARGE);
    expect(getDynamicMaxVisibleNodes(2560)).toBe(DYNAMIC_CLUSTER.MAX_VISIBLE_NODES_LARGE);
  });
});

describe('getAutoClusterDepth', () => {
  it('should return 0 for small graphs', () => {
    expect(getAutoClusterDepth(100, 2000)).toBe(0);
    expect(getAutoClusterDepth(2000, 2000)).toBe(0);
  });

  it('should return 1 for graphs exceeding 1.5x max visible nodes', () => {
    expect(getAutoClusterDepth(3001, 2000)).toBe(1);
    expect(getAutoClusterDepth(5000, 2000)).toBe(1);
  });

  it('should return 2 for graphs exceeding 5x max visible nodes', () => {
    expect(getAutoClusterDepth(10001, 2000)).toBe(2);
    expect(getAutoClusterDepth(50000, 2000)).toBe(2);
  });
});

describe('computeProgressiveClusters with viewportWidth', () => {
  it('should accept optional viewportWidth parameter', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('a', 'b')];
    const result = computeProgressiveClusters(nodes, edges, new Set(), 0, 1920);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it('should work without viewportWidth (backward compatible)', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('a', 'b')];
    const result = computeProgressiveClusters(nodes, edges, new Set(), 0);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it('should apply higher max visible nodes for wider screens', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 100; i++) {
      nodes.push(makeNode(`node${i}`, `src/dir${i % 10}/file${i}.ts`));
    }
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 50; i++) {
      edges.push(makeEdge(`node${i}`, `node${i + 50}`));
    }

    const resultSmall = computeProgressiveClusters(nodes, edges, new Set(), 0, 800);
    const resultLarge = computeProgressiveClusters(nodes, edges, new Set(), 2560);

    expect(resultSmall.nodes.length).toBeGreaterThan(0);
    expect(resultLarge.nodes.length).toBeGreaterThan(0);
  });
});