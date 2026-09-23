import { describe, it, expect, vi } from 'vitest';
import { AdjacencyCache } from '../../src/client/renderer/AdjacencyCache.ts';

function makeMockEdge(id: string, sourceId: string, targetId: string) {
  return {
    id: () => id,
    source: () => ({ id: () => sourceId }),
    target: () => ({ id: () => targetId }),
  };
}

function makeMockCy(edges: Array<{ id: string; source: string; target: string }>) {
  return {
    edges: () => ({
      forEach: (cb: (edge: ReturnType<typeof makeMockEdge>) => void) => {
        for (const e of edges) cb(makeMockEdge(e.id, e.source, e.target));
      },
    }),
  } as any;
}

describe('AdjacencyCache', () => {
  it('starts invalid', () => {
    const cache = new AdjacencyCache();
    expect(cache.isValid()).toBe(false);
  });

  it('rebuilds on first access and becomes valid', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
    ]);
    const cache = new AdjacencyCache();
    const result = cache.getForwardAdjacency(cy);
    expect(cache.isValid()).toBe(true);
    expect(result.get('a')).toEqual(new Set(['b']));
  });

  it('getForwardAdjacency returns forward mapping', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'c' },
      { id: 'e3', source: 'b', target: 'c' },
    ]);
    const cache = new AdjacencyCache();
    const fwd = cache.getForwardAdjacency(cy);
    expect(fwd.get('a')).toEqual(new Set(['b', 'c']));
    expect(fwd.get('b')).toEqual(new Set(['c']));
    expect(fwd.get('c')).toBeUndefined();
  });

  it('getBackwardAdjacency returns backward mapping', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'c' },
      { id: 'e3', source: 'b', target: 'c' },
    ]);
    const cache = new AdjacencyCache();
    const bwd = cache.getBackwardAdjacency(cy);
    expect(bwd.get('b')).toEqual(new Set(['a']));
    expect(bwd.get('c')).toEqual(new Set(['a', 'b']));
    expect(bwd.get('a')).toBeUndefined();
  });

  it('getDirectedAdjacency returns both forward and backward', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
    ]);
    const cache = new AdjacencyCache();
    const { forward, backward } = cache.getDirectedAdjacency(cy);
    expect(forward.get('a')).toEqual(new Set(['b']));
    expect(backward.get('b')).toEqual(new Set(['a']));
  });

  it('getUndirectedAdjacency returns symmetric mapping', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ]);
    const cache = new AdjacencyCache();
    const und = cache.getUndirectedAdjacency(cy);
    expect(und.get('a')).toEqual(new Set(['b']));
    expect(und.get('b')).toEqual(new Set(['a', 'c']));
    expect(und.get('c')).toEqual(new Set(['b']));
  });

  it('getEdgeIdMap returns edge id lookup', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ]);
    const cache = new AdjacencyCache();
    const edgeMap = cache.getEdgeIdMap(cy);
    expect(edgeMap.get('a->b')).toBe('e1');
    expect(edgeMap.get('b->c')).toBe('e2');
    expect(edgeMap.get('a->c')).toBeUndefined();
  });

  it('does not rebuild when cache is valid', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
    ]);
    const cache = new AdjacencyCache();
    cache.getForwardAdjacency(cy);
    expect(cache.isValid()).toBe(true);
    const result = cache.getForwardAdjacency(cy);
    expect(result.get('a')).toEqual(new Set(['b']));
  });

  it('invalidate marks cache as invalid', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
    ]);
    const cache = new AdjacencyCache();
    cache.getForwardAdjacency(cy);
    expect(cache.isValid()).toBe(true);
    cache.invalidate();
    expect(cache.isValid()).toBe(false);
  });

  it('rebuilds after invalidation on next access', () => {
    const cy1 = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
    ]);
    const cache = new AdjacencyCache();
    cache.getForwardAdjacency(cy1);
    cache.invalidate();
    const cy2 = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'c' },
    ]);
    const fwd = cache.getForwardAdjacency(cy2);
    expect(fwd.get('a')).toEqual(new Set(['b', 'c']));
  });

  it('handles empty graph', () => {
    const cy = makeMockCy([]);
    const cache = new AdjacencyCache();
    const fwd = cache.getForwardAdjacency(cy);
    expect(fwd.size).toBe(0);
    expect(cache.isValid()).toBe(true);
  });

  it('handles self-loop edges', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'a' },
    ]);
    const cache = new AdjacencyCache();
    const fwd = cache.getForwardAdjacency(cy);
    expect(fwd.get('a')).toEqual(new Set(['a']));
    const bwd = cache.getBackwardAdjacency(cy);
    expect(bwd.get('a')).toEqual(new Set(['a']));
    const und = cache.getUndirectedAdjacency(cy);
    expect(und.get('a')).toEqual(new Set(['a']));
  });

  it('handles multiple edges between same pair', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'b' },
    ]);
    const cache = new AdjacencyCache();
    const fwd = cache.getForwardAdjacency(cy);
    expect(fwd.get('a')).toEqual(new Set(['b']));
    const edgeMap = cache.getEdgeIdMap(cy);
    expect(edgeMap.get('a->b')).toBe('e2');
  });

  it('destroy clears all data and marks invalid', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
    ]);
    const cache = new AdjacencyCache();
    cache.getForwardAdjacency(cy);
    expect(cache.isValid()).toBe(true);
    cache.destroy();
    expect(cache.isValid()).toBe(false);
    const fwd = cache.getForwardAdjacency(cy);
    expect(fwd.size).toBe(1);
    expect(fwd.get('a')).toEqual(new Set(['b']));
  });

  it('getDirectedAdjacency rebuilds when invalid', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
    ]);
    const cache = new AdjacencyCache();
    cache.invalidate();
    const { forward, backward } = cache.getDirectedAdjacency(cy);
    expect(forward.get('a')).toEqual(new Set(['b']));
    expect(backward.get('b')).toEqual(new Set(['a']));
    expect(cache.isValid()).toBe(true);
  });

  it('getUndirectedAdjacency rebuilds when invalid', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
    ]);
    const cache = new AdjacencyCache();
    cache.invalidate();
    const und = cache.getUndirectedAdjacency(cy);
    expect(und.get('a')).toEqual(new Set(['b']));
    expect(und.get('b')).toEqual(new Set(['a']));
    expect(cache.isValid()).toBe(true);
  });

  it('getEdgeIdMap rebuilds when invalid', () => {
    const cy = makeMockCy([
      { id: 'e1', source: 'a', target: 'b' },
    ]);
    const cache = new AdjacencyCache();
    cache.invalidate();
    const edgeMap = cache.getEdgeIdMap(cy);
    expect(edgeMap.get('a->b')).toBe('e1');
    expect(cache.isValid()).toBe(true);
  });
});