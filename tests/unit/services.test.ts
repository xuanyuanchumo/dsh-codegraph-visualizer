// Service-layer tests for actual business logic (J3–J11 user journeys).
import { describe, it, expect, beforeEach } from 'vitest';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';
import { mapNodeKind, mapEdgeKind, resolveDbPath } from '../../src/adapters/CodeGraphAdapter.ts';
import { coerceNode, coerceEdge, validateGraphData } from '../../src/client/validators.ts';
import { resolveConfig, isPathAllowed, setAllowedWorkspaceRoots, DEFAULT_CONFIG } from '../../src/index.ts';
import type { GraphNode, GraphEdge, AdapterResult } from '../../src/types/index.ts';
import { NodeId, EdgeId, RepoId } from '../../src/types/index.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';

// ── GraphDataMerger.merge() — multi-source dedup + __source tagging ──────────

describe('GraphDataMerger.merge() (J11 multi-source)', () => {
  let merger: GraphDataMerger;

  beforeEach(() => {
    merger = new GraphDataMerger();
  });

  it('should dedup nodes by id across multiple adapter results', () => {
    const results: AdapterResult[] = [
      {
        nodes: [makeNode('n1', 'funcA', 'function', '/src/a.ts', 1)],
        edges: [],
        source: 'codegraph',
        timestamp: 100,
      },
      {
        nodes: [makeNode('n1', 'funcA', 'function', '/src/a.ts', 1)],
        edges: [],
        source: 'lens',
        timestamp: 200,
      },
    ];

    const merged = merger.merge(results, RepoId('repo'));
    expect(merged.nodes).toHaveLength(1);
    expect(merged.edges).toHaveLength(0);
  });

  it('should tag each node/edge with __source property', () => {
    const results: AdapterResult[] = [
      {
        nodes: [makeNode('n1', 'funcA', 'function', '/src/a.ts', 1)],
        edges: [makeEdge('e1', 'n1', 'n2', 'call')],
        source: 'codegraph',
        timestamp: 100,
      },
    ];

    const merged = merger.merge(results, RepoId('repo'));
    expect(merged.nodes[0]?.properties.__source).toBe('codegraph');
    expect(merged.edges[0]?.properties.__source).toBe('codegraph');
  });

  it('should keep last-wins for duplicate node ids', () => {
    const results: AdapterResult[] = [
      {
        nodes: [makeNode('n1', 'oldLabel', 'function', '/src/a.ts', 1)],
        edges: [],
        source: 'codegraph',
        timestamp: 100,
      },
      {
        nodes: [makeNode('n1', 'newLabel', 'function', '/src/a.ts', 1)],
        edges: [],
        source: 'lens',
        timestamp: 200,
      },
    ];

    const merged = merger.merge(results, RepoId('repo'));
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]?.label).toBe('newLabel');
    expect(merged.nodes[0]?.properties.__source).toBe('lens');
  });

  it('should set correct metadata', () => {
    const results: AdapterResult[] = [
      {
        nodes: [makeNode('n1', 'a', 'function', '/x', 1), makeNode('n2', 'b', 'class', '/y', 2)],
        edges: [makeEdge('e1', 'n1', 'n2', 'call')],
        source: 'codegraph',
        timestamp: 100,
      },
    ];

    const merged = merger.merge(results, RepoId('my-repo'));
    expect(merged.metadata.repoId).toBe('my-repo');
    expect(merged.metadata.nodeCount).toBe(2);
    expect(merged.metadata.edgeCount).toBe(1);
    expect(merged.metadata.timestamp).toBeGreaterThan(0);
  });

  it('should handle empty results array', () => {
    const merged = merger.merge([], RepoId('repo'));
    expect(merged.nodes).toHaveLength(0);
    expect(merged.edges).toHaveLength(0);
    expect(merged.metadata.nodeCount).toBe(0);
  });
});

// ── GraphDataMerger.applyDelta() — incremental heat-updates ─────────────────

describe('GraphDataMerger.applyDelta() (J5 incremental)', () => {
  let merger: GraphDataMerger;

  beforeEach(() => {
    merger = new GraphDataMerger();
  });

  it('should add new nodes from delta', () => {
    const current = makeGraphData(
      [makeNode('n1', 'funcA', 'function', '/src/a.ts', 1)],
      [],
    );
    const delta: AdapterResult = {
      nodes: [makeNode('n2', 'funcB', 'function', '/src/b.ts', 1)],
      edges: [],
      source: 'codegraph',
      timestamp: 200,
    };

    const result = merger.applyDelta(current, delta);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.some(n => n.id === 'n2')).toBe(true);
  });

  it('should merge properties for existing nodes (shallow merge)', () => {
    const current = makeGraphData(
      [makeNode('n1', 'funcA', 'function', '/src/a.ts', 1, { exported: true, scope: 'global' })],
      [],
    );
    const delta: AdapterResult = {
      nodes: [makeNode('n1', 'funcA-updated', 'function', '/src/a.ts', 1, { exported: false })],
      edges: [],
      source: 'codegraph',
      timestamp: 200,
    };

    const result = merger.applyDelta(current, delta);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.label).toBe('funcA-updated');
    expect(result.nodes[0]?.properties.exported).toBe(false);
    expect(result.nodes[0]?.properties.scope).toBe('global');
  });

  it('should add new edges from delta', () => {
    const current = makeGraphData(
      [makeNode('n1', 'a', 'function', '/x', 1), makeNode('n2', 'b', 'function', '/y', 1)],
      [],
    );
    const delta: AdapterResult = {
      nodes: [],
      edges: [makeEdge('e1', 'n1', 'n2', 'call')],
      source: 'codegraph',
      timestamp: 200,
    };

    const result = merger.applyDelta(current, delta);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.source).toBe('n1');
    expect(result.edges[0]?.target).toBe('n2');
  });

  it('should merge properties for existing edges', () => {
    const current = makeGraphData(
      [makeNode('n1', 'a', 'function', '/x', 1), makeNode('n2', 'b', 'function', '/y', 1)],
      [makeEdge('e1', 'n1', 'n2', 'call', { line: 5 })],
    );
    const delta: AdapterResult = {
      nodes: [],
      edges: [makeEdge('e1', 'n1', 'n2', 'call', { verified: true })],
      source: 'codegraph',
      timestamp: 200,
    };

    const result = merger.applyDelta(current, delta);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.properties.line).toBe(5);
    expect(result.edges[0]?.properties.verified).toBe(true);
  });

  it('should preserve current metadata and update counts', () => {
    const current = makeGraphData(
      [makeNode('n1', 'a', 'function', '/x', 1)],
      [makeEdge('e1', 'n1', 'n1', 'call')],
      'my-repo',
      1000,
    );
    const delta: AdapterResult = {
      nodes: [makeNode('n2', 'b', 'function', '/y', 1)],
      edges: [],
      source: 'codegraph',
      timestamp: 2000,
    };

    const result = merger.applyDelta(current, delta);
    expect(result.metadata.repoId).toBe('my-repo');
    expect(result.metadata.nodeCount).toBe(2);
    expect(result.metadata.edgeCount).toBe(1);
    expect(result.metadata.timestamp).toBeGreaterThanOrEqual(current.metadata.timestamp);
  });
});

// ── CodeGraphAdapter mapping functions ──────────────────────────────────────

describe('CodeGraphAdapter mapNodeKind/mapEdgeKind (J4 symbol resolution)', () => {
  it('should map known node kinds correctly', () => {
    expect(mapNodeKind('function')).toBe('function');
    expect(mapNodeKind('method')).toBe('function');
    expect(mapNodeKind('class')).toBe('class');
    expect(mapNodeKind('interface')).toBe('interface');
    expect(mapNodeKind('type_alias')).toBe('type');
    expect(mapNodeKind('constant')).toBe('variable');
    expect(mapNodeKind('variable')).toBe('variable');
    expect(mapNodeKind('property')).toBe('variable');
    expect(mapNodeKind('file')).toBe('module');
    expect(mapNodeKind('import')).toBe('module');
    expect(mapNodeKind('module')).toBe('module');
  });

  it('should default unknown node kinds to module', () => {
    expect(mapNodeKind('unknown')).toBe('module');
    expect(mapNodeKind('')).toBe('module');
    expect(mapNodeKind('namespace')).toBe('module');
  });

  it('should map known edge kinds correctly', () => {
    expect(mapEdgeKind('call')).toBe('call');
    expect(mapEdgeKind('calls')).toBe('call');
    expect(mapEdgeKind('import')).toBe('import');
    expect(mapEdgeKind('imports')).toBe('import');
    expect(mapEdgeKind('extend')).toBe('extend');
    expect(mapEdgeKind('extends')).toBe('extend');
    expect(mapEdgeKind('implement')).toBe('implement');
    expect(mapEdgeKind('implements')).toBe('implement');
    expect(mapEdgeKind('contains')).toBe('dependency');
    expect(mapEdgeKind('dependency')).toBe('dependency');
    expect(mapEdgeKind('depends')).toBe('dependency');
  });

  it('should default unknown edge kinds to dependency', () => {
    expect(mapEdgeKind('unknown')).toBe('dependency');
    expect(mapEdgeKind('')).toBe('dependency');
    expect(mapEdgeKind('references')).toBe('dependency');
  });
});

describe('CodeGraphAdapter resolveDbPath (J11 adapter)', () => {
  it('should resolve db path for a workspace', () => {
    const path = resolveDbPath('/home/user/project');
    expect(path).toContain('.codegraph');
    expect(path).toContain('codegraph.db');
    expect(path).toContain('home');
    expect(path).toContain('user');
    expect(path).toContain('project');
  });

  it('should use process.cwd() for empty or dot workspace', () => {
    const dotPath = resolveDbPath('.');
    const emptyPath = resolveDbPath('');
    expect(dotPath).toBe(emptyPath);
  });
});

// ── validators: coerceNode / coerceEdge / validateGraphData ─────────────────

describe('validators coerceNode (J7 filter/import)', () => {
  it('should coerce a well-formed node object', () => {
    const raw = {
      id: 'n1',
      label: 'funcA',
      type: 'function',
      filePath: '/src/a.ts',
      lineNumber: 10,
      properties: { exported: true },
    };
    const node = coerceNode(raw, 0);
    expect(node).not.toBeNull();
    expect(node?.id).toBe('n1');
    expect(node?.label).toBe('funcA');
    expect(node?.type).toBe('function');
    expect(node?.filePath).toBe('/src/a.ts');
    expect(node?.lineNumber).toBe(10);
    expect(node?.properties.exported).toBe(true);
  });

  it('should use name as label when label is missing', () => {
    const raw = { id: 'n1', name: 'funcA', type: 'function' };
    const node = coerceNode(raw, 0);
    expect(node?.label).toBe('funcA');
  });

  it('should use file as filePath when filePath is missing', () => {
    const raw = { id: 'n1', label: 'a', type: 'function', file: '/src/x.ts' };
    const node = coerceNode(raw, 0);
    expect(node?.filePath).toBe('/src/x.ts');
  });

  it('should use line as lineNumber when lineNumber is missing', () => {
    const raw = { id: 'n1', label: 'a', type: 'function', line: 42 };
    const node = coerceNode(raw, 0);
    expect(node?.lineNumber).toBe(42);
  });

  it('should default type to variable for unknown types', () => {
    const raw = { id: 'n1', label: 'a', type: 'unknown_type' };
    const node = coerceNode(raw, 0);
    expect(node?.type).toBe('variable');
  });

  it('should generate id from index when id is missing', () => {
    const raw = { label: 'a', type: 'function' };
    const node = coerceNode(raw, 5);
    expect(node?.id).toBe('node-5');
  });

  it('should return null for non-object input', () => {
    expect(coerceNode(null, 0)).toBeNull();
    expect(coerceNode(undefined, 0)).toBeNull();
    expect(coerceNode('string', 0)).toBeNull();
    expect(coerceNode(42, 0)).toBeNull();
  });
});

describe('validators coerceEdge (J5 dependency)', () => {
  it('should coerce a well-formed edge object', () => {
    const raw = {
      id: 'e1',
      source: 'n1',
      target: 'n2',
      type: 'call',
      properties: { line: 5 },
    };
    const edge = coerceEdge(raw, 0);
    expect(edge).not.toBeNull();
    expect(edge?.id).toBe('e1');
    expect(edge?.source).toBe('n1');
    expect(edge?.target).toBe('n2');
    expect(edge?.type).toBe('call');
    expect(edge?.properties.line).toBe(5);
  });

  it('should use from/to as source/target when source/target is missing', () => {
    const raw = { id: 'e1', from: 'n1', to: 'n2', type: 'import' };
    const edge = coerceEdge(raw, 0);
    expect(edge?.source).toBe('n1');
    expect(edge?.target).toBe('n2');
  });

  it('should return null when both source and from are missing', () => {
    const raw = { id: 'e1', target: 'n2', type: 'call' };
    expect(coerceEdge(raw, 0)).toBeNull();
  });

  it('should return null when both target and to are missing', () => {
    const raw = { id: 'e1', source: 'n1', type: 'call' };
    expect(coerceEdge(raw, 0)).toBeNull();
  });

  it('should default type to dependency for unknown types', () => {
    const raw = { id: 'e1', source: 'n1', target: 'n2', type: 'unknown' };
    const edge = coerceEdge(raw, 0);
    expect(edge?.type).toBe('dependency');
  });

  it('should generate id from index when id is missing', () => {
    const raw = { source: 'n1', target: 'n2', type: 'call' };
    const edge = coerceEdge(raw, 3);
    expect(edge?.id).toBe('edge-3');
  });

  it('should return null for non-object input', () => {
    expect(coerceEdge(null, 0)).toBeNull();
    expect(coerceEdge(undefined, 0)).toBeNull();
    expect(coerceEdge(42, 0)).toBeNull();
  });
});

describe('validators validateGraphData (J8 export)', () => {
  it('should validate well-formed graph data', () => {
    const raw = {
      nodes: [
        { id: 'n1', label: 'a', type: 'function', filePath: '/x', lineNumber: 1 },
        { id: 'n2', label: 'b', type: 'class', filePath: '/y', lineNumber: 2 },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'call' }],
      metadata: { repoId: 'repo', timestamp: 1000 },
    };
    const result = validateGraphData(raw);
    expect(result).not.toBeNull();
    expect(result?.nodes).toHaveLength(2);
    expect(result?.edges).toHaveLength(1);
    expect(result?.metadata.repoId).toBe('repo');
    expect(result?.metadata.timestamp).toBe(1000);
  });

  it('should return null for empty nodes array', () => {
    const raw = { nodes: [], edges: [] };
    expect(validateGraphData(raw)).toBeNull();
  });

  it('should return null for non-object input', () => {
    expect(validateGraphData(null)).toBeNull();
    expect(validateGraphData(undefined)).toBeNull();
    expect(validateGraphData('string')).toBeNull();
  });

  it('should default missing metadata fields', () => {
    const raw = {
      nodes: [{ id: 'n1', label: 'a', type: 'function' }],
      edges: [],
    };
    const result = validateGraphData(raw);
    expect(result?.metadata.truncated).toBe(false);
    expect(result?.metadata.totalNodeCount).toBe(1);
    expect(result?.metadata.totalEdgeCount).toBe(0);
    expect(result?.metadata.timestamp).toBeGreaterThan(0);
  });

  it('should filter out invalid nodes and edges', () => {
    const raw = {
      nodes: [
        { id: 'n1', label: 'a', type: 'function' },
        null,
        'invalid',
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n1', type: 'call' },
        null,
      ],
    };
    const result = validateGraphData(raw);
    expect(result?.nodes).toHaveLength(1);
    expect(result?.edges).toHaveLength(1);
  });
});

// ── resolveConfig — config validation ───────────────────────────────────────

describe('resolveConfig (J10 settings)', () => {
  it('should return defaults when no user config provided', () => {
    const config = resolveConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('should merge user config over defaults', () => {
    const config = resolveConfig({ maxNodes: 5000, dataSource: 'lens' });
    expect(config.maxNodes).toBe(5000);
    expect(config.dataSource).toBe('lens');
    expect(config.requestTimeout).toBe(DEFAULT_CONFIG.requestTimeout);
  });

  it('should reject invalid dataSource', () => {
    expect(() => resolveConfig({ dataSource: 'invalid' as never })).toThrow();
  });

  it('should reject non-positive requestTimeout', () => {
    expect(() => resolveConfig({ requestTimeout: 0 })).toThrow();
    expect(() => resolveConfig({ requestTimeout: -1 })).toThrow();
  });

  it('should reject non-positive maxNodes', () => {
    expect(() => resolveConfig({ maxNodes: 0 })).toThrow();
    expect(() => resolveConfig({ maxNodes: -100 })).toThrow();
  });

  it('should reject NaN values', () => {
    expect(() => resolveConfig({ scanCacheTtl: NaN })).toThrow();
  });
});

// ── isPathAllowed — path security ───────────────────────────────────────────

describe('isPathAllowed (security)', () => {
  beforeEach(() => {
    setAllowedWorkspaceRoots([]);
  });

  it('should allow "." and empty path', () => {
    expect(isPathAllowed('.')).toBe(true);
    expect(isPathAllowed('')).toBe(true);
  });

  it('should reject relative paths', () => {
    expect(isPathAllowed('relative/path')).toBe(false);
  });

  it('should reject paths with .. traversal (when not normalized away)', () => {
    expect(isPathAllowed('..')).toBe(false);
    expect(isPathAllowed('../etc/passwd')).toBe(false);
  });

  it('should reject absolute paths when no roots are set (fail-closed)', () => {
    expect(isPathAllowed('/home/user/project')).toBe(false);
    expect(isPathAllowed('/etc/passwd')).toBe(false);
  });

  it('should allow absolute paths within allowed roots', () => {
    setAllowedWorkspaceRoots(['/home/user/project']);
    expect(isPathAllowed('/home/user/project')).toBe(true);
    expect(isPathAllowed('/home/user/project/src')).toBe(true);
  });

  it('should reject absolute paths outside allowed roots', () => {
    setAllowedWorkspaceRoots(['/home/user/project']);
    expect(isPathAllowed('/home/user/other')).toBe(false);
    expect(isPathAllowed('/etc/passwd')).toBe(false);
  });
});

