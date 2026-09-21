import { describe, it, expect } from 'vitest';
import {
  buildForwardAdjacency,
  buildBackwardAdjacency,
  buildDirectedAdjacency,
  buildUndirectedAdjacency,
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
});