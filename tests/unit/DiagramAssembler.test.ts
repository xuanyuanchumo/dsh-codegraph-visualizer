import { describe, it, expect } from 'vitest';
import { computeDepths, buildAdjacencyMaps } from '../../src/client/diagram/DiagramAssembler.ts';
import type { GraphEdge } from '../../src/types/index.ts';
import { makeEdge } from '../helpers.ts';

describe('DiagramAssembler', () => {
  describe('computeDepths', () => {
    it('computes depths forward (target direction)', () => {
      const edges = new Map<string, GraphEdge[]>([
        ['a', [makeEdge('e1', 'a', 'b', 'call')]],
        ['b', [makeEdge('e2', 'b', 'c', 'call')]],
      ]);
      const depths = computeDepths(['a'], edges, 'target');
      expect(depths.get('a')).toBe(0);
      expect(depths.get('b')).toBe(1);
      expect(depths.get('c')).toBe(2);
    });

    it('computes depths backward (source direction)', () => {
      const edges = new Map<string, GraphEdge[]>([
        ['c', [makeEdge('e1', 'a', 'c', 'call'), makeEdge('e2', 'b', 'c', 'call')]],
      ]);
      const depths = computeDepths(['c'], edges, 'source');
      expect(depths.get('c')).toBe(0);
      expect(depths.get('a')).toBe(1);
      expect(depths.get('b')).toBe(1);
    });

    it('handles empty roots', () => {
      const edges = new Map<string, GraphEdge[]>();
      const depths = computeDepths([], edges, 'source');
      expect(depths.size).toBe(0);
    });

    it('handles nodes with no edges', () => {
      const edges = new Map<string, GraphEdge[]>();
      const depths = computeDepths(['a'], edges, 'source');
      expect(depths.get('a')).toBe(0);
      expect(depths.size).toBe(1);
    });

    it('handles multiple roots', () => {
      const edges = new Map<string, GraphEdge[]>([
        ['a', [makeEdge('e1', 'a', 'c', 'call')]],
        ['b', [makeEdge('e2', 'b', 'c', 'call')]],
      ]);
      const depths = computeDepths(['a', 'b'], edges, 'target');
      expect(depths.get('a')).toBe(0);
      expect(depths.get('b')).toBe(0);
      expect(depths.get('c')).toBe(1);
    });

    it('handles cycles without infinite loop', () => {
      const edges = new Map<string, GraphEdge[]>([
        ['a', [makeEdge('e1', 'a', 'b', 'call')]],
        ['b', [makeEdge('e2', 'b', 'a', 'call')]],
      ]);
      const depths = computeDepths(['a'], edges, 'target');
      expect(depths.get('a')).toBe(0);
      expect(depths.get('b')).toBe(1);
    });

    it('keeps shortest depth when node reachable via multiple paths', () => {
      const edges = new Map<string, GraphEdge[]>([
        ['a', [makeEdge('e1', 'a', 'c', 'call'), makeEdge('e3', 'a', 'b', 'call')]],
        ['b', [makeEdge('e2', 'b', 'c', 'call')]],
      ]);
      const depths = computeDepths(['a'], edges, 'target');
      expect(depths.get('a')).toBe(0);
      expect(depths.get('b')).toBe(1);
      expect(depths.get('c')).toBe(1);
    });

    it('handles missing edge entries gracefully', () => {
      const edges = new Map<string, GraphEdge[]>();
      const depths = computeDepths(['a'], edges, 'source');
      expect(depths.get('a')).toBe(0);
    });
  });

  describe('buildAdjacencyMaps', () => {
    it('builds out and in edge maps', () => {
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'a', 'c', 'call'),
        makeEdge('e3', 'b', 'c', 'call'),
      ];
      const { outEdges, inEdges } = buildAdjacencyMaps(edges);
      expect(outEdges.get('a')).toHaveLength(2);
      expect(outEdges.get('b')).toHaveLength(1);
      expect(inEdges.get('b')).toHaveLength(1);
      expect(inEdges.get('c')).toHaveLength(2);
    });

    it('handles empty edges', () => {
      const { outEdges, inEdges } = buildAdjacencyMaps([]);
      expect(outEdges.size).toBe(0);
      expect(inEdges.size).toBe(0);
    });

    it('handles self-loops', () => {
      const edges = [makeEdge('e1', 'a', 'a', 'call')];
      const { outEdges, inEdges } = buildAdjacencyMaps(edges);
      expect(outEdges.get('a')).toHaveLength(1);
      expect(inEdges.get('a')).toHaveLength(1);
    });

    it('handles multiple edges between same pair', () => {
      const edges = [
        makeEdge('e1', 'a', 'b', 'call'),
        makeEdge('e2', 'a', 'b', 'call'),
      ];
      const { outEdges, inEdges } = buildAdjacencyMaps(edges);
      expect(outEdges.get('a')).toHaveLength(2);
      expect(inEdges.get('b')).toHaveLength(2);
    });
  });
});