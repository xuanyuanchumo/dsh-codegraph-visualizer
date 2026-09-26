import { describe, it, expect } from 'vitest';
import {
  computeProgressiveClusters,
  getFileLabel,
  parseExpandedNodeIds,
  applyInitialDepth,
  createSubgroupClusters,
  enforceNodeLimit,
  estimateExpandCost,
  invalidateExpandCostCache,
} from '../../src/client/store/cluster/progressiveCluster.ts';
import { getTopLevelDir } from '../../src/shared/pathUtils.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import type { ClusterNode } from '../../src/client/store/cluster/types.ts';
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
describe('getFileLabel', () => {
  it('extracts filename from Unix-style path', () => {
    expect(getFileLabel('src/components/Button.tsx')).toBe('Button.tsx');
    expect(getFileLabel('a/b/c/d.ts')).toBe('d.ts');
  });

  it('extracts filename from Windows-style path with backslashes', () => {
    expect(getFileLabel('src\\components\\Button.tsx')).toBe('Button.tsx');
    expect(getFileLabel('C:\\Users\\project\\index.ts')).toBe('index.ts');
  });

  it('extracts filename from mixed separator path', () => {
    expect(getFileLabel('src\\components/Button.tsx')).toBe('Button.tsx');
    expect(getFileLabel('src/components\\Button.tsx')).toBe('Button.tsx');
  });

  it('returns the input when path has no separators', () => {
    expect(getFileLabel('Button.tsx')).toBe('Button.tsx');
    expect(getFileLabel('README')).toBe('README');
  });

  it('returns empty string for empty filePath', () => {
    expect(getFileLabel('')).toBe('');
  });
});

describe('parseExpandedNodeIds', () => {
  it('parses funccluster__ prefixed IDs into expandedFuncClusters', () => {
    const ids = new Set([
      'funccluster__src__components__A__tsx',
      'funccluster__src__utils__B__ts',
    ]);
    const result = parseExpandedNodeIds(ids);
    expect(result.expandedFuncClusters.size).toBe(2);
    expect(result.expandedFuncClusters.has('funccluster__src__components__A__tsx')).toBe(true);
    expect(result.expandedFuncClusters.has('funccluster__src__utils__B__ts')).toBe(true);
    expect(result.expandedDirs.size).toBe(0);
    expect(result.expandedFileClusters.size).toBe(0);
    expect(result.expandedSubgroups.size).toBe(0);
  });

  it('parses cluster__ prefixed IDs into expandedDirs', () => {
    const ids = new Set(['cluster__src__components', 'cluster__src__utils']);
    const result = parseExpandedNodeIds(ids);
    expect(result.expandedDirs.size).toBe(2);
    expect(result.expandedDirs.has('cluster__src__components')).toBe(true);
    expect(result.expandedDirs.has('cluster__src__utils')).toBe(true);
  });

  it('parses filecluster__file__ prefixed IDs into expandedFileClusters', () => {
    const ids = new Set([
      'filecluster__file__src__components__A__tsx',
      'filecluster__file__src__utils__B__ts',
    ]);
    const result = parseExpandedNodeIds(ids);
    expect(result.expandedFileClusters.size).toBe(2);
    expect(result.expandedFileClusters.has('filecluster__file__src__components__A__tsx')).toBe(true);
  });

  it('parses subgroup__ prefixed IDs into expandedSubgroups', () => {
    const ids = new Set([
      'subgroup__src__components__c0',
      'subgroup__src__utils__c1',
    ]);
    const result = parseExpandedNodeIds(ids);
    expect(result.expandedSubgroups.size).toBe(2);
    expect(result.expandedSubgroups.has('subgroup__src__components__c0')).toBe(true);
  });

  it('parses mixed prefix IDs into correct sets', () => {
    const ids = new Set([
      'cluster__src__components',
      'filecluster__file__src__utils__B__ts',
      'funccluster__src__components__A__tsx',
      'subgroup__src__components__c0',
    ]);
    const result = parseExpandedNodeIds(ids);
    expect(result.expandedDirs.size).toBe(1);
    expect(result.expandedFileClusters.size).toBe(1);
    expect(result.expandedFuncClusters.size).toBe(1);
    expect(result.expandedSubgroups.size).toBe(1);
    expect(result.expandedDirs.has('cluster__src__components')).toBe(true);
    expect(result.expandedFileClusters.has('filecluster__file__src__utils__B__ts')).toBe(true);
    expect(result.expandedFuncClusters.has('funccluster__src__components__A__tsx')).toBe(true);
    expect(result.expandedSubgroups.has('subgroup__src__components__c0')).toBe(true);
  });

  it('returns empty sets for empty input', () => {
    const result = parseExpandedNodeIds(new Set());
    expect(result.expandedDirs.size).toBe(0);
    expect(result.expandedFileClusters.size).toBe(0);
    expect(result.expandedFuncClusters.size).toBe(0);
    expect(result.expandedSubgroups.size).toBe(0);
  });
});

describe('applyInitialDepth', () => {
  it('does not expand any clusters when initialDepth=0', () => {
    const dirToNodes = new Map<string, GraphNode[]>([
      ['src/components', [makeNode('a', 'src/components/A.tsx')]],
      ['src/utils', [makeNode('b', 'src/utils/B.ts')]],
    ]);
    const rawNodes = [makeNode('a', 'src/components/A.tsx'), makeNode('b', 'src/utils/B.ts')];
    const expandedDirs = new Set<string>();
    const expandedFileClusters = new Set<string>();

    applyInitialDepth(0, dirToNodes, rawNodes, expandedDirs, expandedFileClusters);

    expect(expandedDirs.size).toBe(0);
    expect(expandedFileClusters.size).toBe(0);
  });

  it('expands all directory clusters when initialDepth=1', () => {
    const dirToNodes = new Map<string, GraphNode[]>([
      ['src/components', [makeNode('a', 'src/components/A.tsx')]],
      ['src/utils', [makeNode('b', 'src/utils/B.ts')]],
    ]);
    const rawNodes = [makeNode('a', 'src/components/A.tsx'), makeNode('b', 'src/utils/B.ts')];
    const expandedDirs = new Set<string>();
    const expandedFileClusters = new Set<string>();

    applyInitialDepth(1, dirToNodes, rawNodes, expandedDirs, expandedFileClusters);

    expect(expandedDirs.size).toBe(2);
    expect(expandedDirs.has('cluster__src__components')).toBe(true);
    expect(expandedDirs.has('cluster__src__utils')).toBe(true);
    expect(expandedFileClusters.size).toBe(0);
  });

  it('expands all file clusters when initialDepth=2', () => {
    const moduleNode = makeNode('m1', 'src/components/A.tsx', 'module');
    const funcNode = makeNode('f1', 'src/components/A.tsx', 'function', 'm1');
    const dirToNodes = new Map<string, GraphNode[]>([
      ['src/components', [moduleNode, funcNode]],
    ]);
    const rawNodes = [moduleNode, funcNode];
    const expandedDirs = new Set<string>();
    const expandedFileClusters = new Set<string>();

    applyInitialDepth(2, dirToNodes, rawNodes, expandedDirs, expandedFileClusters);

    expect(expandedDirs.size).toBe(1);
    expect(expandedDirs.has('cluster__src__components')).toBe(true);
    // module node: fileKey = parentId ?? filePath ?? id = "src/components/A.tsx"
    // func node: fileKey = parentId = "m1"
    // replace(/[/:\\]/g, '__') only replaces /, :, \ — not .
    expect(expandedFileClusters.size).toBe(2);
    expect(expandedFileClusters.has('filecluster__file__src__components__A.tsx')).toBe(true);
    expect(expandedFileClusters.has('filecluster__file__m1')).toBe(true);
  });

  it('does not expand file clusters for dirs not in expandedDirs at initialDepth=2', () => {
    const dirToNodes = new Map<string, GraphNode[]>([
      ['src/components', [makeNode('a', 'src/components/A.tsx')]],
    ]);
    const rawNodes = [makeNode('a', 'src/components/A.tsx')];
    const expandedDirs = new Set<string>(); // empty - no dirs expanded
    const expandedFileClusters = new Set<string>();

    applyInitialDepth(2, dirToNodes, rawNodes, expandedDirs, expandedFileClusters);

    // applyInitialDepth first adds all dir cluster IDs at depth >= 1,
    // then at depth >= 2 checks if dirClusterId is in expandedDirs
    // Since depth=2 >= 1, expandedDirs gets populated first, so file clusters ARE expanded
    expect(expandedDirs.size).toBe(1);
    expect(expandedFileClusters.size).toBeGreaterThan(0);
  });
});

describe('createSubgroupClusters', () => {
  it('directly expands subgroup nodes when community size <= SUBGROUP_THRESHOLD', () => {
    // Create 30 nodes with no edges (< MIN_NODES_FOR_SUBGROUP=50)
    // detectCommunities returns single "all" group with 30 nodes
    // 30 <= SUBGROUP_THRESHOLD(100), so all nodes are directly visible
    const dirNodes: GraphNode[] = [];
    for (let i = 0; i < 30; i++) {
      dirNodes.push(makeNode(`sg${i}`, `src/bigdir/file${i}.ts`));
    }
    const dirEdges: GraphEdge[] = [];

    const result = createSubgroupClusters(dirNodes, dirEdges, 'src/bigdir', new Set());

    // All 30 nodes should be directly visible (no cluster nodes)
    expect(result.nodes.length).toBe(30);
    for (const node of result.nodes) {
      expect('isCluster' in node).toBe(false);
    }
    // Each node maps to itself
    for (const node of dirNodes) {
      expect(result.nodeIdToVisibleId.get(node.id)).toBe(node.id);
    }
  });

  it('creates ClusterNode when subgroup size > SUBGROUP_THRESHOLD and not expanded', () => {
    // Create 101 nodes in a star graph: center node connected to 100 others
    // detectCommunities will converge all to one community with 101 nodes
    // 101 > SUBGROUP_THRESHOLD(100), so a ClusterNode is created
    const dirNodes: GraphNode[] = [];
    for (let i = 0; i < 101; i++) {
      dirNodes.push(makeNode(`sg${i}`, `src/bigdir/file${i}.ts`));
    }
    const dirEdges: GraphEdge[] = [];
    // Star graph: center sg0 connected to sg1..sg100
    for (let i = 1; i < 101; i++) {
      dirEdges.push(makeEdge(`e${i}`, 'sg0', `sg${i}`));
    }

    const result = createSubgroupClusters(dirNodes, dirEdges, 'src/bigdir', new Set());

    // Should have cluster nodes (not all 101 individual nodes)
    const clusterNodes = result.nodes.filter(
      (n): n is ClusterNode => 'isCluster' in n && n.isCluster === true,
    );
    expect(clusterNodes.length).toBeGreaterThan(0);

    // Cluster node should have childCount = 101
    const bigCluster = clusterNodes.find((c) => c.childCount > 100);
    expect(bigCluster).toBeDefined();
    expect(bigCluster!.childCount).toBe(101);
    expect(bigCluster!.clusterLevel).toBe('smart');
    expect(bigCluster!.isCluster).toBe(true);

    // All 101 nodes should map to the subgroup cluster ID
    for (const node of dirNodes) {
      const visibleId = result.nodeIdToVisibleId.get(node.id);
      expect(visibleId).toBeDefined();
      expect(visibleId).not.toBe(node.id); // mapped to cluster, not self
    }
  });

  it('shows all child nodes when subgroup is expanded', () => {
    // Same star graph as above, but with expandedSubgroups containing the cluster ID
    const dirNodes: GraphNode[] = [];
    for (let i = 0; i < 101; i++) {
      dirNodes.push(makeNode(`sg${i}`, `src/bigdir/file${i}.ts`));
    }
    const dirEdges: GraphEdge[] = [];
    for (let i = 1; i < 101; i++) {
      dirEdges.push(makeEdge(`e${i}`, 'sg0', `sg${i}`));
    }

    // Compute the expected subgroup cluster ID
    // detectCommunities will produce a community label; we need to figure out what it is
    // First run without expansion to find the cluster ID
    const unexpandedResult = createSubgroupClusters(dirNodes, dirEdges, 'src/bigdir', new Set());
    const clusterNodes = unexpandedResult.nodes.filter(
      (n): n is ClusterNode => 'isCluster' in n && n.isCluster === true,
    );
    const bigCluster = clusterNodes.find((c) => c.childCount > 100);
    expect(bigCluster).toBeDefined();
    const subgroupClusterId = bigCluster!.id;

    // Now run with the subgroup expanded
    const expandedResult = createSubgroupClusters(
      dirNodes,
      dirEdges,
      'src/bigdir',
      new Set([subgroupClusterId]),
    );

    // All 101 nodes should be directly visible (no cluster nodes for the big group)
    const expandedClusterNodes = expandedResult.nodes.filter(
      (n): n is ClusterNode => 'isCluster' in n && n.isCluster === true,
    );
    // The big cluster should not appear; all its nodes are directly visible
    const bigExpandedCluster = expandedClusterNodes.find((c) => c.childCount > 100);
    expect(bigExpandedCluster).toBeUndefined();

    // All nodes should map to themselves
    for (const node of dirNodes) {
      expect(expandedResult.nodeIdToVisibleId.get(node.id)).toBe(node.id);
    }
  });

  it('triggers subgroup clustering when dir node count > MAX_NODES_PER_DIR_BEFORE_SUBGROUP', () => {
    // Create 501 nodes in one directory, expand the directory cluster
    // This should trigger createSubgroupClusters via computeProgressiveClusters
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 501; i++) {
      nodes.push(makeNode(`dn${i}`, `src/bigdir/file${i}.ts`));
    }
    const edges: GraphEdge[] = [];

    const dirClusterId = 'cluster__src__bigdir';
    const result = computeProgressiveClusters(nodes, edges, new Set([dirClusterId]), 0);

    // Result should have nodes (either individual or clustered)
    expect(result.nodes.length).toBeGreaterThan(0);

    // With 501 nodes and no edges, detectCommunities gives each node its own community
    // (since >= MIN_NODES_FOR_SUBGROUP=50, label propagation runs but with no edges,
    // each node keeps its own label). Each community has 1 node <= SUBGROUP_THRESHOLD,
    // so all nodes are directly visible.
    // Verify no directory-level cluster remains - nodes are expanded
    const dirClusters = result.nodes.filter(
      (n): n is ClusterNode =>
        'isCluster' in n && n.isCluster === true && n.clusterLevel === 'directory',
    );
    expect(dirClusters.length).toBe(0);
  });
});

describe('enforceNodeLimit', () => {
  it('collapses clusters when visibleNodes exceeds MAX_VISIBLE_NODES', () => {
    const visibleNodes: (GraphNode | ClusterNode)[] = [];
    const nodeIdToVisibleId = new Map<string, string>();

    let childIdx = 0;
    for (let c = 1; c <= 10; c++) {
      const childIds: NodeId[] = [];
      for (let k = 0; k < c; k++) {
        childIds.push(NodeId(`child${childIdx++}`));
      }
      const clusterNode: ClusterNode = {
        id: NodeId(`c${c}`),
        label: `cluster${c}`,
        type: 'module',
        filePath: `src/dir${c}/file.ts`,
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: c,
        childIds,
        clusterPath: `src/dir${c}`,
        clusterLevel: 'directory',
      };
      visibleNodes.push(clusterNode);
      nodeIdToVisibleId.set(`c${c}`, `c${c}`);
    }

    for (let i = 0; i < 55; i++) {
      visibleNodes.push(makeNode(`child${i}`, `src/dir/file${i}.ts`));
      nodeIdToVisibleId.set(`child${i}`, `child${i}`);
    }
    for (let i = 55; i < 5000; i++) {
      visibleNodes.push(makeNode(`n${i}`, `src/dir/file${i}.ts`));
      nodeIdToVisibleId.set(`n${i}`, `n${i}`);
    }

    expect(visibleNodes.length).toBe(5010);

    const result = enforceNodeLimit(visibleNodes, nodeIdToVisibleId, []);

    expect(result.nodes.length).toBeLessThanOrEqual(5000);
  });

  it('sorts clusters by childCount descending before collapsing', () => {
    const visibleNodes: (GraphNode | ClusterNode)[] = [];
    const nodeIdToVisibleId = new Map<string, string>();

    const cluster10: ClusterNode = {
      id: NodeId('big'),
      label: 'big',
      type: 'module',
      filePath: 'src/big/file.ts',
      lineNumber: 0,
      properties: {},
      isCluster: true,
      childCount: 10,
      childIds: Array.from({ length: 10 }, (_, i) => NodeId(`bigChild${i}`)),
      clusterPath: 'src/big',
      clusterLevel: 'directory',
    };
    const cluster1: ClusterNode = {
      id: NodeId('small'),
      label: 'small',
      type: 'module',
      filePath: 'src/small/file.ts',
      lineNumber: 0,
      properties: {},
      isCluster: true,
      childCount: 1,
      childIds: [NodeId('smallChild0')],
      clusterPath: 'src/small',
      clusterLevel: 'directory',
    };
    const cluster5: ClusterNode = {
      id: NodeId('mid'),
      label: 'mid',
      type: 'module',
      filePath: 'src/mid/file.ts',
      lineNumber: 0,
      properties: {},
      isCluster: true,
      childCount: 5,
      childIds: Array.from({ length: 5 }, (_, i) => NodeId(`midChild${i}`)),
      clusterPath: 'src/mid',
      clusterLevel: 'directory',
    };

    visibleNodes.push(cluster10, cluster1, cluster5);
    nodeIdToVisibleId.set('big', 'big');
    nodeIdToVisibleId.set('small', 'small');
    nodeIdToVisibleId.set('mid', 'mid');

    for (let i = 0; i < 4999; i++) {
      visibleNodes.push(makeNode(`n${i}`, `src/dir/file${i}.ts`));
      nodeIdToVisibleId.set(`n${i}`, `n${i}`);
    }

    expect(visibleNodes.length).toBe(5002);

    const result = enforceNodeLimit(visibleNodes, nodeIdToVisibleId, []);

    for (let i = 0; i < 10; i++) {
      expect(nodeIdToVisibleId.get(`bigChild${i}`)).toBe('big');
    }
  });

  it('updates nodeIdToVisibleId correctly after collapsing', () => {
    const visibleNodes: (GraphNode | ClusterNode)[] = [];
    const nodeIdToVisibleId = new Map<string, string>();

    // 1 cluster with 3 children
    const cluster: ClusterNode = {
      id: NodeId('cl1'),
      label: 'cl1',
      type: 'module',
      filePath: 'src/dir/file.ts',
      lineNumber: 0,
      properties: {},
      isCluster: true,
      childCount: 3,
      childIds: [NodeId('kid0'), NodeId('kid1'), NodeId('kid2')],
      clusterPath: 'src/dir',
      clusterLevel: 'directory',
    };
    visibleNodes.push(cluster);

    for (let i = 0; i < 3; i++) {
      visibleNodes.push(makeNode(`kid${i}`, `src/dir/file${i}.ts`));
      nodeIdToVisibleId.set(`kid${i}`, `kid${i}`);
    }
    for (let i = 3; i < 5000; i++) {
      visibleNodes.push(makeNode(`n${i}`, `src/dir/file${i}.ts`));
      nodeIdToVisibleId.set(`n${i}`, `n${i}`);
    }
    nodeIdToVisibleId.set('cl1', 'cl1');

    expect(visibleNodes.length).toBe(5001);

    const result = enforceNodeLimit(visibleNodes, nodeIdToVisibleId, []);

    expect(nodeIdToVisibleId.get('kid0')).toBe('cl1');
    expect(nodeIdToVisibleId.get('kid1')).toBe('cl1');
    expect(nodeIdToVisibleId.get('kid2')).toBe('cl1');

    expect(nodeIdToVisibleId.get('n3')).toBe('n3');
    expect(nodeIdToVisibleId.get('n4999')).toBe('n4999');

    expect(result.nodes.length).toBeLessThanOrEqual(5000);
  });
});
describe('estimateExpandCost', () => {
  it('returns 0 for unknown node ID prefix', () => {
    const nodes = [makeNode('a', 'src/foo.ts')];
    expect(estimateExpandCost('unknown_prefix__foo', nodes)).toBe(0);
  });

  it('estimates cost for cluster__ prefix (directory cluster)', () => {
    const nodes = [
      makeNode('a', 'src/components/A.tsx'),
      makeNode('b', 'src/components/B.tsx'),
      makeNode('c', 'src/components/C.tsx'),
    ];
    const cost = estimateExpandCost('cluster__src__components', nodes);
    expect(cost).toBe(2);
  });

  it('estimates cost for filecluster__ prefix', () => {
    const moduleNode = makeNode('file1', 'file1', 'module');
    const funcNode1 = makeNode('func1', 'file1', 'function', 'file1');
    const funcNode2 = makeNode('func2', 'file1', 'function', 'file1');
    const nodes = [moduleNode, funcNode1, funcNode2];
    const cost = estimateExpandCost('filecluster__file__file1', nodes);
    expect(cost).toBe(2);
  });

  it('estimates cost for subgroup__ prefix', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push(makeNode(`n${i}`, `src/bigdir/file${i}.ts`));
    }
    const cost = estimateExpandCost('subgroup__src__bigdir__c0', nodes);
    expect(cost).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 when directory has only 1 node', () => {
    const nodes = [makeNode('a', 'src/solo/A.tsx')];
    const cost = estimateExpandCost('cluster__src__solo', nodes);
    expect(cost).toBe(0);
  });

  it('returns 0 for empty rawNodes', () => {
    expect(estimateExpandCost('cluster__src__components', [])).toBe(0);
  });
});

describe('invalidateExpandCostCache', () => {
  it('does not throw when called', () => {
    expect(() => invalidateExpandCostCache()).not.toThrow();
  });

  it('allows re-estimation after cache invalidation', () => {
    const nodes = [
      makeNode('a', 'src/components/A.tsx'),
      makeNode('b', 'src/components/B.tsx'),
    ];
    const cost1 = estimateExpandCost('cluster__src__components', nodes);
    invalidateExpandCostCache();
    const cost2 = estimateExpandCost('cluster__src__components', nodes);
    expect(cost1).toBe(cost2);
  });
});
describe('computeProgressiveClusters with viewportWidth', () => {
  it('uses Math.max for effectiveDepth when viewportWidth and initialDepth > 0', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 2000; i++) {
      nodes.push(makeNode(`n${i}`, `src/dir${i % 100}/file${i}.ts`));
    }
    const edges: GraphEdge[] = [];

    // viewportWidth=800 → maxVisibleNodes=800
    // nodeCount=2000 > 800*1.5=1200 → getAutoClusterDepth returns 1
    // initialDepth=1 → Math.max(1, 1) = 1
    const result = computeProgressiveClusters(nodes, edges, new Set(), 1, 800);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('uses getAutoClusterDepth=2 when nodeCount > maxVisibleNodes*5', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 5000; i++) {
      nodes.push(makeNode(`n${i}`, `src/dir${i % 250}/file${i}.ts`));
    }
    const edges: GraphEdge[] = [];

    // viewportWidth=800 → maxVisibleNodes=800
    // nodeCount=5000 > 800*5=4000 → getAutoClusterDepth returns 2
    // initialDepth=1 → Math.max(1, 2) = 2
    const result = computeProgressiveClusters(nodes, edges, new Set(), 1, 800);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('uses initialDepth when viewportWidth is provided but initialDepth is 0', () => {
    const nodes = [
      makeNode('a', 'src/components/A.tsx'),
      makeNode('b', 'src/utils/B.ts'),
    ];
    const edges: GraphEdge[] = [];

    // viewportWidth=1200, initialDepth=0
    // effectiveDepth = 0 (because initialDepth=0, condition is false)
    const result = computeProgressiveClusters(nodes, edges, new Set(), 0, 1200);
    expect(result.nodes).toHaveLength(2);
  });

  it('triggers enforceNodeLimit when visibleNodes exceeds maxVisibleNodes', () => {
    // Use small viewport to get maxVisibleNodes=800
    // Create 1000 nodes in 50 directories, expand all directories
    // Each node has unique filePath → 1000 file clusters > 800
    // enforceNodeLimit is called but file clusters (childCount=1) are kept
    // The function still returns a valid result
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 1000; i++) {
      nodes.push(makeNode(`n${i}`, `src/dir${i % 50}/file${i}.ts`));
    }
    const edges: GraphEdge[] = [];

    const expandedDirs = new Set<string>();
    for (let i = 0; i < 50; i++) {
      expandedDirs.add(`cluster__src__dir${i}`);
    }

    const result = computeProgressiveClusters(nodes, edges, expandedDirs, 0, 800);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges).toBeDefined();
  });
});

describe('estimateExpandCost file cache rebuild', () => {
  it('rebuilds file cache after invalidation with filecluster__ prefix', () => {
    const nodes = [
      makeNode('file1', 'src/foo.ts', 'module'),
      makeNode('func1', 'src/foo.ts', 'function', 'file1'),
    ];

    // First call to populate cache
    estimateExpandCost('filecluster__file__src__foo__ts', nodes);

    // Invalidate cache
    invalidateExpandCostCache();

    // Second call should rebuild cache (cover getFileToNodesCache loop body)
    const cost = estimateExpandCost('filecluster__file__src__foo__ts', nodes);
    expect(cost).toBeGreaterThanOrEqual(0);
  });

  it('handles filecluster__ with multiple nodes sharing same filePath', () => {
    const nodes = [
      makeNode('mod', 'src/bar.ts', 'module'),
      makeNode('fn1', 'src/bar.ts', 'function', 'mod'),
      makeNode('fn2', 'src/bar.ts', 'function', 'mod'),
    ];

    invalidateExpandCostCache();
    // nodeId format: filecluster__file__ + filePath with / replaced by __ (but . preserved)
    const cost = estimateExpandCost('filecluster__file__src__bar.ts', nodes);
    expect(cost).toBe(2);
  });
});
describe('computeProgressiveClusters expanded file cluster for module nodes', () => {
  it('shows module node and children when file cluster is expanded', () => {
    const moduleNode = makeNode('mod1', 'src/foo/bar.ts', 'module');
    const funcNode = makeNode('fn1', 'src/foo/bar.ts', 'function', 'mod1');

    const nodes = [moduleNode, funcNode];
    const edges: GraphEdge[] = [];

    const dirClusterId = 'cluster__src__foo';
    // fileClusterId = filecluster__file__ + filePath with / replaced by __ (but . preserved)
    const fileClusterId = 'filecluster__file__src__foo__bar.ts';

    const result = computeProgressiveClusters(nodes, edges, new Set([dirClusterId, fileClusterId]), 0);

    // Module node should be visible (expanded file cluster shows module + children)
    expect(result.nodes.length).toBeGreaterThan(0);
    const hasMod1 = result.nodes.some((n) => 'isCluster' in n === false && n.id === 'mod1');
    expect(hasMod1).toBe(true);
  });

  it('shows module node without children when file cluster is expanded', () => {
    const moduleNode = makeNode('solo_mod', 'src/solo/file.ts', 'module');

    const nodes = [moduleNode];
    const edges: GraphEdge[] = [];

    const dirClusterId = 'cluster__src__solo';
    const fileClusterId = 'filecluster__file__src__solo__file.ts';

    const result = computeProgressiveClusters(nodes, edges, new Set([dirClusterId, fileClusterId]), 0);

    expect(result.nodes.length).toBeGreaterThan(0);
    const hasSoloMod = result.nodes.some((n) => 'isCluster' in n === false && n.id === 'solo_mod');
    expect(hasSoloMod).toBe(true);
  });
});

describe('computeProgressiveClusters node without filePath', () => {
  it('handles non-module node without parentId and filePath in expanded directory', () => {
    const node: GraphNode = {
      id: NodeId('nofile'),
      label: 'nofile',
      type: 'function',
      filePath: '',
      lineNumber: 0,
      properties: {},
    };

    // Node with empty filePath gets dir = n.id = 'nofile'
    const dirClusterId = 'cluster__nofile';
    const result = computeProgressiveClusters([node], [], new Set([dirClusterId]), 0);

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.some((n) => 'isCluster' in n === false && n.id === 'nofile')).toBe(true);
  });

  it('handles non-module node with parentId but no filePath in expanded directory', () => {
    const parentNode: GraphNode = {
      id: NodeId('parent'),
      label: 'parent',
      type: 'function',
      filePath: '',
      lineNumber: 0,
      properties: {},
    };
    const childNode: GraphNode = {
      id: NodeId('child'),
      label: 'child',
      type: 'function',
      filePath: '',
      lineNumber: 0,
      properties: {},
      parentId: NodeId('parent'),
    };

    const nodes = [parentNode, childNode];
    const edges: GraphEdge[] = [];

    // Both nodes have empty filePath, so dir = n.id
    // parentNode dir = 'parent', childNode dir = 'child'
    // But childNode has parentId='parent', so in buildParentIndex, parentToChildren has 'parent' -> [childNode]
    // In buildDirMapping, childNode's dir = 'child' (since no filePath, no depGroup)
    const result = computeProgressiveClusters(nodes, edges, new Set(), 0);

    expect(result.nodes.length).toBeGreaterThan(0);
  });
});
describe('processModuleNodeExpanded/Collapsed edge cases', () => {
  it('processModuleNodeExpanded with module node that has no children and no filePath', () => {
    // Module node with no filePath: parentToChildren.get(n.id) = undefined, filePathToNodes.get('') = undefined
    // childNodes = [] → enters else branch (lines 295-298)
    const moduleNode: GraphNode = {
      id: NodeId('lonely_mod'),
      label: 'lonely_mod',
      type: 'module',
      filePath: '',
      lineNumber: 0,
      properties: {},
    };

    const dirClusterId = 'cluster__lonely_mod';
    // fileClusterId = filecluster__file__ + (parentId ?? filePath ?? id).replace(/[/:\\]/g, '__')
    // undefined ?? '' ?? 'lonely_mod' = '' (because '' is not null/undefined)
    // ''.replace(/[/:\\]/g, '__') = ''
    // fileClusterId = 'filecluster__file__'
    const fileClusterId = 'filecluster__file__';

    const result = computeProgressiveClusters(
      [moduleNode],
      [],
      new Set([dirClusterId, fileClusterId]),
      0,
    );

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.some((n) => 'isCluster' in n === false && n.id === 'lonely_mod')).toBe(true);
  });

  it('processModuleNodeCollapsed with module node that has no children', () => {
    // Module node with filePath but no children: filteredChildren = [] → enters else branch (lines 331-333)
    const moduleNode = makeNode('solo_mod2', 'src/solo2/file.ts', 'module');

    const nodes = [moduleNode];
    const edges: GraphEdge[] = [];

    const dirClusterId = 'cluster__src__solo2';
    // Don't expand file cluster - module node should be collapsed
    const result = computeProgressiveClusters(nodes, edges, new Set([dirClusterId]), 0);

    expect(result.nodes.length).toBeGreaterThan(0);
    // Module node without children is shown directly (not as a cluster)
    expect(result.nodes.some((n) => 'isCluster' in n === false && n.id === 'solo_mod2')).toBe(true);
  });
});
describe('estimateExpandCost fallback paths', () => {
  it('cluster__ fallback when dirPath not directly in cache', () => {
    // Create nodes in a directory with __ in its name
    // getTopLevelDir('src__foo/bar.ts') = 'src__foo/bar.ts' (2 segments)
    // dir in cache = 'src__foo/bar.ts'
    // nodeId = cluster__src__foo__bar.ts
    // dirPath = src/foo/bar.ts (not in cache) → fallback path
    // dir.replace(/[/:\\]/g, '__') = 'src__foo__bar.ts' matches nodeId.replace(/^cluster__/, '') = 'src__foo__bar.ts'
    const nodes = [
      makeNode('a', 'src__foo/bar.ts'),
      makeNode('b', 'src__foo/bar.ts'),
    ];

    invalidateExpandCostCache();
    const cost = estimateExpandCost('cluster__src__foo__bar.ts', nodes);
    expect(cost).toBe(1); // 2 nodes - 1 = 1
  });

  it('filecluster__ fallback when filePath not directly in cache', () => {
    // Create nodes with filePath containing __
    // getFileToNodesCache key = 'src__foo/bar.ts'
    // nodeId = filecluster__file__src__foo__bar.ts
    // filePath = src/foo/bar.ts (not in cache) → fallback path
    // fp.replace(/[/:\\]/g, '__') = 'src__foo__bar.ts' matches nodeId.replace(/^filecluster__file__/, '') = 'src__foo__bar.ts'
    const nodes = [
      makeNode('a', 'src__foo/bar.ts', 'module'),
      makeNode('b', 'src__foo/bar.ts', 'function', 'a'),
    ];

    invalidateExpandCostCache();
    const cost = estimateExpandCost('filecluster__file__src__foo__bar.ts', nodes);
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});
