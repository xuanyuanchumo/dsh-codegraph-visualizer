// Service-layer tests for actual business logic (J3–J11 user journeys).
import { describe, it, expect, beforeEach } from 'vitest';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';

import { coerceNode, coerceEdge, validateGraphData } from '../../src/client/validators.ts';
import { resolveConfig, DEFAULT_CONFIG } from '../../src/index.ts';
import { SecurityManager } from '../../src/host/security.ts';
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

  it('should accept panelMinHeight and panelDefaultHeight overrides', () => {
    const config = resolveConfig({ panelMinHeight: 300, panelDefaultHeight: 800 });
    expect(config.panelMinHeight).toBe(300);
    expect(config.panelDefaultHeight).toBe(800);
  });

  it('should reject non-positive panelMinHeight', () => {
    expect(() => resolveConfig({ panelMinHeight: 0 })).toThrow();
    expect(() => resolveConfig({ panelMinHeight: -10 })).toThrow();
  });

  it('should reject non-positive panelDefaultHeight', () => {
    expect(() => resolveConfig({ panelDefaultHeight: 0 })).toThrow();
    expect(() => resolveConfig({ panelDefaultHeight: -5 })).toThrow();
  });

  it('should reject panelDefaultHeight < panelMinHeight', () => {
    expect(() => resolveConfig({ panelMinHeight: 500, panelDefaultHeight: 400 })).toThrow();
  });
});

// ── SecurityManager — path security ───────────────────────────────────────────

describe('SecurityManager.isPathAllowed (security)', () => {
  let sm: SecurityManager;

  beforeEach(() => {
    sm = new SecurityManager();
    sm.setAllowedWorkspaceRoots([]);
  });

  it('should allow "." when roots are set, but reject empty path', () => {
    sm.setAllowedWorkspaceRoots(['/home/user/project']);
    expect(sm.isPathAllowed('.')).toBe(true);
    expect(sm.isPathAllowed('')).toBe(false);
  });

  it('should reject relative paths', () => {
    expect(sm.isPathAllowed('relative/path')).toBe(false);
  });

  it('should reject paths with .. traversal (when not normalized away)', () => {
    expect(sm.isPathAllowed('..')).toBe(false);
    expect(sm.isPathAllowed('../etc/passwd')).toBe(false);
  });

  it('should reject absolute paths when no roots are set (fail-closed)', () => {
    expect(sm.isPathAllowed('/home/user/project')).toBe(false);
    expect(sm.isPathAllowed('/etc/passwd')).toBe(false);
  });

  it('should allow absolute paths within allowed roots', () => {
    sm.setAllowedWorkspaceRoots(['/home/user/project']);
    expect(sm.isPathAllowed('/home/user/project')).toBe(true);
    expect(sm.isPathAllowed('/home/user/project/src')).toBe(true);
  });

  it('should reject absolute paths outside allowed roots', () => {
    sm.setAllowedWorkspaceRoots(['/home/user/project']);
    expect(sm.isPathAllowed('/home/user/other')).toBe(false);
    expect(sm.isPathAllowed('/etc/passwd')).toBe(false);
  });
});

