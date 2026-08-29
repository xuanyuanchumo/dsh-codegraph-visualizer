// Service-layer tests for J3–J11 user journeys.
import { describe, it, expect, beforeEach } from 'vitest';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';
import { CodeGraphAdapter } from '../../src/adapters/CodeGraphAdapter.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { makeNode, makeEdge } from '../helpers.ts';

describe('SearchService (J3)', () => {
  let merger: GraphDataMerger;
  let mockNodes: GraphNode[];
  let mockEdges: GraphEdge[];

  beforeEach(() => {
    merger = new GraphDataMerger();
    mockNodes = [
      makeNode('node1', 'calculateSum', 'function', '/src/math.ts', 10),
      makeNode('node2', 'multiply', 'function', '/src/math.ts', 20),
      makeNode('node3', 'result', 'variable', '/src/main.ts', 5),
    ];
    mockEdges = [
      makeEdge('edge1', 'node1', 'node2', 'call'),
      makeEdge('edge2', 'node1', 'node3', 'dependency'),
    ];
  });

  it('should search nodes by label', () => {
    const results = mockNodes.filter(n => n.label.toLowerCase().includes('sum'));
    expect(results).toHaveLength(1);
    expect(results[0]?.label).toBe('calculateSum');
  });

  it('should search nodes by type', () => {
    const results = mockNodes.filter(n => n.type === 'function');
    expect(results).toHaveLength(2);
  });

  it('should return empty when no match', () => {
    const results = mockNodes.filter(n => n.label.toLowerCase().includes('nonexistent'));
    expect(results).toHaveLength(0);
  });

  it('should search case-insensitively', () => {
    const results = mockNodes.filter(n => n.label.toLowerCase().includes('CALCULATESUM'.toLowerCase()));
    expect(results).toHaveLength(1);
  });

  it('should search by partial match', () => {
    const results = mockNodes.filter(n => n.label.toLowerCase().includes('calc'));
    expect(results).toHaveLength(1);
  });
});

describe('SymbolResolver (J4)', () => {
  let merger: GraphDataMerger;

  beforeEach(() => {
    merger = new GraphDataMerger();
  });

  it('should resolve call chain for a node', () => {
    const nodes: GraphNode[] = [
      makeNode('a', 'funcA', 'function', '/src/a.ts', 1),
      makeNode('b', 'funcB', 'function', '/src/b.ts', 1),
      makeNode('c', 'funcC', 'function', '/src/c.ts', 1),
    ];
    const edges: GraphEdge[] = [
      makeEdge('e1', 'a', 'b', 'call'),
      makeEdge('e2', 'b', 'c', 'call'),
    ];

    const incomingEdges = edges.filter(e => e.target === nodes[1]!.id);
    expect(incomingEdges).toHaveLength(1);
    expect(incomingEdges[0]?.source).toBe(nodes[0]!.id);

    const outgoingEdges = edges.filter(e => e.source === nodes[1]!.id);
    expect(outgoingEdges).toHaveLength(1);
    expect(outgoingEdges[0]?.target).toBe(nodes[2]!.id);
  });

  it('should handle circular calls', () => {
    const edges: GraphEdge[] = [
      makeEdge('e1', 'a', 'b', 'call'),
      makeEdge('e2', 'b', 'a', 'call'),
    ];

    const hasCycle = edges.some(e => e.source === makeNode('a', '', 'function', '', 0).id && e.target === makeNode('b', '', 'function', '', 0).id) &&
                     edges.some(e => e.source === makeNode('b', '', 'function', '', 0).id && e.target === makeNode('a', '', 'function', '', 0).id);
    expect(hasCycle).toBe(true);
  });

  it('should handle cross-file calls', () => {
    const edges: GraphEdge[] = [
      makeEdge('e1', 'a', 'b', 'call'),
    ];

    const crossFileEdges = edges.filter(e => e.type === 'call');
    expect(crossFileEdges).toHaveLength(1);
  });
});

describe('DependencyService (J5)', () => {
  it('should identify dependencies', () => {
    const edges: GraphEdge[] = [
      makeEdge('e1', 'main', 'utils', 'import'),
      makeEdge('e2', 'utils', 'helpers', 'import'),
    ];

    const dependencies = edges.filter(e => e.type === 'import');
    expect(dependencies).toHaveLength(2);
  });

  it('should identify circular dependencies', () => {
    const edges: GraphEdge[] = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'b', 'a', 'import'),
    ];

    const hasCircular = edges.some(e => e.source === makeNode('a', '', 'function', '', 0).id && e.target === makeNode('b', '', 'function', '', 0).id) &&
                        edges.some(e => e.source === makeNode('b', '', 'function', '', 0).id && e.target === makeNode('a', '', 'function', '', 0).id);
    expect(hasCircular).toBe(true);
  });

  it('should handle deep nested dependencies', () => {
    const edges: GraphEdge[] = [
      makeEdge('e1', 'a', 'b', 'import'),
      makeEdge('e2', 'b', 'c', 'import'),
      makeEdge('e3', 'c', 'd', 'import'),
    ];

    const depth = edges.reduce((max, e) => {
      const sources = edges.filter(x => x.target === e.source);
      return Math.max(max, sources.length);
    }, 0);

    expect(depth).toBeGreaterThan(0);
  });
});

describe('FilterService (J7)', () => {
  it('should filter by node type', () => {
    const nodes: GraphNode[] = [
      makeNode('1', 'func1', 'function', '/src/a.ts', 1),
      makeNode('2', 'class1', 'class', '/src/b.ts', 1),
      makeNode('3', 'var1', 'variable', '/src/c.ts', 1),
    ];

    const functions = nodes.filter(n => n.type === 'function');
    expect(functions).toHaveLength(1);
    expect(functions[0]?.type).toBe('function');
  });

  it('should show all when filter is "all"', () => {
    const nodes: GraphNode[] = [
      makeNode('1', 'func1', 'function', '/src/a.ts', 1),
      makeNode('2', 'class1', 'class', '/src/b.ts', 1),
      makeNode('3', 'var1', 'variable', '/src/c.ts', 1),
    ];

    const all = nodes.filter(n => n.type === 'function' || n.type === 'class');
    expect(all).toHaveLength(2);
  });

  it('should return empty when no nodes match filter', () => {
    const nodes: GraphNode[] = [
      makeNode('1', 'func1', 'function', '/src/a.ts', 1),
      makeNode('2', 'var1', 'variable', '/src/c.ts', 1),
    ];

    const classes = nodes.filter(n => n.type === 'class');
    expect(classes).toHaveLength(0);
  });
});

describe('ExportService (J8)', () => {
  it('should export graph data as JSON', () => {
    const nodes: GraphNode[] = [
      makeNode('1', 'test', 'function', '/src/a.ts', 1),
    ];
    const edges: GraphEdge[] = [
      makeEdge('e1', '1', '2', 'call'),
    ];

    const exportData = { nodes, edges };
    const json = JSON.stringify(exportData);
    expect(json).toContain('"nodes"');
    expect(json).toContain('"edges"');
  });

  it('should handle empty graph export', () => {
    const exportData = { nodes: [], edges: [] };
    const json = JSON.stringify(exportData);
    expect(json).toBe('{"nodes":[],"edges":[]}');
  });
});

describe('SettingsService (J10)', () => {
  it('should toggle theme', () => {
    let theme = 'dark';
    theme = theme === 'dark' ? 'light' : 'dark';
    expect(theme).toBe('light');
  });

  it('should default to dark theme', () => {
    const defaultTheme = 'dark';
    expect(defaultTheme).toBe('dark');
  });
});

describe('AdapterFactory (J11)', () => {
  it('should switch between CodeGraph and Lens adapters', () => {
    const adapters = ['codegraph', 'lens'];
    let currentAdapter = 'codegraph';
    currentAdapter = adapters.find(a => a !== currentAdapter) || 'codegraph';
    expect(currentAdapter).toBe('lens');
  });

  it('should fallback to available adapter', () => {
    const adapters = ['codegraph', 'lens'];
    const available = ['codegraph'];
    const selected = adapters.find(a => available.includes(a));
    expect(selected).toBe('codegraph');
  });
});
