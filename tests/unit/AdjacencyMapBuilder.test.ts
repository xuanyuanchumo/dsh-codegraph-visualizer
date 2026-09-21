import { describe, it, expect, vi } from 'vitest';

function makeMockNode(id: string) {
  return { id: () => id };
}

function makeMockEdge(id: string, sourceId: string, targetId: string) {
  return {
    id: () => id,
    source: () => makeMockNode(sourceId),
    target: () => makeMockNode(targetId),
  };
}

function makeMockCy(edges: ReturnType<typeof makeMockEdge>[] = []) {
  const edgeCollection = {
    forEach: vi.fn((cb: (el: ReturnType<typeof makeMockEdge>) => void) => edges.forEach(cb)),
    length: edges.length,
  };
  return {
    edges: vi.fn(() => edgeCollection),
  } as any;
}

describe('AdjacencyMapBuilder', () => {
  it('buildUndirectedAdjacencyMap creates bidirectional neighbors', async () => {
    const { buildUndirectedAdjacencyMap } = await import('../../src/client/renderer/AdjacencyMapBuilder.ts');
    const edges = [
      makeMockEdge('e1', 'a', 'b'),
      makeMockEdge('e2', 'b', 'c'),
    ];
    const cy = makeMockCy(edges);
    const map = buildUndirectedAdjacencyMap(cy);
    expect(map.get('a')).toEqual(new Set(['b']));
    expect(map.get('b')).toEqual(new Set(['a', 'c']));
    expect(map.get('c')).toEqual(new Set(['b']));
  });

  it('buildUndirectedAdjacencyMap handles empty graph', async () => {
    const { buildUndirectedAdjacencyMap } = await import('../../src/client/renderer/AdjacencyMapBuilder.ts');
    const cy = makeMockCy([]);
    const map = buildUndirectedAdjacencyMap(cy);
    expect(map.size).toBe(0);
  });

  it('buildUndirectedAdjacencyMap handles self-loop', async () => {
    const { buildUndirectedAdjacencyMap } = await import('../../src/client/renderer/AdjacencyMapBuilder.ts');
    const edges = [makeMockEdge('e1', 'a', 'a')];
    const cy = makeMockCy(edges);
    const map = buildUndirectedAdjacencyMap(cy);
    expect(map.get('a')).toEqual(new Set(['a']));
  });

  it('buildUndirectedAdjacencyMap handles parallel edges', async () => {
    const { buildUndirectedAdjacencyMap } = await import('../../src/client/renderer/AdjacencyMapBuilder.ts');
    const edges = [
      makeMockEdge('e1', 'a', 'b'),
      makeMockEdge('e2', 'a', 'b'),
    ];
    const cy = makeMockCy(edges);
    const map = buildUndirectedAdjacencyMap(cy);
    expect(map.get('a')).toEqual(new Set(['b']));
    expect(map.get('b')).toEqual(new Set(['a']));
  });

  it('buildDirectedAdjacencyMaps creates forward and backward maps', async () => {
    const { buildDirectedAdjacencyMaps } = await import('../../src/client/renderer/AdjacencyMapBuilder.ts');
    const edges = [
      makeMockEdge('e1', 'a', 'b'),
      makeMockEdge('e2', 'b', 'c'),
      makeMockEdge('e3', 'a', 'c'),
    ];
    const cy = makeMockCy(edges);
    const { forward, backward } = buildDirectedAdjacencyMaps(cy);
    expect(forward.get('a')).toEqual(['b', 'c']);
    expect(forward.get('b')).toEqual(['c']);
    expect(forward.get('c')).toBeUndefined();
    expect(backward.get('a')).toBeUndefined();
    expect(backward.get('b')).toEqual(['a']);
    expect(backward.get('c')).toEqual(['b', 'a']);
  });

  it('buildDirectedAdjacencyMaps handles empty graph', async () => {
    const { buildDirectedAdjacencyMaps } = await import('../../src/client/renderer/AdjacencyMapBuilder.ts');
    const cy = makeMockCy([]);
    const { forward, backward } = buildDirectedAdjacencyMaps(cy);
    expect(forward.size).toBe(0);
    expect(backward.size).toBe(0);
  });

  it('buildDirectedAdjacencyMaps handles self-loop', async () => {
    const { buildDirectedAdjacencyMaps } = await import('../../src/client/renderer/AdjacencyMapBuilder.ts');
    const edges = [makeMockEdge('e1', 'a', 'a')];
    const cy = makeMockCy(edges);
    const { forward, backward } = buildDirectedAdjacencyMaps(cy);
    expect(forward.get('a')).toEqual(['a']);
    expect(backward.get('a')).toEqual(['a']);
  });

  it('buildForwardAdjacencyMap creates forward-only map', async () => {
    const { buildForwardAdjacencyMap } = await import('../../src/client/renderer/AdjacencyMapBuilder.ts');
    const edges = [
      makeMockEdge('e1', 'a', 'b'),
      makeMockEdge('e2', 'b', 'c'),
      makeMockEdge('e3', 'a', 'c'),
    ];
    const cy = makeMockCy(edges);
    const map = buildForwardAdjacencyMap(cy);
    expect(map.get('a')).toEqual(['b', 'c']);
    expect(map.get('b')).toEqual(['c']);
    expect(map.get('c')).toBeUndefined();
  });

  it('buildForwardAdjacencyMap handles empty graph', async () => {
    const { buildForwardAdjacencyMap } = await import('../../src/client/renderer/AdjacencyMapBuilder.ts');
    const cy = makeMockCy([]);
    const map = buildForwardAdjacencyMap(cy);
    expect(map.size).toBe(0);
  });

  it('buildForwardAdjacencyMap handles self-loop', async () => {
    const { buildForwardAdjacencyMap } = await import('../../src/client/renderer/AdjacencyMapBuilder.ts');
    const edges = [makeMockEdge('e1', 'a', 'a')];
    const cy = makeMockCy(edges);
    const map = buildForwardAdjacencyMap(cy);
    expect(map.get('a')).toEqual(['a']);
  });

  it('buildForwardAdjacencyMap handles parallel edges (preserves duplicates)', async () => {
    const { buildForwardAdjacencyMap } = await import('../../src/client/renderer/AdjacencyMapBuilder.ts');
    const edges = [
      makeMockEdge('e1', 'a', 'b'),
      makeMockEdge('e2', 'a', 'b'),
    ];
    const cy = makeMockCy(edges);
    const map = buildForwardAdjacencyMap(cy);
    expect(map.get('a')).toEqual(['b', 'b']);
  });
});