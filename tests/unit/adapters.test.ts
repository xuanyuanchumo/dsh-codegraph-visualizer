// Unit tests for GraphDataMerger
import { describe, it, expect, beforeEach } from 'vitest';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';
import type { AdapterResult } from '../../src/types/index.ts';
import { RepoId } from '../../src/types/index.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';

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

    const merged = merger.merge(results, RepoId('test-repo'));
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

    const merged = merger.merge(results, RepoId('test-repo'));
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

    it('should update existing edge when delta has same id', () => {
      const current = makeGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1), makeNode('n2', 'B', 'class', 'b.ts', 2)],
        [makeEdge('e1', 'n1', 'n2', 'call')],
        'r1',
        100,
      );
      const delta: AdapterResult = {
        nodes: [],
        edges: [makeEdge('e1', 'n1', 'n2', 'import')],
        source: 'lens',
        timestamp: 200,
      };

      const result = merger.applyDelta(current, delta);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]?.type).toBe('import');
    });

    it('should preserve repoId from current metadata', () => {
      const current = makeGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'my-repo',
        100,
      );
      const delta: AdapterResult = {
        nodes: [makeNode('n2', 'B', 'class', 'b.ts', 2)],
        edges: [],
        source: 'codegraph',
        timestamp: 200,
      };

      const result = merger.applyDelta(current, delta);
      expect(result.metadata.repoId).toBe('my-repo');
    });

    it('should update timestamp from delta', () => {
      const current = makeGraphData(
        [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        [],
        'r1',
        100,
      );
      const delta: AdapterResult = {
        nodes: [],
        edges: [],
        source: 'codegraph',
        timestamp: 999,
      };

      const result = merger.applyDelta(current, delta);
      expect(result.metadata.timestamp).toBeGreaterThanOrEqual(999);
    });
  });

  it('should merge empty results array', () => {
    const merged = merger.merge([], RepoId('empty-repo'));
    expect(merged.nodes).toEqual([]);
    expect(merged.edges).toEqual([]);
    expect(merged.metadata.nodeCount).toBe(0);
    expect(merged.metadata.edgeCount).toBe(0);
    expect(merged.metadata.repoId).toBe('empty-repo');
  });

  it('should deduplicate edges by id', () => {
    const results: AdapterResult[] = [
      {
        nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        edges: [makeEdge('e1', 'n1', 'n2', 'call')],
        source: 'codegraph',
        timestamp: 1,
      },
      {
        nodes: [],
        edges: [makeEdge('e1', 'n1', 'n2', 'import')],
        source: 'lens',
        timestamp: 2,
      },
    ];

    const merged = merger.merge(results, RepoId('test-repo'));
    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0]?.type).toBe('import');
  });

  it('should merge single result', () => {
    const results: AdapterResult[] = [
      {
        nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        edges: [makeEdge('e1', 'n1', 'n2', 'call')],
        source: 'codegraph',
        timestamp: 1,
      },
    ];

    const merged = merger.merge(results, RepoId('single-repo'));
    expect(merged.nodes).toHaveLength(1);
    expect(merged.edges).toHaveLength(1);
    expect(merged.metadata.repoId).toBe('single-repo');
  });
});

describe('applyDelta properties deep merge', () => {
  it('should deep merge node properties: existing {a:1,b:2} + delta {b:3,c:4} = {a:1,b:3,c:4}', () => {
    const merger = new GraphDataMerger();
    const current = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1, { a: 1, b: 2 })],
      [],
      'test-repo',
    );
    const delta: AdapterResult = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1, { b: 3, c: 4 })],
      edges: [],
      source: 'codegraph',
      timestamp: 2,
    };
    const result = merger.applyDelta(current, delta);
    expect(result.nodes[0]?.properties).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('should deep merge edge properties', () => {
    const merger = new GraphDataMerger();
    const current = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      [makeEdge('e1', 'n1', 'n1', 'call', { x: 'old' })],
      'test-repo',
    );
    const delta: AdapterResult = {
      nodes: [],
      edges: [makeEdge('e1', 'n1', 'n1', 'call', { x: 'new', y: 'added' })],
      source: 'codegraph',
      timestamp: 2,
    };
    const result = merger.applyDelta(current, delta);
    expect(result.edges[0]?.properties).toEqual({ x: 'new', y: 'added' });
  });

  it('should preserve existing properties not in delta', () => {
    const merger = new GraphDataMerger();
    const current = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1, { a: 1, b: 2, c: 3 })],
      [],
      'test-repo',
    );
    const delta: AdapterResult = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1, { b: 99 })],
      edges: [],
      source: 'codegraph',
      timestamp: 2,
    };
    const result = merger.applyDelta(current, delta);
    expect(result.nodes[0]?.properties).toEqual({ a: 1, b: 99, c: 3 });
  });

  it('should keep all existing properties when delta properties is empty', () => {
    const merger = new GraphDataMerger();
    const current = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1, { a: 1, b: 2 })],
      [],
      'test-repo',
    );
    const delta: AdapterResult = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1, {})],
      edges: [],
      source: 'codegraph',
      timestamp: 2,
    };
    const result = merger.applyDelta(current, delta);
    expect(result.nodes[0]?.properties).toEqual({ a: 1, b: 2 });
  });

  it('should use delta properties when existing properties is empty', () => {
    const merger = new GraphDataMerger();
    const current = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1, {})],
      [],
      'test-repo',
    );
    const delta: AdapterResult = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: 'new' })],
      edges: [],
      source: 'codegraph',
      timestamp: 2,
    };
    const result = merger.applyDelta(current, delta);
    expect(result.nodes[0]?.properties).toEqual({ x: 'new' });
  });
});
