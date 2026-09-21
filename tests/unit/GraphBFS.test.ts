import { describe, it, expect } from 'vitest';
import { bfsShortestPath, bfsFrontierExpansion } from '../../src/shared/analysis/GraphBFS.ts';
import type { AdjacencyMap } from '../../src/shared/analysis/AdjacencyList.ts';

describe('GraphBFS', () => {
  describe('bfsShortestPath', () => {
    it('finds shortest path in a simple graph', () => {
      const adjacency: AdjacencyMap = new Map([
        ['a', ['b', 'c']],
        ['b', ['d']],
        ['c', ['d']],
        ['d', []],
      ]);
      const result = bfsShortestPath(adjacency, 'a', 'd', 100);
      expect(result).not.toBeNull();
      expect(result!.path).toContain('a');
      expect(result!.path).toContain('d');
      expect(result!.length).toBeGreaterThanOrEqual(1);
    });

    it('returns null when no path exists', () => {
      const adjacency: AdjacencyMap = new Map([
        ['a', ['b']],
        ['b', []],
        ['c', ['d']],
        ['d', []],
      ]);
      const result = bfsShortestPath(adjacency, 'a', 'd', 100);
      expect(result).toBeNull();
    });

    it('returns path with length 0 when source equals target', () => {
      const adjacency: AdjacencyMap = new Map([['a', ['b']]]);
      const result = bfsShortestPath(adjacency, 'a', 'a', 100);
      expect(result).not.toBeNull();
      expect(result!.path).toEqual(['a']);
      expect(result!.length).toBe(0);
    });

    it('returns truncated result when maxNodes exceeded', () => {
      const adjacency: AdjacencyMap = new Map([
        ['a', ['b']],
        ['b', ['c']],
        ['c', ['d']],
        ['d', ['e']],
        ['e', []],
      ]);
      const result = bfsShortestPath(adjacency, 'a', 'e', 3);
      expect(result).not.toBeNull();
      expect(result!.truncated).toBe(true);
      expect(result!.path).toEqual([]);
    });
  });

  describe('bfsFrontierExpansion', () => {
    it('expands frontier to find impacted nodes', () => {
      const reverseAdj: AdjacencyMap = new Map([
        ['b', ['a']],
        ['c', ['b']],
        ['d', ['c']],
      ]);
      const result = bfsFrontierExpansion(reverseAdj, 'd', 3, 100);
      expect(result.impacted).toContain('c');
      expect(result.impacted).toContain('b');
      expect(result.impacted).toContain('a');
      expect(result.count).toBe(3);
      expect(result.truncated).toBe(false);
    });

    it('respects maxResults limit', () => {
      const reverseAdj: AdjacencyMap = new Map([
        ['b', ['a1', 'a2', 'a3']],
        ['c', ['b']],
      ]);
      const result = bfsFrontierExpansion(reverseAdj, 'c', 2, 2);
      expect(result.truncated).toBe(true);
      expect(result.count).toBeLessThanOrEqual(2);
    });

    it('returns empty when start node has no predecessors', () => {
      const reverseAdj: AdjacencyMap = new Map();
      const result = bfsFrontierExpansion(reverseAdj, 'a', 3, 100);
      expect(result.impacted).toEqual([]);
      expect(result.count).toBe(0);
    });
  });
});