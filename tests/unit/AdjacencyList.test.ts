import { describe, it, expect } from 'vitest';
import {
  buildForwardAdjacency,
  buildBackwardAdjacency,
  buildDirectedAdjacency,
  buildUndirectedAdjacency,
  buildFilteredUndirectedAdjacency,
  buildFilteredForwardAdjacency,
} from '../../src/shared/analysis/AdjacencyList.ts';
import type { GraphEdge } from '../../src/types/index.ts';

function makeEdge(id: string, source: string, target: string, type: GraphEdge['type'] = 'call'): GraphEdge {
  return { id, source, target, type, properties: {} } as GraphEdge;
}

describe('AdjacencyList', () => {
  describe('buildForwardAdjacency', () => {
    it('builds forward adjacency from edges', () => {
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'a', 'c'),
        makeEdge('e3', 'b', 'c'),
      ];
      const result = buildForwardAdjacency(edges);
      expect(result.get('a')).toEqual(['b', 'c']);
      expect(result.get('b')).toEqual(['c']);
      expect(result.get('c')).toBeUndefined();
    });

    it('handles empty edges', () => {
      const result = buildForwardAdjacency([]);
      expect(result.size).toBe(0);
    });

    it('handles self-loops', () => {
      const edges = [makeEdge('e1', 'a', 'a')];
      const result = buildForwardAdjacency(edges);
      expect(result.get('a')).toEqual(['a']);
    });
  });

  describe('buildBackwardAdjacency', () => {
    it('builds backward adjacency from edges', () => {
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'a', 'c'),
        makeEdge('e3', 'b', 'c'),
      ];
      const result = buildBackwardAdjacency(edges);
      expect(result.get('b')).toEqual(['a']);
      expect(result.get('c')).toEqual(['a', 'b']);
      expect(result.get('a')).toBeUndefined();
    });
  });

  describe('buildDirectedAdjacency', () => {
    it('builds both forward and backward maps', () => {
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
      ];
      const { forward, backward } = buildDirectedAdjacency(edges);
      expect(forward.get('a')).toEqual(['b']);
      expect(forward.get('b')).toEqual(['c']);
      expect(backward.get('b')).toEqual(['a']);
      expect(backward.get('c')).toEqual(['b']);
    });
  });

  describe('buildUndirectedAdjacency', () => {
    it('builds undirected adjacency with Sets', () => {
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
      ];
      const result = buildUndirectedAdjacency(edges);
      expect(result.get('a')).toEqual(new Set(['b']));
      expect(result.get('b')).toEqual(new Set(['a', 'c']));
      expect(result.get('c')).toEqual(new Set(['b']));
    });
  });

  describe('buildFilteredForwardAdjacency', () => {
    it('filters edges by type', () => {
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'a', 'c', 'import'),
        makeEdge('e3', 'b', 'c', 'call'),
      ];
      const result = buildFilteredForwardAdjacency(edges, ['call']);
      expect(result.get('a')).toEqual(['b']);
      expect(result.get('b')).toEqual(['c']);
      expect(result.has('c')).toBe(false);
    });

    it('returns empty map when no edges match', () => {
      const edges = [makeEdge('e1', 'a', 'b', 'call')];
      const result = buildFilteredForwardAdjacency(edges, ['import']);
      expect(result.size).toBe(0);
    });
  });

  describe('buildFilteredUndirectedAdjacency', () => {
    it('builds filtered undirected adjacency for specified node IDs', () => {
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
        makeEdge('e3', 'c', 'd'),
      ];
      const nodeIds = new Set(['a', 'b', 'c']);
      const result = buildFilteredUndirectedAdjacency(edges, nodeIds);
      expect(result.get('a')).toEqual(new Set(['b']));
      expect(result.get('b')).toEqual(new Set(['a', 'c']));
      expect(result.get('c')).toEqual(new Set(['b']));
      expect(result.has('d')).toBe(false);
    });

    it('includes all nodeIds even those with no edges', () => {
      const edges: GraphEdge[] = [];
      const nodeIds = new Set(['a', 'b', 'c']);
      const result = buildFilteredUndirectedAdjacency(edges, nodeIds);
      expect(result.size).toBe(3);
      expect(result.get('a')).toEqual(new Set());
      expect(result.get('b')).toEqual(new Set());
      expect(result.get('c')).toEqual(new Set());
    });

    it('skips edges where source or target is not in nodeIds', () => {
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'a', 'x'),
        makeEdge('e3', 'y', 'b'),
      ];
      const nodeIds = new Set(['a', 'b']);
      const result = buildFilteredUndirectedAdjacency(edges, nodeIds);
      expect(result.get('a')).toEqual(new Set(['b']));
      expect(result.get('b')).toEqual(new Set(['a']));
    });

    it('handles self-loops within filtered set', () => {
      const edges = [makeEdge('e1', 'a', 'a')];
      const nodeIds = new Set(['a']);
      const result = buildFilteredUndirectedAdjacency(edges, nodeIds);
      expect(result.get('a')).toEqual(new Set(['a']));
    });

    it('handles empty edges with non-empty nodeIds', () => {
      const nodeIds = new Set(['a']);
      const result = buildFilteredUndirectedAdjacency([], nodeIds);
      expect(result.get('a')).toEqual(new Set());
    });
  });

  describe('buildDirectedAdjacency additional cases', () => {
    it('handles empty edges', () => {
      const { forward, backward } = buildDirectedAdjacency([]);
      expect(forward.size).toBe(0);
      expect(backward.size).toBe(0);
    });

    it('handles multiple edges from same source', () => {
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'a', 'c'),
        makeEdge('e3', 'a', 'd'),
      ];
      const { forward, backward } = buildDirectedAdjacency(edges);
      expect(forward.get('a')).toEqual(['b', 'c', 'd']);
      expect(backward.get('b')).toEqual(['a']);
      expect(backward.get('c')).toEqual(['a']);
      expect(backward.get('d')).toEqual(['a']);
    });

    it('handles self-loops in directed adjacency', () => {
      const edges = [makeEdge('e1', 'a', 'a')];
      const { forward, backward } = buildDirectedAdjacency(edges);
      expect(forward.get('a')).toEqual(['a']);
      expect(backward.get('a')).toEqual(['a']);
    });
  });

  describe('buildUndirectedAdjacency additional cases', () => {
    it('handles empty edges', () => {
      const result = buildUndirectedAdjacency([]);
      expect(result.size).toBe(0);
    });

    it('handles self-loops', () => {
      const edges = [makeEdge('e1', 'a', 'a')];
      const result = buildUndirectedAdjacency(edges);
      expect(result.get('a')).toEqual(new Set(['a']));
    });

    it('handles multiple edges between same pair', () => {
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'a', 'b'),
      ];
      const result = buildUndirectedAdjacency(edges);
      expect(result.get('a')).toEqual(new Set(['b']));
      expect(result.get('b')).toEqual(new Set(['a']));
    });
  });

  describe('buildFilteredForwardAdjacency additional cases', () => {
    it('handles empty edges', () => {
      const result = buildFilteredForwardAdjacency([], ['call']);
      expect(result.size).toBe(0);
    });

    it('handles multiple edge types filter', () => {
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'a', 'c', 'import'),
        makeEdge('e3', 'b', 'c', 'extend'),
      ];
      const result = buildFilteredForwardAdjacency(edges, ['call', 'import']);
      expect(result.get('a')).toEqual(['b', 'c']);
      expect(result.has('b')).toBe(false);
    });
  });

  describe('buildFilteredUndirectedAdjacency additional cases', () => {
    it('handles edges where both endpoints are in nodeIds', () => {
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
      ];
      const nodeIds = new Set(['a', 'b', 'c']);
      const result = buildFilteredUndirectedAdjacency(edges, nodeIds);
      expect(result.get('a')).toEqual(new Set(['b']));
      expect(result.get('b')).toEqual(new Set(['a', 'c']));
      expect(result.get('c')).toEqual(new Set(['b']));
    });

    it('handles empty nodeIds', () => {
      const edges = [makeEdge('e1', 'a', 'b')];
      const result = buildFilteredUndirectedAdjacency(edges, new Set());
      expect(result.size).toBe(0);
    });

    it('handles nodeIds not present in any edge', () => {
      const edges = [makeEdge('e1', 'a', 'b')];
      const nodeIds = new Set(['x', 'y', 'z']);
      const result = buildFilteredUndirectedAdjacency(edges, nodeIds);
      expect(result.size).toBe(3);
      expect(result.get('x')).toEqual(new Set());
      expect(result.get('y')).toEqual(new Set());
      expect(result.get('z')).toEqual(new Set());
    });

    it('handles all edges filtered out (none match nodeIds)', () => {
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'c', 'd'),
      ];
      const nodeIds = new Set(['x', 'y']);
      const result = buildFilteredUndirectedAdjacency(edges, nodeIds);
      expect(result.size).toBe(2);
      expect(result.get('x')).toEqual(new Set());
      expect(result.get('y')).toEqual(new Set());
    });
  });

  describe('buildBackwardAdjacency additional cases', () => {
    it('handles empty edges', () => {
      const result = buildBackwardAdjacency([]);
      expect(result.size).toBe(0);
    });

    it('handles self-loops', () => {
      const edges = [makeEdge('e1', 'a', 'a')];
      const result = buildBackwardAdjacency(edges);
      expect(result.get('a')).toEqual(['a']);
    });

    it('handles multiple edges targeting same node', () => {
      const edges = [
        makeEdge('e1', 'a', 'c'),
        makeEdge('e2', 'b', 'c'),
        makeEdge('e3', 'd', 'c'),
      ];
      const result = buildBackwardAdjacency(edges);
      expect(result.get('c')).toEqual(['a', 'b', 'd']);
      expect(result.get('a')).toBeUndefined();
      expect(result.get('b')).toBeUndefined();
    });

    it('handles single edge', () => {
      const edges = [makeEdge('e1', 'a', 'b')];
      const result = buildBackwardAdjacency(edges);
      expect(result.get('b')).toEqual(['a']);
      expect(result.size).toBe(1);
    });
  });

  describe('buildDirectedAdjacency additional edge cases', () => {
    it('handles multiple edges with same source and target', () => {
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'a', 'b'),
      ];
      const { forward, backward } = buildDirectedAdjacency(edges);
      expect(forward.get('a')).toEqual(['b', 'b']);
      expect(backward.get('b')).toEqual(['a', 'a']);
    });

    it('handles chain of edges', () => {
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
        makeEdge('e3', 'c', 'd'),
        makeEdge('e4', 'd', 'e'),
      ];
      const { forward, backward } = buildDirectedAdjacency(edges);
      expect(forward.get('a')).toEqual(['b']);
      expect(forward.get('b')).toEqual(['c']);
      expect(forward.get('c')).toEqual(['d']);
      expect(forward.get('d')).toEqual(['e']);
      expect(backward.get('b')).toEqual(['a']);
      expect(backward.get('c')).toEqual(['b']);
      expect(backward.get('d')).toEqual(['c']);
      expect(backward.get('e')).toEqual(['d']);
    });
  });
});