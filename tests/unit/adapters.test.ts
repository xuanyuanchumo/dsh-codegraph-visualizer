// Unit tests for adapters and merger
import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraphAdapter } from '../adapters/CodeGraphAdapter';
import { LensAdapter } from '../adapters/LensAdapter';
import { GraphDataMerger } from '../merger/GraphDataMerger';

const mockCtx = {
  tools: {
    invoke: async (tool: string, args: Record<string, unknown>) => {
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
    },
  },
  broadcast: () => {},
};

describe('CodeGraphAdapter', () => {
  let adapter: CodeGraphAdapter;

  beforeEach(() => {
    adapter = new CodeGraphAdapter();
  });

  it('should fetch and transform data', async () => {
    const result = await adapter.fetchData('test-repo', mockCtx);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].type).toBe('function');
    expect(result.edges).toHaveLength(1);
    expect(result.source).toBe('codegraph');
  });

  it('should map kinds correctly', async () => {
    const result = await adapter.fetchData('test-repo', mockCtx);
    expect(result.nodes[0].label).toBe('funcA');
  });
});

describe('LensAdapter', () => {
  let adapter: LensAdapter;

  beforeEach(() => {
    adapter = new LensAdapter();
  });

  it('should fetch and transform lens data', async () => {
    const result = await adapter.fetchData('test-repo', mockCtx);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].type).toBe('class');
    expect(result.source).toBe('lens');
  });

  it('should return empty result on failure', async () => {
    const failingCtx = {
      tools: { invoke: async () => { throw new Error('fail'); } },
      broadcast: () => {},
    };
    const result = await adapter.fetchData('test-repo', failingCtx as any);
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
        nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} }],
        source: 'codegraph',
        timestamp: 1,
      },
      {
        nodes: [{ id: 'n2', label: 'B', type: 'class', filePath: 'b.ts', lineNumber: 1, properties: {} }],
        edges: [{ id: 'e2', source: 'n2', target: 'n1', type: 'extend', properties: {} }],
        source: 'lens',
        timestamp: 2,
      },
    ];

    const merged = merger.merge(results as any, 'test-repo');
    expect(merged.nodes).toHaveLength(2);
    expect(merged.edges).toHaveLength(2);
    expect(merged.metadata.nodeCount).toBe(2);
    expect(merged.metadata.edgeCount).toBe(2);
  });

  it('should deduplicate nodes', () => {
    const results = [
      {
        nodes: [{ id: 'n1', label: 'A', type: 'function', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        source: 'codegraph',
        timestamp: 1,
      },
      {
        nodes: [{ id: 'n1', label: 'A', type: 'class', filePath: 'a.ts', lineNumber: 1, properties: {} }],
        edges: [],
        source: 'lens',
        timestamp: 2,
      },
    ];

    const merged = merger.merge(results as any, 'test-repo');
    expect(merged.nodes).toHaveLength(1);
  });
});