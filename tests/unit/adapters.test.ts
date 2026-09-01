// Unit tests for adapters, merger, and tool render helpers
// Note: CodeGraphAdapter reads .codegraph/codegraph.db directly via node:sqlite.
// In tests we test the pure transform functions and merger logic, which don't
// depend on the live .codegraph DB.
import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraphAdapter, mapNodeKind, mapEdgeKind } from '../../src/adapters/CodeGraphAdapter.ts';
import { LensAdapter } from '../../src/adapters/LensAdapter.ts';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';
import { summarizeGraph } from '../../src/tools.ts';
import type { AdapterResult } from '../../src/types/index.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';

describe('CodeGraphAdapter', () => {
  let adapter: CodeGraphAdapter;

  beforeEach(() => {
    adapter = new CodeGraphAdapter();
  });

  it('should have a source property', () => {
    expect((adapter as unknown as { source: string }).source).toBe('codegraph');
  });
});

describe('LensAdapter', () => {
  let adapter: LensAdapter;

  beforeEach(() => {
    adapter = new LensAdapter();
  });

  it('should have a source property', () => {
    expect((adapter as unknown as { source: string }).source).toBe('lens');
  });

  it('should return empty result on upstream failure', async () => {
    const failingInvoke = async () => {
      throw new Error('upstream failure');
    };
    const result = await adapter.fetchData('test-repo', failingInvoke);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});

describe('mapNodeKind', () => {
  it('should map known kinds', () => {
    expect(mapNodeKind('function')).toBe('function');
    expect(mapNodeKind('method')).toBe('function');
    expect(mapNodeKind('class')).toBe('class');
    expect(mapNodeKind('interface')).toBe('interface');
    expect(mapNodeKind('type_alias')).toBe('type');
    expect(mapNodeKind('constant')).toBe('variable');
    expect(mapNodeKind('variable')).toBe('variable');
    expect(mapNodeKind('file')).toBe('module');
    expect(mapNodeKind('import')).toBe('module');
  });

  it('should default unknown kinds to module', () => {
    expect(mapNodeKind('unknown')).toBe('module');
  });
});

describe('mapEdgeKind', () => {
  it('should map known edge kinds', () => {
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
  });

  it('should default unknown edge kinds to dependency', () => {
    expect(mapEdgeKind('unknown')).toBe('dependency');
  });
});

describe('GraphDataMerger', () => {
  let merger: GraphDataMerger;

  beforeEach(() => {
    merger = new GraphDataMerger();
  });

  it('should merge multiple results', () => {
    const results: AdapterResult[] = [
      {
        nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        edges: [makeEdge('e1', 'n1', 'n2', 'call')],
        source: 'codegraph',
        timestamp: 1,
      },
      {
        nodes: [makeNode('n2', 'B', 'class', 'b.ts', 1)],
        edges: [makeEdge('e2', 'n2', 'n1', 'extend')],
        source: 'lens',
        timestamp: 2,
      },
    ];

    const merged = merger.merge(results, 'test-repo');
    expect(merged.nodes).toHaveLength(2);
    expect(merged.edges).toHaveLength(2);
    expect(merged.metadata.nodeCount).toBe(2);
    expect(merged.metadata.edgeCount).toBe(2);
    expect(merged.metadata.repoId).toBe('test-repo');
  });

  it('should deduplicate nodes by id', () => {
    const results: AdapterResult[] = [
      {
        nodes: [
          makeNode('n1', 'A', 'function', 'a.ts', 1),
          makeNode('n1', 'A', 'class', 'a.ts', 1),
        ],
        edges: [],
        source: 'codegraph',
        timestamp: 1,
      },
    ];

    const merged = merger.merge(results, 'test-repo');
    expect(merged.nodes).toHaveLength(1);
  });

  describe('applyDelta', () => {
    it('should add new nodes and edges to existing graph', () => {
      const current = makeGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [makeEdge('e1', 'n1', 'n2', 'call')],
        'r1',
        100,
      );
      const delta: AdapterResult = {
        nodes: [makeNode('n2', 'B', 'class', 'b.ts', 2)],
        edges: [makeEdge('e2', 'n2', 'n1', 'extend')],
        source: 'lens',
        timestamp: 200,
      };

      const result = merger.applyDelta(current, delta);
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(2);
      expect(result.metadata.nodeCount).toBe(2);
      expect(result.metadata.edgeCount).toBe(2);
    });

    it('should update existing node when delta has same id', () => {
      const current = makeGraphData(
        [makeNode('n1', 'OldLabel', 'function', 'a@deprecated', 1)],
        [],
        'r1',
        100,
      );
      const delta: AdapterResult = {
        nodes: [makeNode('n1', 'NewLabel', 'function', 'a.ts', 42)],
        edges: [],
        source: 'codegraph',
        timestamp: 200,
      };

      const result = merger.applyDelta(current, delta);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]?.label).toBe('NewLabel');
      expect(result.nodes[0]?.lineNumber).toBe(42);
    });

    it('should handle empty delta', () => {
      const current = makeGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'r1',
        100,
      );
      const delta: AdapterResult = { nodes: [], edges: [], source: 'codegraph', timestamp: 200 };

      const result = merger.applyDelta(current, delta);
      expect(result.nodes).toHaveLength(1);
      expect(result.metadata.nodeCount).toBe(1);
    });
  });
});

describe('summarizeGraph', () => {
  it('should produce readable summary with node/edge stats', () => {
    const data = makeGraphData(
      [
        makeNode('n1', 'funcA', 'function', 'a.ts', 10),
        makeNode('n2', 'ClassB', 'class', 'b.ts', 5),
      ],
      [makeEdge('e1', 'n1', 'n2', 'call')],
      'r1',
      1,
    );

    const summary = summarizeGraph(data);
    expect(summary).toContain('2 nodes');
    expect(summary).toContain('1 edges');
    expect(summary).toContain('function:1');
    expect(summary).toContain('class:1');
    expect(summary).toContain('call:1');
    expect(summary).toContain('funcA');
  });

  it('should handle empty graph', () => {
    const data = makeGraphData([], [], 'r1', 1);

    const summary = summarizeGraph(data);
    expect(summary).toContain('0 nodes');
    expect(summary).toContain('0 edges');
  });
});
