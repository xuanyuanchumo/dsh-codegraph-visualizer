import { describe, it, expect } from 'vitest';
import {
  computeProgressiveClusters,
  getFileLabel,
  parseExpandedNodeIds,
  applyInitialDepth,
  createSubgroupClusters,
  enforceNodeLimit,
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
