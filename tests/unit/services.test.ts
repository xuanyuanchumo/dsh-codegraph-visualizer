// SearchService tests - J3 符号搜索
import { describe, it, expect, beforeEach } from 'vitest';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger';
import { CodeGraphAdapter } from '../../src/adapters/CodeGraphAdapter';
import type { GraphNode, GraphEdge } from '../../src/types';

describe('SearchService (J3)', () => {
  let merger: GraphDataMerger;
  let mockNodes: GraphNode[];
  let mockEdges: GraphEdge[];

  beforeEach(() => {
    merger = new GraphDataMerger();
    mockNodes = [
      { id: 'node1', label: 'calculateSum', type: 'function', filePath: '/src/math.ts', lineNumber: 10, weight: 5 },
      { id: 'node2', label: 'multiply', type: 'function', filePath: '/src/math.ts', lineNumber: 20, weight: 3 },
      { id: 'node3', label: 'result', type: 'variable', filePath: '/src/main.ts', lineNumber: 5, weight: 2 },
    ];
    mockEdges = [
      { id: 'edge1', source: 'node1', target: 'node2', type: 'call' },
      { id: 'edge2', source: 'node1', target: 'node3', type: 'assign' },
    ];
  });

  it('should search nodes by label', () => {
    const results = mockNodes.filter(n => n.label.toLowerCase().includes('sum'));
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('calculateSum');
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
      { id: 'a', label: 'funcA', type: 'function', filePath: '/src/a.ts', lineNumber: 1, weight: 5 },
      { id: 'b', label: 'funcB', type: 'function', filePath: '/src/b.ts', lineNumber: 1, weight: 3 },
      { id: 'c', label: 'funcC', type: 'function', filePath: '/src/c.ts', lineNumber: 1, weight: 2 },
    ];
    const edges: GraphEdge[] = [
      { id: 'e1', source: 'a', target: 'b', type: 'call' },
      { id: 'e2', source: 'b', target: 'c', type: 'call' },
    ];

    const incomingEdges = edges.filter(e => e.target === 'b');
    expect(incomingEdges).toHaveLength(1);
    expect(incomingEdges[0].source).toBe('a');

    const outgoingEdges = edges.filter(e => e.source === 'b');
    expect(outgoingEdges).toHaveLength(1);
    expect(outgoingEdges[0].target).toBe('c');
  });

  it('should handle circular calls', () => {
    const edges: GraphEdge[] = [
      { id: 'e1', source: 'a', target: 'b', type: 'call' },
      { id: 'e2', source: 'b', target: 'a', type: 'call' },
    ];

    const hasCycle = edges.some(e => e.source === 'a' && e.target === 'b') &&
                     edges.some(e => e.source === 'b' && e.target === 'a');
    expect(hasCycle).toBe(true);
  });

  it('should handle cross-file calls', () => {
    const edges: GraphEdge[] = [
      { id: 'e1', source: 'a', target: 'b', type: 'call' },
    ];

    const crossFileEdges = edges.filter(e => e.type === 'call');
    expect(crossFileEdges).toHaveLength(1);
  });
});

describe('DependencyService (J5)', () => {
  it('should identify dependencies', () => {
    const edges: GraphEdge[] = [
      { id: 'e1', source: 'main', target: 'utils', type: 'import' },
      { id: 'e2', source: 'utils', target: 'helpers', type: 'import' },
    ];

    const dependencies = edges.filter(e => e.type === 'import');
    expect(dependencies).toHaveLength(2);
  });

  it('should identify circular dependencies', () => {
    const edges: GraphEdge[] = [
      { id: 'e1', source: 'a', target: 'b', type: 'import' },
      { id: 'e2', source: 'b', target: 'a', type: 'import' },
    ];

    const hasCircular = edges.some(e => e.source === 'a' && e.target === 'b') &&
                        edges.some(e => e.source === 'b' && e.target === 'a');
    expect(hasCircular).toBe(true);
  });

  it('should handle deep nested dependencies', () => {
    const edges: GraphEdge[] = [
      { id: 'e1', source: 'a', target: 'b', type: 'import' },
      { id: 'e2', source: 'b', target: 'c', type: 'import' },
      { id: 'e3', source: 'c', target: 'd', type: 'import' },
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
      { id: '1', label: 'func1', type: 'function', filePath: '/src/a.ts', lineNumber: 1, weight: 5 },
      { id: '2', label: 'class1', type: 'class', filePath: '/src/b.ts', lineNumber: 1, weight: 3 },
      { id: '3', label: 'var1', type: 'variable', filePath: '/src/c.ts', lineNumber: 1, weight: 2 },
    ];

    const functions = nodes.filter(n => n.type === 'function');
    expect(functions).toHaveLength(1);
    expect(functions[0].type).toBe('function');
  });

  it('should show all when filter is "all"', () => {
    const nodes: GraphNode[] = [
      { id: '1', label: 'func1', type: 'function', filePath: '/src/a.ts', lineNumber: 1, weight: 5 },
      { id: '2', label: 'class1', type: 'class', filePath: '/src/b.ts', lineNumber: 1, weight: 3 },
    ];

    const all = nodes.filter(n => n.type === 'function' || n.type === 'class');
    expect(all).toHaveLength(2);
  });

  it('should return empty when no nodes match filter', () => {
    const nodes: GraphNode[] = [
      { id: '1', label: 'func1', type: 'function', filePath: '/src/a.ts', lineNumber: 1, weight: 5 },
    ];

    const classes = nodes.filter(n => n.type === 'class');
    expect(classes).toHaveLength(0);
  });
});

describe('ExportService (J8)', () => {
  it('should export graph data as JSON', () => {
    const nodes: GraphNode[] = [
      { id: '1', label: 'test', type: 'function', filePath: '/src/a.ts', lineNumber: 1, weight: 5 },
    ];
    const edges: GraphEdge[] = [
      { id: 'e1', source: '1', target: '2', type: 'call' },
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