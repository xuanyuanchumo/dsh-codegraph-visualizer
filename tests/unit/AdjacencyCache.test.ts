import { describe, it, expect, vi } from 'vitest';
import { AdjacencyCache } from '../../src/client/renderer/AdjacencyCache.ts';

function makeMockEdge(id: string, sourceId: string, targetId: string, type?: string) {
  return {
    id: () => id,
    source: () => ({ id: () => sourceId }),
    target: () => ({ id: () => targetId }),
    // 与 cytoscape EdgeSingular.data(key) 同形：没有 type 属性时返回 undefined
    data: (key: string) => (key === 'type' ? type : undefined),
  };
}

interface MockEdgeSpec {
  id: string;
  source: string;
  target: string;
  type?: string;
}

function makeMockCy(edges: MockEdgeSpec[]) {
  return {
    edges: () => ({
      forEach: (cb: (edge: ReturnType<typeof makeMockEdge>) => void) => {
        for (const e of edges) cb(makeMockEdge(e.id, e.source, e.target, e.type));
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

  // ---------------------------------------------------------------------------
  // cycle-107 · C-2：多重边键 + 增量 patch + version
  // ---------------------------------------------------------------------------
  describe('multi-edge keys / incremental patch / version (cycle-107 C-2)', () => {
    it('keeps same-endpoint edges of different types apart in the typed key', () => {
      const cy = makeMockCy([
        { id: 'e1', source: 'a', target: 'b', type: 'call' },
        { id: 'e2', source: 'a', target: 'b', type: 'import' },
      ]);
      const cache = new AdjacencyCache();
      const edgeMap = cache.getEdgeIdMap(cy);
      expect(edgeMap.get('a->b->call')).toBe('e1');
      expect(edgeMap.get('a->b->import')).toBe('e2');
      // 旧键保留：同端最后写入者胜出（与旧实现逐字一致）
      expect(edgeMap.get('a->b')).toBe('e2');
      // 邻接表仍按目标节点去重
      expect(cache.getForwardAdjacency(cy).get('a')).toEqual(new Set(['b']));
    });

    it('falls back to the `unknown` edge type when data is missing', () => {
      const cy = makeMockCy([{ id: 'e1', source: 'a', target: 'b' }]);
      const cache = new AdjacencyCache();
      expect(cache.getEdgeIdMap(cy).get('a->b->unknown')).toBe('e1');
      expect(cache.getEdgeIdMap(cy).get('a->b')).toBe('e1');
    });

    it('addEdge patches adjacency + dual edge keys without invalidating the cache', () => {
      const cy = makeMockCy([{ id: 'e1', source: 'a', target: 'b', type: 'call' }]);
      const cache = new AdjacencyCache();
      cache.getForwardAdjacency(cy);
      const before = cache.getVersion();

      cache.addEdge('b', 'c', 'e2', 'import');

      expect(cache.isValid()).toBe(true);
      expect(cache.getVersion()).toBe(before + 1);
      expect(cache.getForwardAdjacency(cy).get('b')).toEqual(new Set(['c']));
      expect(cache.getBackwardAdjacency(cy).get('c')).toEqual(new Set(['b']));
      expect(cache.getUndirectedAdjacency(cy).get('c')).toEqual(new Set(['b']));
      const edgeMap = cache.getEdgeIdMap(cy);
      expect(edgeMap.get('b->c')).toBe('e2');
      expect(edgeMap.get('b->c->import')).toBe('e2');
    });

    it('addEdge does not mark an unbuilt cache as valid', () => {
      const cache = new AdjacencyCache();
      cache.addEdge('a', 'b', 'e1', 'call');
      expect(cache.isValid()).toBe(false);
    });

    it('addEdge on the same pair with a different type does not overwrite the typed key', () => {
      const cy = makeMockCy([{ id: 'e1', source: 'a', target: 'b', type: 'call' }]);
      const cache = new AdjacencyCache();
      cache.getForwardAdjacency(cy);

      cache.addEdge('a', 'b', 'e2', 'import');

      const edgeMap = cache.getEdgeIdMap(cy);
      expect(edgeMap.get('a->b->call')).toBe('e1');
      expect(edgeMap.get('a->b->import')).toBe('e2');
      expect(edgeMap.get('a->b')).toBe('e2');
    });

    it('removeEdge deletes only one of several parallel edges (multi-edge semantics)', () => {
      const cy = makeMockCy([
        { id: 'e1', source: 'a', target: 'b', type: 'call' },
        { id: 'e2', source: 'a', target: 'b', type: 'import' },
      ]);
      const cache = new AdjacencyCache();
      const forward = cache.getForwardAdjacency(cy);

      expect(cache.removeEdge('a', 'b', 'e1', 'call')).toBe(true);

      // 另一条同端边还在 → 邻接项必须保留
      expect(forward.get('a')).toEqual(new Set(['b']));
      let edgeMap = cache.getEdgeIdMap(cy);
      expect(edgeMap.has('a->b->call')).toBe(false);
      expect(edgeMap.get('a->b->import')).toBe('e2');
      expect(edgeMap.get('a->b')).toBe('e2');

      expect(cache.removeEdge('a', 'b', 'e2', 'import')).toBe(true);
      expect(forward.get('a')).toBeUndefined();
      edgeMap = cache.getEdgeIdMap(cy);
      expect(edgeMap.has('a->b')).toBe(false);
      expect(edgeMap.has('a->b->import')).toBe(false);
    });

    it('removeEdge without an edge id removes the last written edge of the pair', () => {
      const cy = makeMockCy([
        { id: 'e1', source: 'a', target: 'b', type: 'call' },
        { id: 'e2', source: 'a', target: 'b', type: 'import' },
      ]);
      const cache = new AdjacencyCache();
      cache.getForwardAdjacency(cy);
      expect(cache.getEdgeIdMap(cy).get('a->b')).toBe('e2');

      expect(cache.removeEdge('a', 'b')).toBe(true);

      const edgeMap = cache.getEdgeIdMap(cy);
      expect(edgeMap.get('a->b')).toBe('e1');
      expect(edgeMap.get('a->b->call')).toBe('e1');
      expect(edgeMap.has('a->b->import')).toBe(false);
    });

    it('removeEdge returns false (and keeps the version) when the edge is unknown', () => {
      const cy = makeMockCy([{ id: 'e1', source: 'a', target: 'b', type: 'call' }]);
      const cache = new AdjacencyCache();
      cache.getForwardAdjacency(cy);
      const before = cache.getVersion();

      expect(cache.removeEdge('x', 'y', 'nope')).toBe(false);
      expect(cache.removeEdge('a', 'b', 'nope')).toBe(false);
      expect(cache.getVersion()).toBe(before);
      expect(cache.getForwardAdjacency(cy).get('a')).toEqual(new Set(['b']));
    });

    it('version increases monotonically across rebuild / patch / invalidate / destroy', () => {
      const cy = makeMockCy([{ id: 'e1', source: 'a', target: 'b', type: 'call' }]);
      const cache = new AdjacencyCache();
      expect(cache.version).toBe(0);
      expect(cache.getVersion()).toBe(0);

      cache.getForwardAdjacency(cy);
      const afterRebuild = cache.getVersion();
      expect(afterRebuild).toBeGreaterThan(0);

      cache.addEdge('b', 'c', 'e2', 'import');
      const afterAdd = cache.getVersion();
      expect(afterAdd).toBeGreaterThan(afterRebuild);

      cache.removeEdge('b', 'c', 'e2', 'import');
      const afterRemove = cache.getVersion();
      expect(afterRemove).toBeGreaterThan(afterAdd);

      // invalidate 只标记「下次访问重建」，不改动内容，因此不递增
      cache.invalidate();
      expect(cache.getVersion()).toBe(afterRemove);

      cache.getForwardAdjacency(cy);
      const afterSecondRebuild = cache.getVersion();
      expect(afterSecondRebuild).toBeGreaterThan(afterRemove);

      cache.destroy();
      expect(cache.getVersion()).toBeGreaterThan(afterSecondRebuild);
    });

    it('destroy clears every internal structure', () => {
      const cy = makeMockCy([{ id: 'e1', source: 'a', target: 'b', type: 'call' }]);
      const cache = new AdjacencyCache();
      cache.getForwardAdjacency(cy);
      cache.addEdge('b', 'c', 'e2', 'import');

      cache.destroy();

      const internals = cache as unknown as {
        forward: Map<string, Set<string>>;
        backward: Map<string, Set<string>>;
        undirected: Map<string, Set<string>>;
        edgeIdMap: Map<string, string>;
      };
      expect(internals.forward.size).toBe(0);
      expect(internals.backward.size).toBe(0);
      expect(internals.undirected.size).toBe(0);
      expect(internals.edgeIdMap.size).toBe(0);
      expect(cache.isValid()).toBe(false);
    });

    it('patch result matches a full rebuild edge-by-edge (20 random op sequences)', () => {
      const edgeTypes = ['call', 'import', 'dependency'];

      for (let group = 0; group < 20; group++) {
        // 确定性 PRNG：随机对照必须可复现
        let state = (0xc0ffee ^ (group * 2654435761)) >>> 0;
        const random = (): number => {
          state = (state * 1664525 + 1013904223) >>> 0;
          return state / 4294967296;
        };

        const model: MockEdgeSpec[] = [];
        let nextEdgeId = 0;
        const makeId = (): string => `e${nextEdgeId++}`;

        for (let i = 0; i < 5; i++) {
          const edge: MockEdgeSpec = {
            id: makeId(),
            source: `n${Math.floor(random() * 5)}`,
            target: `n${Math.floor(random() * 5)}`,
            type: edgeTypes[Math.floor(random() * edgeTypes.length)]!,
          };
          model.push(edge);
        }

        const cache = new AdjacencyCache();
        cache.getForwardAdjacency(makeMockCy(model));

        for (let step = 0; step < 30; step++) {
          if (model.length === 0 || random() < 0.6) {
            const edge: MockEdgeSpec = {
              id: makeId(),
              source: `n${Math.floor(random() * 5)}`,
              target: `n${Math.floor(random() * 5)}`,
              type: edgeTypes[Math.floor(random() * edgeTypes.length)]!,
            };
            model.push(edge);
            cache.addEdge(edge.source, edge.target, edge.id, edge.type);
          } else {
            const index = Math.floor(random() * model.length);
            const removed = model[index]!;
            model.splice(index, 1);
            expect(
              cache.removeEdge(removed.source, removed.target, removed.id, removed.type),
              `group ${group} step ${step}`,
            ).toBe(true);
          }
        }

        const cyFinal = makeMockCy(model);
        const rebuilt = new AdjacencyCache();
        const expected = {
          forward: rebuilt.getForwardAdjacency(cyFinal),
          backward: rebuilt.getBackwardAdjacency(cyFinal),
          undirected: rebuilt.getUndirectedAdjacency(cyFinal),
          edgeIds: rebuilt.getEdgeIdMap(cyFinal),
        };

        const patched = {
          forward: cache.getForwardAdjacency(cyFinal),
          backward: cache.getBackwardAdjacency(cyFinal),
          undirected: cache.getUndirectedAdjacency(cyFinal),
          edgeIds: cache.getEdgeIdMap(cyFinal),
        };

        expect(patched, `group ${group}`).toEqual(expected);
      }
    });
  });
});