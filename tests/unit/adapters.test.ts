// Unit tests for adapters, merger, and tool render helpers
import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraphAdapter } from '../../src/adapters/CodeGraphAdapter.ts';
import { LensAdapter } from '../../src/adapters/LensAdapter.ts';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';
import { summarizeGraph } from '../../src/tools.ts';
import type { GraphData, AdapterResult } from '../../src/types/index.ts';

type Invoke = (tool: string, args: Record<string, unknown>) => Promise<unknown | null>;

const mockInvoke: Invoke = async (tool) => {
  if (tool === 'codegraph_graph') {
    return {
      nodes: [{ id: 'n1', name: 'funcA', kind: 'function', file: 'a.ts', line: 10 }],
      edges: [{ id: 'e1', from: 'n1', to: 'n2', kind: 'call' }],
    };
  }
  if (tool === 'lens_analyze') {
    return {
      symbols: [{ id: 's1', name: 'classB', scope: 'global', file: 'b.ts', line: 5, category: 'class' }],
      references: [{ from: 's1', to: 'n1', relation: 'call' }],
    };
  }
  return null;
};

const makeNode = (id: string, label: string, type: string, file: string, line: number) => ({
  id, label, type: type as any, filePath: file, lineNumber: line, properties: {},
});
const makeEdge = (id: string, source: string, target: string, type: string) => ({
  id, source, target, type: type as any, properties: {},
});

describe('CodeGraphAdapter', () => {
  let adapter: CodeGraphAdapter;

  beforeEach(() => {
    adapter = new CodeGraphAdapter();
  });

  it('should fetch and transform data', async () => {
    const result = await adapter.fetchData('test-repo', mockInvoke);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].type).toBe('function');
    expect(result.edges).toHaveLength(1);
    expect(result.source).toBe('codegraph');
  });

  it('should map kinds correctly', async () => {
    const result = await adapter.fetchData('test-repo', mockInvoke);
    expect(result.nodes[0].label).toBe('funcA');
  });

  it('should return empty result when upstream tool is missing', async () => {
    const result = await adapter.fetchData('test-repo', async () => null);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});

describe('LensAdapter', () => {
  let adapter: LensAdapter;

  beforeEach(() => {
    adapter = new LensAdapter();
  });

  it('should fetch and transform lens data', async () => {
    const result = await adapter.fetchData('test-repo', mockInvoke);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].type).toBe('class');
    expect(result.source).toBe('lens');
  });

  it('should return empty result on upstream failure', async () => {
    const failingInvoke: Invoke = async () => {
      throw new Error('upstream failure');
    };
    const result = await adapter.fetchData('test-repo', failingInvoke);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});

describe('GraphDataMerger', () => {
  let merger: GraphDataMerger;

  beforeEach(() => {
    merger = new GraphDataMerger();
  });

  it('should merge multiple results', () => {
    const results = [
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

    const merged = merger.merge(results as AdapterResult[], 'test-repo');
    expect(merged.nodes).toHaveLength(2);
    expect(merged.edges).toHaveLength(2);
    expect(merged.metadata.nodeCount).toBe(2);
    expect(merged.metadata.edgeCount).toBe(2);
    expect(merged.metadata.repoId).toBe('test-repo');
  });

  it('should deduplicate nodes by id', () => {
    const results = [
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

    const merged = merger.merge(results as AdapterResult[], 'test-repo');
    expect(merged.nodes).toHaveLength(1);
  });

  describe('applyDelta', () => {
    it('should add new nodes and edges to existing graph', () => {
      const current: GraphData = {
        nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1) as any],
        edges: [makeEdge('e1', 'n1', 'n2', 'call') as any],
        metadata: { repoId: 'r1' as any, timestamp: 100, nodeCount: 1, edgeCount: 1 },
      };
      const delta: AdapterResult = {
        nodes: [makeNode('n2', 'B', 'class', 'b.ts', 2) as any],
        edges: [makeEdge('e2', 'n2', 'n1', 'extend') as any],
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
      const current: GraphData = {
        nodes: [makeNode('n1', 'OldLabel', 'function', 'a@deprecated', 1) as any],
        edges: [],
        metadata: { repoId: 'r1' as any, timestamp: 100, nodeCount: 1, edgeCount: 0 },
      };
      const delta: AdapterResult = {
        nodes: [makeNode('n1', 'NewLabel', 'function', 'a.ts', 42) as any],
        edges: [],
        source: 'codegraph',
        timestamp: 200,
      };

      const result = merger.applyDelta(current, delta);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toBe('NewLabel');
      expect(result.nodes[0].lineNumber).toBe(42);
    });

    it('should update edge metadata timestamp', () => {
      const current: GraphData = {
        nodes: [],
        edges: [],
        metadata: { repoId: 'r1' as any, timestamp: 100, nodeCount: 0, edgeCount: 0 },
      };
      const delta: AdapterResult = {
        nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1) as any],
        edges: [],
        source: 'codegraph',
        timestamp: 200,
      };

      const result = merger.applyDelta(current, delta);
      expect(result.metadata.timestamp).toBeGreaterThanOrEqual(200);
    });

    it('should handle empty delta', () => {
      const current: GraphData = {
        nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1) as any],
        edges: [],
        metadata: { repoId: 'r1' as any, timestamp: 100, nodeCount: 1, edgeCount: 0 },
      };
      const delta: AdapterResult = { nodes: [], edges: [], source: 'codegraph', timestamp: 200 };

      const result = merger.applyDelta(current, delta);
      expect(result.nodes).toHaveLength(1);
      expect(result.metadata.nodeCount).toBe(1);
    });
  });
});

describe('summarizeGraph', () => {
  it('should produce readable summary with node/edge stats', () => {
    const data: GraphData = {
      nodes: [
        makeNode('n1', 'funcA', 'function', 'a.ts', 10) as any,
        makeNode('n2', 'ClassB', 'class', 'b.ts', 5) as any,
      ],
      edges: [makeEdge('e1', 'n1', 'n2', 'call') as any],
      metadata: { repoId: 'r1' as any, timestamp: 1, nodeCount: 2, edgeCount: 1 },
    };

    const summary = summarizeGraph(data);
    expect(summary).toContain('2 nodes');
    expect(summary).toContain('1 edges');
    expect(summary).toContain('function:1');
    expect(summary).toContain('class:1');
    expect(summary).toContain('call:1');
    expect(summary).toContain('funcA');
  });

  it('should handle empty graph', () => {
    const data: GraphData = {
      nodes: [],
      edges: [],
      metadata: { repoId: 'r1' as any, timestamp: 1, nodeCount: 0, edgeCount: 0 },
    };

    const summary = summarizeGraph(data);
    expect(summary).toContain('0 nodes');
    expect(summary).toContain('0 edges');
  });

  it('should limit top nodes to 10', () => {
    const nodes = Array.from({ length: 15 }, (_, i) =>
      makeNode(`n${i}`, `func${i}`, 'function', `f${i}.ts`, i) as any
    );
    const data: GraphData = {
      nodes,
      edges: [],
      metadata: { repoId: 'r1' as any, timestamp: 1, nodeCount: 15, edgeCount: 0 },
    };

    const summary = summarizeGraph(data);
    expect(summary).toContain('15 nodes');
    expect(summary).toContain('func0');
    expect(summary).toContain('func9');
    expect(summary).not.toContain('func10');
  });
});
