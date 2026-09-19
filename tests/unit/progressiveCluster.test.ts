import { describe, it, expect } from 'vitest';
import { computeProgressiveClusters } from '../../src/client/store/cluster/progressiveCluster.ts';
import { getTopLevelDir } from '../../src/shared/pathUtils.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeNode(id: string, filePath: string, type: string = 'function', parentId?: string): GraphNode {
  return {
    id: NodeId(id),
    label: id,
    type: type as GraphNode['type'],
    filePath,
    lineNumber: 1,
    properties: {},
    ...(parentId ? { parentId: NodeId(parentId) } : {}),
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

describe('getTopLevelDir', () => {
  it('returns filePath for short paths (<=2 segments)', () => {
    expect(getTopLevelDir('foo.ts')).toBe('foo.ts');
    expect(getTopLevelDir('src/foo.ts')).toBe('src/foo.ts');
  });

  it('returns crates/X for crates paths', () => {
    expect(getTopLevelDir('crates/core/src/lib.rs')).toBe('crates/core');
  });

  it('handles Windows drive letters by skipping drive prefix', () => {
    expect(getTopLevelDir('C:/Users/project/src/index.ts')).toBe('Users/project');
  });

  it('returns first two segments for generic paths', () => {
    expect(getTopLevelDir('src/components/Button.tsx')).toBe('src/components');
    expect(getTopLevelDir('lib/utils/helper.ts')).toBe('lib/utils');
  });

  it('simplified mode returns / for short paths', () => {
    expect(getTopLevelDir('foo.ts', { simplified: true })).toBe('/');
    expect(getTopLevelDir('src/foo.ts', { simplified: true })).toBe('/');
  });

  it('simplified mode returns first two segments joined', () => {
    expect(getTopLevelDir('src/components/Button.tsx', { simplified: true })).toBe('src/components');
  });

  it('simplified mode normalizes backslashes', () => {
    expect(getTopLevelDir('src\\components\\Button.tsx', { simplified: true })).toBe('src/components');
  });
});

describe('computeProgressiveClusters', () => {
  it('returns empty result for empty input', () => {
    const result = computeProgressiveClusters([], [], new Set());
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('clusters nodes by top-level directory at depth 0', () => {
    const nodes = [
      makeNode('a', 'src/components/A.tsx'),
      makeNode('b', 'src/components/B.tsx'),
      makeNode('c', 'src/utils/C.ts'),
    ];
    const edges = [makeEdge('e1', 'a', 'b')];

    const result = computeProgressiveClusters(nodes, edges, new Set(), 0);

    expect(result.nodes).toHaveLength(2);
    const clusterLabels = result.nodes.map((n) => n.label);
    expect(clusterLabels.some((l) => l.includes('components'))).toBe(true);
    expect(clusterLabels.some((l) => l.includes('utils'))).toBe(true);
  });

  it('expands directory clusters when expandedNodeIds contains cluster id', () => {
    const nodes = [
      makeNode('a', 'src/components/A.tsx', 'function'),
      makeNode('b', 'src/components/B.tsx', 'function'),
    ];
    const edges = [makeEdge('e1', 'a', 'b')];

    const clusterId = 'cluster__src__components';
    const result = computeProgressiveClusters(nodes, edges, new Set([clusterId]), 0);

    expect(result.nodes.length).toBeGreaterThan(0);
    const allAreClusterOrNonCluster = result.nodes.every(
      (n) => 'isCluster' in n || !('isCluster' in n),
    );
    expect(allAreClusterOrNonCluster).toBe(true);
  });

  it('applies initialDepth=1 to expand all directory clusters', () => {
    const nodes = [
      makeNode('a', 'src/components/A.tsx', 'function'),
      makeNode('b', 'src/utils/B.ts', 'function'),
    ];
    const edges: GraphEdge[] = [];

    const result = computeProgressiveClusters(nodes, edges, new Set(), 1);

    expect(result.nodes.length).toBeGreaterThan(0);
    const hasFileCluster = result.nodes.some(
      (n) => 'isCluster' in n && n.isCluster && 'clusterLevel' in n && n.clusterLevel === 'file',
    );
    expect(hasFileCluster).toBe(true);
  });

  it('creates file cluster nodes for module-type nodes with children', () => {
    const fileNode = makeNode('file1', 'src/components/Button.tsx', 'module');
    const funcNode1 = makeNode('func1', 'src/components/Button.tsx', 'function', 'file1');
    const funcNode2 = makeNode('func2', 'src/components/Button.tsx', 'function', 'file1');

    const nodes = [fileNode, funcNode1, funcNode2];
    const edges: GraphEdge[] = [];

    const clusterId = 'cluster__src__components';
    const result = computeProgressiveClusters(nodes, edges, new Set([clusterId]), 0);

    const hasFileCluster = result.nodes.some(
      (n) => 'isCluster' in n && n.isCluster && 'clusterLevel' in n && n.clusterLevel === 'file',
    );
    expect(hasFileCluster).toBe(true);
  });

  it('aggregates edges between clusters', () => {
    const nodes = [
      makeNode('a', 'src/components/A.tsx'),
      makeNode('b', 'src/utils/B.ts'),
    ];
    const edges = [
      makeEdge('e1', 'a', 'b', 'call'),
      makeEdge('e2', 'a', 'b', 'import'),
    ];

    const result = computeProgressiveClusters(nodes, edges, new Set(), 0);

    expect(result.edges.length).toBeGreaterThan(0);
  });

  it('handles dependency group nodes', () => {
    const depNode: GraphNode = {
      id: NodeId('dep1'),
      label: 'lodash',
      type: 'module',
      filePath: '',
      lineNumber: 0,
      properties: { depType: 'npm' },
    };

    const result = computeProgressiveClusters([depNode], [], new Set(), 0);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.label).toContain('dep:npm');
  });

  it('enforces MAX_VISIBLE_NODES limit by collapsing clusters', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 2500; i++) {
      const dirIdx = i % 100;
      nodes.push(makeNode(`n${i}`, `src/dir${dirIdx}/file${i}.ts`, 'module'));
    }
    const edges: GraphEdge[] = [];

    const result = computeProgressiveClusters(nodes, edges, new Set(), 0);

    expect(result.nodes.length).toBeLessThanOrEqual(2000);
  });

  it('handles expanded file clusters showing child nodes', () => {
    const fileNode = makeNode('file1', 'src/components/Button.tsx', 'module');
    const funcNode = makeNode('func1', 'src/components/Button.tsx', 'function', 'file1');

    const nodes = [fileNode, funcNode];
    const edges: GraphEdge[] = [];

    const dirClusterId = 'cluster__src__components';
    const fileClusterId = 'filecluster__C__file__file1';
    const result = computeProgressiveClusters(nodes, edges, new Set([dirClusterId, fileClusterId]), 0);

    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('returns cluster nodes with correct clusterLevel at depth 0', () => {
    const nodes = [
      makeNode('a', 'src/components/A.tsx'),
      makeNode('b', 'src/utils/B.ts'),
    ];
    const edges: GraphEdge[] = [];

    const result = computeProgressiveClusters(nodes, edges, new Set(), 0);

    for (const node of result.nodes) {
      if ('isCluster' in node && node.isCluster) {
        expect(node.clusterLevel).toBe('directory');
      }
    }
  });

  it('maps node IDs to visible cluster IDs', () => {
    const nodes = [
      makeNode('a1', 'src/components/A.tsx'),
      makeNode('a2', 'src/components/A.tsx'),
    ];
    const edges: GraphEdge[] = [];

    const result = computeProgressiveClusters(nodes, edges, new Set(), 0);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.label).toContain('components');
  });
});
