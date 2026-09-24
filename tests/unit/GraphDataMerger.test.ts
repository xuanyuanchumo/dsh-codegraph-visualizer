import { describe, it, expect, beforeEach } from 'vitest';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';
import { RepoId, NodeId, EdgeId } from '../../src/types/index.ts';
import type { AdapterResult, GraphNode, GraphEdge, GraphData } from '../../src/types/index.ts';

describe('GraphDataMerger', () => {
  let merger: GraphDataMerger;

  beforeEach(() => {
    merger = new GraphDataMerger();
  });

  // ── merge() ──────────────────────────────────────────────────────────────

  describe('merge()', () => {
    it('should merge two non-overlapping adapter results', () => {
      const result1: AdapterResult = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: {} },
          { id: NodeId('cls-b'), label: 'ClsB', type: 'class', filePath: '/b.ts', properties: {} },
        ],
        edges: [
          { id: EdgeId('e1'), source: NodeId('fn-a'), target: NodeId('cls-b'), type: 'call', properties: {} },
        ],
        source: 'codegraph',
        timestamp: 1000,
      };

      const result2: AdapterResult = {
        nodes: [
          { id: NodeId('fn-c'), label: 'fnC', type: 'function', filePath: '/c.ts', properties: {} },
        ],
        edges: [
          { id: EdgeId('e2'), source: NodeId('fn-c'), target: NodeId('fn-a'), type: 'call', properties: {} },
        ],
        source: 'lens',
        timestamp: 2000,
      };

      const merged = merger.merge([result1, result2], RepoId('repo1'));

      expect(merged.nodes).toHaveLength(3);
      expect(merged.edges).toHaveLength(2);
      expect(merged.metadata.nodeCount).toBe(3);
      expect(merged.metadata.edgeCount).toBe(2);
      expect(merged.metadata.repoId).toBe(RepoId('repo1'));
    });

    it('should deduplicate nodes with same id, merging properties', () => {
      const result1: AdapterResult = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: { complexity: 5 } },
        ],
        edges: [],
        source: 'codegraph',
        timestamp: 1000,
      };

      const result2: AdapterResult = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: { lines: 42 } },
        ],
        edges: [],
        source: 'lens',
        timestamp: 2000,
      };

      const merged = merger.merge([result1, result2], RepoId('repo1'));

      expect(merged.nodes).toHaveLength(1);
      expect(merged.nodes[0]!.properties).toMatchObject({ complexity: 5, lines: 42 });
      expect(merged.nodes[0]!.properties.__source).toBe('lens');
    });

    it('should deduplicate edges with same id, merging properties', () => {
      const result1: AdapterResult = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: {} },
          { id: NodeId('fn-b'), label: 'fnB', type: 'function', filePath: '/b.ts', properties: {} },
        ],
        edges: [
          { id: EdgeId('e1'), source: NodeId('fn-a'), target: NodeId('fn-b'), type: 'call', properties: { weight: 0.5 } },
        ],
        source: 'codegraph',
        timestamp: 1000,
      };

      const result2: AdapterResult = {
        nodes: [],
        edges: [
          { id: EdgeId('e1'), source: NodeId('fn-a'), target: NodeId('fn-b'), type: 'call', properties: { confirmed: true } },
        ],
        source: 'lens',
        timestamp: 2000,
      };

      const merged = merger.merge([result1, result2], RepoId('repo1'));

      expect(merged.edges).toHaveLength(1);
      expect(merged.edges[0]!.properties).toMatchObject({ weight: 0.5, confirmed: true });
      expect(merged.edges[0]!.properties.__source).toBe('lens');
    });

    it('should handle empty results array', () => {
      const merged = merger.merge([], RepoId('repo1'));

      expect(merged.nodes).toHaveLength(0);
      expect(merged.edges).toHaveLength(0);
      expect(merged.metadata.nodeCount).toBe(0);
      expect(merged.metadata.edgeCount).toBe(0);
    });

    it('should handle adapter result with empty nodes and edges', () => {
      const result: AdapterResult = {
        nodes: [],
        edges: [],
        source: 'codegraph',
        timestamp: 1000,
      };

      const merged = merger.merge([result], RepoId('repo1'));

      expect(merged.nodes).toHaveLength(0);
      expect(merged.edges).toHaveLength(0);
    });

    it('should tag each node with __source property', () => {
      const result: AdapterResult = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: {} },
        ],
        edges: [],
        source: 'codegraph',
        timestamp: 1000,
      };

      const merged = merger.merge([result], RepoId('repo1'));

      expect(merged.nodes[0]!.properties.__source).toBe('codegraph');
    });

    it('should tag each edge with __source property', () => {
      const result: AdapterResult = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: {} },
          { id: NodeId('fn-b'), label: 'fnB', type: 'function', filePath: '/b.ts', properties: {} },
        ],
        edges: [
          { id: EdgeId('e1'), source: NodeId('fn-a'), target: NodeId('fn-b'), type: 'call', properties: {} },
        ],
        source: 'lens',
        timestamp: 1000,
      };

      const merged = merger.merge([result], RepoId('repo1'));

      expect(merged.edges[0]!.properties.__source).toBe('lens');
    });

    it('should preserve node properties from both sources on conflict, with second source winning', () => {
      const result1: AdapterResult = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: { version: 1 } },
        ],
        edges: [],
        source: 'codegraph',
        timestamp: 1000,
      };

      const result2: AdapterResult = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA-updated', type: 'function', filePath: '/a.ts', properties: { version: 2 } },
        ],
        edges: [],
        source: 'lens',
        timestamp: 2000,
      };

      const merged = merger.merge([result1, result2], RepoId('repo1'));

      expect(merged.nodes).toHaveLength(1);
      expect(merged.nodes[0]!.label).toBe('fnA-updated');
      expect(merged.nodes[0]!.properties.version).toBe(2);
    });

    it('should set timestamp to current time', () => {
      const before = Date.now();
      const result: AdapterResult = {
        nodes: [],
        edges: [],
        source: 'codegraph',
        timestamp: 1000,
      };

      const merged = merger.merge([result], RepoId('repo1'));
      const after = Date.now();

      expect(merged.metadata.timestamp).toBeGreaterThanOrEqual(before);
      expect(merged.metadata.timestamp).toBeLessThanOrEqual(after);
    });
  });

  // ── applyDelta() ─────────────────────────────────────────────────────────

  describe('applyDelta()', () => {
    it('should add new nodes from delta to current graph', () => {
      const current: GraphData = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: {} },
        ],
        edges: [],
        metadata: { repoId: RepoId('repo1'), timestamp: 1000, nodeCount: 1, edgeCount: 0 },
      };

      const delta: AdapterResult = {
        nodes: [
          { id: NodeId('fn-b'), label: 'fnB', type: 'function', filePath: '/b.ts', properties: {} },
        ],
        edges: [],
        source: 'codegraph',
        timestamp: 2000,
      };

      const result = merger.applyDelta(current, delta);

      expect(result.nodes).toHaveLength(2);
      expect(result.metadata.nodeCount).toBe(2);
    });

    it('should update existing nodes with delta data, merging properties', () => {
      const current: GraphData = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: { complexity: 5 } },
        ],
        edges: [],
        metadata: { repoId: RepoId('repo1'), timestamp: 1000, nodeCount: 1, edgeCount: 0 },
      };

      const delta: AdapterResult = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA-updated', type: 'function', filePath: '/a.ts', properties: { lines: 42 } },
        ],
        edges: [],
        source: 'codegraph',
        timestamp: 2000,
      };

      const result = merger.applyDelta(current, delta);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.label).toBe('fnA-updated');
      expect(result.nodes[0]!.properties.complexity).toBe(5);
      expect(result.nodes[0]!.properties.lines).toBe(42);
    });

    it('should add new edges from delta to current graph', () => {
      const current: GraphData = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: {} },
          { id: NodeId('fn-b'), label: 'fnB', type: 'function', filePath: '/b.ts', properties: {} },
        ],
        edges: [],
        metadata: { repoId: RepoId('repo1'), timestamp: 1000, nodeCount: 2, edgeCount: 0 },
      };

      const delta: AdapterResult = {
        nodes: [],
        edges: [
          { id: EdgeId('e1'), source: NodeId('fn-a'), target: NodeId('fn-b'), type: 'call', properties: {} },
        ],
        source: 'codegraph',
        timestamp: 2000,
      };

      const result = merger.applyDelta(current, delta);

      expect(result.edges).toHaveLength(1);
      expect(result.metadata.edgeCount).toBe(1);
    });

    it('should update existing edges with delta data', () => {
      const current: GraphData = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: {} },
          { id: NodeId('fn-b'), label: 'fnB', type: 'function', filePath: '/b.ts', properties: {} },
        ],
        edges: [
          { id: EdgeId('e1'), source: NodeId('fn-a'), target: NodeId('fn-b'), type: 'call', properties: { weight: 0.3 } },
        ],
        metadata: { repoId: RepoId('repo1'), timestamp: 1000, nodeCount: 2, edgeCount: 1 },
      };

      const delta: AdapterResult = {
        nodes: [],
        edges: [
          { id: EdgeId('e1'), source: NodeId('fn-a'), target: NodeId('fn-b'), type: 'call', properties: { weight: 0.8 } },
        ],
        source: 'codegraph',
        timestamp: 2000,
      };

      const result = merger.applyDelta(current, delta);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.properties.weight).toBe(0.8);
    });

    it('should preserve current metadata repoId', () => {
      const current: GraphData = {
        nodes: [],
        edges: [],
        metadata: { repoId: RepoId('repo1'), timestamp: 1000, nodeCount: 0, edgeCount: 0 },
      };

      const delta: AdapterResult = {
        nodes: [],
        edges: [],
        source: 'codegraph',
        timestamp: 2000,
      };

      const result = merger.applyDelta(current, delta);

      expect(result.metadata.repoId).toBe(RepoId('repo1'));
    });

    it('should update timestamp to current time', () => {
      const current: GraphData = {
        nodes: [],
        edges: [],
        metadata: { repoId: RepoId('repo1'), timestamp: 1000, nodeCount: 0, edgeCount: 0 },
      };

      const before = Date.now();
      const delta: AdapterResult = {
        nodes: [],
        edges: [],
        source: 'codegraph',
        timestamp: 2000,
      };

      const result = merger.applyDelta(current, delta);
      const after = Date.now();

      expect(result.metadata.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.metadata.timestamp).toBeLessThanOrEqual(after);
    });

    it('should handle delta with empty nodes and edges', () => {
      const current: GraphData = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: {} },
        ],
        edges: [
          { id: EdgeId('e1'), source: NodeId('fn-a'), target: NodeId('fn-a'), type: 'call', properties: {} },
        ],
        metadata: { repoId: RepoId('repo1'), timestamp: 1000, nodeCount: 1, edgeCount: 1 },
      };

      const delta: AdapterResult = {
        nodes: [],
        edges: [],
        source: 'codegraph',
        timestamp: 2000,
      };

      const result = merger.applyDelta(current, delta);

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(1);
    });

    it('should not mutate the original current graph data', () => {
      const current: GraphData = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: { v: 1 } },
        ],
        edges: [],
        metadata: { repoId: RepoId('repo1'), timestamp: 1000, nodeCount: 1, edgeCount: 0 },
      };

      const delta: AdapterResult = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA-updated', type: 'function', filePath: '/a.ts', properties: { v: 2 } },
        ],
        edges: [],
        source: 'codegraph',
        timestamp: 2000,
      };

      merger.applyDelta(current, delta);

      expect(current.nodes[0]!.label).toBe('fnA');
      expect(current.nodes[0]!.properties.v).toBe(1);
    });

    it('should handle both new and updated nodes in same delta', () => {
      const current: GraphData = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA', type: 'function', filePath: '/a.ts', properties: { old: true } },
        ],
        edges: [],
        metadata: { repoId: RepoId('repo1'), timestamp: 1000, nodeCount: 1, edgeCount: 0 },
      };

      const delta: AdapterResult = {
        nodes: [
          { id: NodeId('fn-a'), label: 'fnA-new', type: 'function', filePath: '/a.ts', properties: { new: true } },
          { id: NodeId('fn-b'), label: 'fnB', type: 'function', filePath: '/b.ts', properties: {} },
        ],
        edges: [],
        source: 'codegraph',
        timestamp: 2000,
      };

      const result = merger.applyDelta(current, delta);

      expect(result.nodes).toHaveLength(2);
      const nodeA = result.nodes.find(n => n.id === NodeId('fn-a'));
      const nodeB = result.nodes.find(n => n.id === NodeId('fn-b'));
      expect(nodeA?.label).toBe('fnA-new');
      expect(nodeA?.properties.old).toBe(true);
      expect(nodeA?.properties.new).toBe(true);
      expect(nodeB?.label).toBe('fnB');
    });
  });
});