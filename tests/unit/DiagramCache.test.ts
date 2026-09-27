import { describe, it, expect, vi } from 'vitest';
import { DiagramCache, ClusterCache, computeDataHash } from '../../src/client/cache/DiagramCache.ts';
import type { LayeredDiagram } from '../../src/client/diagram/DiagramAssembler.ts';
import type { ClusterResult } from '../../src/client/store/cluster/index.ts';

function makeLayeredDiagram(): LayeredDiagram {
  return {
    viewMode: 'inheritance',
    layers: [
      { level: 0, name: 'L0', nodes: [], edges: [], nodeIds: new Set(), edgeIds: new Set() },
      { level: 1, name: 'L1', nodes: [], edges: [], nodeIds: new Set(), edgeIds: new Set() },
    ],
    currentLayer: 0,
    expandedNodes: new Set(),
    allNodes: [],
    allEdges: [],
    metadata: { rootIds: [], maxDepth: 1, nodeCount: 0, edgeCount: 0 },
  };
}

function makeClusterResult(): ClusterResult {
  return { nodes: [], edges: [] };
}

describe('computeDataHash', () => {
  it('produces different hashes for different node sets', () => {
    const nodesA = [{ id: 'a', type: 'class' }];
    const nodesB = [{ id: 'b', type: 'class' }];
    expect(computeDataHash(nodesA, [])).not.toBe(computeDataHash(nodesB, []));
  });

  it('produces different hashes for different edge sets', () => {
    const edgesA = [{ id: 'e1', source: 'a', target: 'b', type: 'call' }];
    const edgesB = [{ id: 'e2', source: 'a', target: 'b', type: 'call' }];
    expect(computeDataHash([], edgesA)).not.toBe(computeDataHash([], edgesB));
  });

  it('produces same hash for identical data', () => {
    const nodes = [{ id: 'a', type: 'class' }];
    const edges = [{ id: 'e1', source: 'a', target: 'b', type: 'call' }];
    expect(computeDataHash(nodes, edges)).toBe(computeDataHash(nodes, edges));
  });

  it('does not collide on same-length data with different content', () => {
    const nodesA = [{ id: 'aa', type: 'cl' }];
    const nodesB = [{ id: 'bb', type: 'cl' }];
    expect(computeDataHash(nodesA, [])).not.toBe(computeDataHash(nodesB, []));
  });

  it('produces different hashes when node order changes', () => {
    const nodesA = [{ id: 'a', type: 'class' }, { id: 'b', type: 'function' }];
    const nodesB = [{ id: 'b', type: 'function' }, { id: 'a', type: 'class' }];
    expect(computeDataHash(nodesA, [])).not.toBe(computeDataHash(nodesB, []));
  });
});

describe('DiagramCache', () => {
  it('returns null for missing key', () => {
    const cache = new DiagramCache(5);
    expect(cache.get('inheritance', 'hash123')).toBeNull();
  });

  it('stores and retrieves diagrams', () => {
    const cache = new DiagramCache(5);
    const diagram = makeLayeredDiagram();
    cache.set('inheritance', 'hash123', diagram);
    expect(cache.get('inheritance', 'hash123')).toBe(diagram);
  });

  it('evicts oldest entries when capacity exceeded', () => {
    const cache = new DiagramCache(2);
    const d1 = makeLayeredDiagram();
    const d2 = makeLayeredDiagram();
    const d3 = makeLayeredDiagram();

    cache.set('inheritance', 'h1', d1);
    cache.set('callgraph', 'h2', d2);
    cache.set('package', 'h3', d3);

    expect(cache.get('inheritance', 'h1')).toBeNull();
    expect(cache.get('callgraph', 'h2')).toBe(d2);
    expect(cache.get('package', 'h3')).toBe(d3);
  });

  it('implements LRU - accessed entries are kept longer', () => {
    const cache = new DiagramCache(2);
    const d1 = makeLayeredDiagram();
    const d2 = makeLayeredDiagram();
    const d3 = makeLayeredDiagram();

    cache.set('inheritance', 'h1', d1);
    cache.set('callgraph', 'h2', d2);

    cache.get('inheritance', 'h1');

    cache.set('package', 'h3', d3);

    expect(cache.get('inheritance', 'h1')).toBe(d1);
    expect(cache.get('callgraph', 'h2')).toBeNull();
  });

  it('invalidates by viewMode', () => {
    const cache = new DiagramCache(5);
    const d1 = makeLayeredDiagram();
    cache.set('inheritance', 'h1', d1);
    cache.set('callgraph', 'h2', d1);

    cache.invalidate('inheritance');

    expect(cache.get('inheritance', 'h1')).toBeNull();
    expect(cache.get('callgraph', 'h2')).toBe(d1);
  });

  it('invalidates all when no viewMode specified', () => {
    const cache = new DiagramCache(5);
    cache.set('inheritance', 'h1', makeLayeredDiagram());
    cache.set('callgraph', 'h2', makeLayeredDiagram());

    cache.invalidate();

    expect(cache.size()).toBe(0);
  });

  it('updates existing key without evicting others', () => {
    const cache = new DiagramCache(2);
    const d1 = makeLayeredDiagram();
    const d2 = makeLayeredDiagram();
    const d2New = makeLayeredDiagram();

    cache.set('inheritance', 'h1', d1);
    cache.set('callgraph', 'h2', d2);
    cache.set('callgraph', 'h2', d2New);

    expect(cache.size()).toBe(2);
    expect(cache.get('callgraph', 'h2')).toBe(d2New);
    expect(cache.get('inheritance', 'h1')).toBe(d1);
  });
});

describe('ClusterCache', () => {
  it('returns null for missing key', () => {
    const cache = new ClusterCache(5);
    expect(cache.get('hash123', 'directory', '')).toBeNull();
  });

  it('stores and retrieves cluster results', () => {
    const cache = new ClusterCache(5);
    const result = makeClusterResult();
    cache.set('hash123', 'directory', '', result);
    expect(cache.get('hash123', 'directory', '')).toBe(result);
  });

  it('evicts oldest entries when capacity exceeded', () => {
    const cache = new ClusterCache(2);
    const r1 = makeClusterResult();
    const r2 = makeClusterResult();
    const r3 = makeClusterResult();

    cache.set('h1', 'directory', '', r1);
    cache.set('h2', 'directory', '', r2);
    cache.set('h3', 'directory', '', r3);

    expect(cache.get('h1', 'directory', '')).toBeNull();
    expect(cache.get('h2', 'directory', '')).toBe(r2);
    expect(cache.get('h3', 'directory', '')).toBe(r3);
  });

  it('implements LRU - accessed entries are kept longer', () => {
    const cache = new ClusterCache(2);
    const r1 = makeClusterResult();
    const r2 = makeClusterResult();
    const r3 = makeClusterResult();

    cache.set('h1', 'directory', '', r1);
    cache.set('h2', 'directory', '', r2);

    cache.get('h1', 'directory', '');

    cache.set('h3', 'directory', '', r3);

    expect(cache.get('h1', 'directory', '')).toBe(r1);
    expect(cache.get('h2', 'directory', '')).toBeNull();
  });

  it('distinguishes by cluster level', () => {
    const cache = new ClusterCache(5);
    const r1 = makeClusterResult();
    const r2 = makeClusterResult();

    cache.set('h1', 'directory', '', r1);
    cache.set('h1', 'function', '', r2);

    expect(cache.get('h1', 'directory', '')).toBe(r1);
    expect(cache.get('h1', 'function', '')).toBe(r2);
  });

  it('distinguishes by expanded key', () => {
    const cache = new ClusterCache(5);
    const r1 = makeClusterResult();
    const r2 = makeClusterResult();

    cache.set('h1', 'directory', 'nodeA', r1);
    cache.set('h1', 'directory', 'nodeB', r2);

    expect(cache.get('h1', 'directory', 'nodeA')).toBe(r1);
    expect(cache.get('h1', 'directory', 'nodeB')).toBe(r2);
  });

  it('invalidates all', () => {
    const cache = new ClusterCache(5);
    cache.set('h1', 'directory', '', makeClusterResult());
    cache.set('h2', 'function', 'nodeA', makeClusterResult());

    cache.invalidate();

    expect(cache.size()).toBe(0);
  });

  it('updates existing key without evicting others', () => {
    const cache = new ClusterCache(2);
    const r1 = makeClusterResult();
    const r2 = makeClusterResult();
    const r2New = makeClusterResult();

    cache.set('h1', 'directory', '', r1);
    cache.set('h2', 'directory', '', r2);
    cache.set('h2', 'directory', '', r2New);

    expect(cache.size()).toBe(2);
    expect(cache.get('h2', 'directory', '')).toBe(r2New);
    expect(cache.get('h1', 'directory', '')).toBe(r1);
  });
});
describe('DiagramCache setPersistentBackend', () => {
  it('should set persistent backend and route set operations through it', async () => {
    const cache = new DiagramCache(5);
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(null),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      getCluster: vi.fn().mockResolvedValue(null),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    const diagram = makeLayeredDiagram();
    cache.set('inheritance', 'hash1', diagram);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockIdb.setDiagram).toHaveBeenCalledTimes(1);
  });

  it('should call idbCache.setDiagram on cache set when persistent backend is set', async () => {
    const cache = new DiagramCache(5);
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(null),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    const diagram = makeLayeredDiagram();
    cache.set('inheritance', 'hash1', diagram);
    // Allow async operations to complete
    await new Promise((r) => setTimeout(r, 10));
    expect(mockIdb.setDiagram).toHaveBeenCalledTimes(1);
  });

  it('should call idbCache.invalidateDiagram on cache invalidate when persistent backend is set', async () => {
    const cache = new DiagramCache(5);
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(null),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.invalidate('inheritance');
    await new Promise((r) => setTimeout(r, 10));
    expect(mockIdb.invalidateDiagram).toHaveBeenCalledWith('inheritance');
  });

  it('should call idbCache.invalidateDiagram with undefined when invalidating all', async () => {
    const cache = new DiagramCache(5);
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(null),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.invalidate();
    await new Promise((r) => setTimeout(r, 10));
    expect(mockIdb.invalidateDiagram).toHaveBeenCalledWith(undefined);
  });
});

describe('ClusterCache setPersistentBackend', () => {
  it('should set persistent backend and route cluster operations through it', async () => {
    const cache = new ClusterCache(5);
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(null),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.set('hash1', 'level1', 'expanded1', { nodes: [], edges: [] } as any);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockIdb.setCluster).toHaveBeenCalledTimes(1);
  });

  it('should call idbCache.setCluster on cache set when persistent backend is set', async () => {
    const cache = new ClusterCache(5);
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(null),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    const result = makeClusterResult();
    cache.set('hash1', 'directory', '', result);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockIdb.setCluster).toHaveBeenCalledTimes(1);
  });

  it('should call idbCache.invalidateCluster on cache invalidate when persistent backend is set', async () => {
    const cache = new ClusterCache(5);
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(null),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.invalidate();
    await new Promise((r) => setTimeout(r, 10));
    expect(mockIdb.invalidateCluster).toHaveBeenCalledTimes(1);
  });
});
describe('DiagramCache IndexedDB async load', () => {
  it('loads diagram from IndexedDB via getAsync on memory miss', async () => {
    const cache = new DiagramCache(5);
    const diagram = makeLayeredDiagram();
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(diagram),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);

    expect(cache.get('inheritance', 'hash1')).toBeNull();
    const result = await cache.getAsync('inheritance', 'hash1');
    expect(result).toBe(diagram);
    expect(mockIdb.getDiagram).toHaveBeenCalledWith('inheritance:hash1');
    expect(cache.get('inheritance', 'hash1')).toBe(diagram);
  });

  it('evicts oldest entry when loading from IndexedDB into full cache via getAsync', async () => {
    const cache = new DiagramCache(1);
    const d1 = makeLayeredDiagram();
    const d2 = makeLayeredDiagram();
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(d2),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);

    cache.set('inheritance', 'h1', d1);
    expect(cache.size()).toBe(1);

    const result = await cache.getAsync('callgraph', 'h2');
    expect(result).toBe(d2);
    expect(cache.get('inheritance', 'h1')).toBeNull();
    expect(cache.get('callgraph', 'h2')).toBe(d2);
  });

  it('does not overwrite cache when IndexedDB load returns data but key already in cache', async () => {
    const cache = new DiagramCache(5);
    const d1 = makeLayeredDiagram();
    const d2 = makeLayeredDiagram();
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(d2),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);

    cache.set('inheritance', 'h1', d1);
    const result = await cache.getAsync('inheritance', 'h1');
    expect(result).toBe(d1);
  });

  it('handles IndexedDB get rejection gracefully via getAsync', async () => {
    const cache = new DiagramCache(5);
    const mockIdb = {
      getDiagram: vi.fn().mockRejectedValue(new Error('IndexedDB error')),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);

    expect(cache.get('inheritance', 'h1')).toBeNull();
    const result = await cache.getAsync('inheritance', 'h1');
    expect(result).toBeNull();
    expect(cache.size()).toBe(0);
  });
});

describe('ClusterCache IndexedDB async load', () => {
  it('loads cluster result from IndexedDB via getAsync on memory miss', async () => {
    const cache = new ClusterCache(5);
    const result = makeClusterResult();
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(result),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);

    expect(cache.get('hash1', 'directory', '')).toBeNull();
    const loaded = await cache.getAsync('hash1', 'directory', '');
    expect(loaded).toBe(result);
    expect(mockIdb.getCluster).toHaveBeenCalledWith('hash1:directory:');
    expect(cache.get('hash1', 'directory', '')).toBe(result);
  });

  it('evicts oldest entry when loading from IndexedDB into full cache via getAsync', async () => {
    const cache = new ClusterCache(1);
    const r1 = makeClusterResult();
    const r2 = makeClusterResult();
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(r2),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);

    cache.set('h1', 'directory', '', r1);
    expect(cache.size()).toBe(1);

    const loaded = await cache.getAsync('h2', 'directory', '');
    expect(loaded).toBe(r2);
    expect(cache.get('h1', 'directory', '')).toBeNull();
    expect(cache.get('h2', 'directory', '')).toBe(r2);
  });

  it('does not overwrite cache when IndexedDB load returns data but key already in cache', async () => {
    const cache = new ClusterCache(5);
    const r1 = makeClusterResult();
    const r2 = makeClusterResult();
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(r2),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);

    cache.set('h1', 'directory', '', r1);
    const loaded = await cache.getAsync('h1', 'directory', '');
    expect(loaded).toBe(r1);
  });

  it('handles IndexedDB get rejection gracefully via getAsync', async () => {
    const cache = new ClusterCache(5);
    const mockIdb = {
      getCluster: vi.fn().mockRejectedValue(new Error('IndexedDB error')),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);

    expect(cache.get('hash1', 'directory', '')).toBeNull();
    const loaded = await cache.getAsync('hash1', 'directory', '');
    expect(loaded).toBeNull();
    expect(cache.size()).toBe(0);
  });
});

describe('computeDataHash additional coverage', () => {
  it('produces different hashes for nodes with different parentId', () => {
    const nodesA = [{ id: 'a', type: 'class', parentId: 'parent1' }];
    const nodesB = [{ id: 'a', type: 'class', parentId: 'parent2' }];
    expect(computeDataHash(nodesA, [])).not.toBe(computeDataHash(nodesB, []));
  });

  it('produces different hashes for node with parentId vs without', () => {
    const nodesA = [{ id: 'a', type: 'class', parentId: 'parent1' }];
    const nodesB = [{ id: 'a', type: 'class' }];
    expect(computeDataHash(nodesA, [])).not.toBe(computeDataHash(nodesB, []));
  });

  it('produces different hashes for edges with different source', () => {
    const edgesA = [{ id: 'e1', source: 'a', target: 'b', type: 'call' }];
    const edgesB = [{ id: 'e1', source: 'c', target: 'b', type: 'call' }];
    expect(computeDataHash([], edgesA)).not.toBe(computeDataHash([], edgesB));
  });

  it('produces different hashes for edges with different target', () => {
    const edgesA = [{ id: 'e1', source: 'a', target: 'b', type: 'call' }];
    const edgesB = [{ id: 'e1', source: 'a', target: 'd', type: 'call' }];
    expect(computeDataHash([], edgesA)).not.toBe(computeDataHash([], edgesB));
  });

  it('produces different hashes for edges with different type', () => {
    const edgesA = [{ id: 'e1', source: 'a', target: 'b', type: 'call' }];
    const edgesB = [{ id: 'e1', source: 'a', target: 'b', type: 'inherit' }];
    expect(computeDataHash([], edgesA)).not.toBe(computeDataHash([], edgesB));
  });

  it('produces different hashes for different number of nodes', () => {
    const nodesA = [{ id: 'a', type: 'class' }];
    const nodesB = [{ id: 'a', type: 'class' }, { id: 'b', type: 'function' }];
    expect(computeDataHash(nodesA, [])).not.toBe(computeDataHash(nodesB, []));
  });

  it('produces different hashes for different number of edges', () => {
    const edgesA = [{ id: 'e1', source: 'a', target: 'b', type: 'call' }];
    const edgesB = [
      { id: 'e1', source: 'a', target: 'b', type: 'call' },
      { id: 'e2', source: 'c', target: 'd', type: 'call' },
    ];
    expect(computeDataHash([], edgesA)).not.toBe(computeDataHash([], edgesB));
  });
});

describe('DiagramCache.size', () => {
  it('returns 0 for empty cache', () => {
    const cache = new DiagramCache(5);
    expect(cache.size()).toBe(0);
  });

  it('returns correct count after entries added', () => {
    const cache = new DiagramCache(5);
    cache.set('inheritance', 'h1', makeLayeredDiagram());
    cache.set('callgraph', 'h2', makeLayeredDiagram());
    expect(cache.size()).toBe(2);
  });

  it('returns correct count after eviction', () => {
    const cache = new DiagramCache(2);
    cache.set('inheritance', 'h1', makeLayeredDiagram());
    cache.set('callgraph', 'h2', makeLayeredDiagram());
    cache.set('package', 'h3', makeLayeredDiagram());
    expect(cache.size()).toBe(2);
  });
});

describe('ClusterCache.size', () => {
  it('returns 0 for empty cache', () => {
    const cache = new ClusterCache(5);
    expect(cache.size()).toBe(0);
  });

  it('returns correct count after entries added', () => {
    const cache = new ClusterCache(5);
    cache.set('h1', 'directory', '', makeClusterResult());
    cache.set('h2', 'function', 'nodeA', makeClusterResult());
    expect(cache.size()).toBe(2);
  });

  it('returns correct count after eviction', () => {
    const cache = new ClusterCache(2);
    cache.set('h1', 'directory', '', makeClusterResult());
    cache.set('h2', 'directory', '', makeClusterResult());
    cache.set('h3', 'directory', '', makeClusterResult());
    expect(cache.size()).toBe(2);
  });
});

describe('DiagramCache.invalidate with IndexedDB', () => {
  it('clears only specified viewMode entries from memory and calls idbCache.invalidateDiagram', async () => {
    const cache = new DiagramCache(5);
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(null),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.set('inheritance', 'h1', makeLayeredDiagram());
    cache.set('callgraph', 'h2', makeLayeredDiagram());

    cache.invalidate('inheritance');
    await new Promise((r) => setTimeout(r, 10));

    expect(cache.size()).toBe(1);
    expect(cache.get('callgraph', 'h2')).not.toBeNull();
    expect(mockIdb.invalidateDiagram).toHaveBeenCalledWith('inheritance');
  });
});

describe('ClusterCache.invalidate with IndexedDB', () => {
  it('clears memory cache and calls idbCache.invalidateCluster', async () => {
    const cache = new ClusterCache(5);
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(null),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.set('h1', 'directory', '', makeClusterResult());
    cache.set('h2', 'function', 'nodeA', makeClusterResult());

    cache.invalidate();
    await new Promise((r) => setTimeout(r, 10));

    expect(cache.size()).toBe(0);
    expect(mockIdb.invalidateCluster).toHaveBeenCalledTimes(1);
  });
});
describe('DiagramCache additional coverage', () => {
  it('get with idbCache miss returns null, getAsync returns null', async () => {
    const cache = new DiagramCache(5);
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(null),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    expect(cache.get('inheritance', 'h1')).toBeNull();
    const result = await cache.getAsync('inheritance', 'h1');
    expect(result).toBeNull();
    expect(cache.size()).toBe(0);
    expect(mockIdb.getDiagram).toHaveBeenCalledWith('inheritance:h1');
  });

  it('set with idbCache routes setDiagram call with correct key', async () => {
    const cache = new DiagramCache(5);
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(null),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    const diagram = makeLayeredDiagram();
    cache.set('callgraph', 'h2', diagram);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockIdb.setDiagram).toHaveBeenCalledWith('callgraph:h2', diagram);
  });

  it('set with idbCache rejection logs warning but does not throw', async () => {
    const cache = new DiagramCache(5);
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(null),
      setDiagram: vi.fn().mockRejectedValue(new Error('set fail')),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.set('inheritance', 'h1', makeLayeredDiagram());
    await new Promise((r) => setTimeout(r, 10));
    // Cache should still have the entry in memory
    expect(cache.size()).toBe(1);
  });

  it('invalidate with idbCache rejection logs warning but does not throw', async () => {
    const cache = new DiagramCache(5);
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(null),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockRejectedValue(new Error('invalidate fail')),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.set('inheritance', 'h1', makeLayeredDiagram());
    cache.invalidate('inheritance');
    await new Promise((r) => setTimeout(r, 10));
    // Memory cache should still be cleared
    expect(cache.size()).toBe(0);
  });

  it('invalidate all with idbCache rejection logs warning but does not throw', async () => {
    const cache = new DiagramCache(5);
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(null),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockRejectedValue(new Error('invalidate all fail')),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.set('inheritance', 'h1', makeLayeredDiagram());
    cache.invalidate();
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.size()).toBe(0);
  });

  it('getAsync with idbCache loads diagram and evicts when cache is full', async () => {
    const cache = new DiagramCache(1);
    const d1 = makeLayeredDiagram();
    const d2 = makeLayeredDiagram();
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(d2),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.set('inheritance', 'h1', d1);
    expect(cache.size()).toBe(1);
    const result = await cache.getAsync('callgraph', 'h2');
    expect(result).toBe(d2);
    expect(cache.get('inheritance', 'h1')).toBeNull();
    expect(cache.get('callgraph', 'h2')).toBe(d2);
  });

  it('getAsync does not overwrite when key already exists in cache', async () => {
    const cache = new DiagramCache(5);
    const d1 = makeLayeredDiagram();
    const d2 = makeLayeredDiagram();
    const mockIdb = {
      getDiagram: vi.fn().mockResolvedValue(d2),
      setDiagram: vi.fn().mockResolvedValue(undefined),
      invalidateDiagram: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.set('inheritance', 'h1', d1);
    const result = await cache.getAsync('inheritance', 'h1');
    expect(result).toBe(d1);
  });
});

describe('ClusterCache additional coverage', () => {
  it('get with idbCache miss returns null, getAsync returns null', async () => {
    const cache = new ClusterCache(5);
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(null),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    expect(cache.get('h1', 'directory', '')).toBeNull();
    const result = await cache.getAsync('h1', 'directory', '');
    expect(result).toBeNull();
    expect(cache.size()).toBe(0);
    expect(mockIdb.getCluster).toHaveBeenCalledWith('h1:directory:');
  });

  it('set with idbCache routes setCluster call with correct key', async () => {
    const cache = new ClusterCache(5);
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(null),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    const result = makeClusterResult();
    cache.set('h1', 'directory', '', result);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockIdb.setCluster).toHaveBeenCalledWith('h1:directory:', result);
  });

  it('set with idbCache rejection logs warning but does not throw', async () => {
    const cache = new ClusterCache(5);
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(null),
      setCluster: vi.fn().mockRejectedValue(new Error('set fail')),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.set('h1', 'directory', '', makeClusterResult());
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.size()).toBe(1);
  });

  it('invalidate with idbCache rejection logs warning but does not throw', async () => {
    const cache = new ClusterCache(5);
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(null),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockRejectedValue(new Error('invalidate fail')),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.set('h1', 'directory', '', makeClusterResult());
    cache.invalidate();
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.size()).toBe(0);
  });

  it('getAsync with idbCache loads result and evicts when cache is full', async () => {
    const cache = new ClusterCache(1);
    const r1 = makeClusterResult();
    const r2 = makeClusterResult();
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(r2),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.set('h1', 'directory', '', r1);
    expect(cache.size()).toBe(1);
    const result = await cache.getAsync('h2', 'directory', '');
    expect(result).toBe(r2);
    expect(cache.get('h1', 'directory', '')).toBeNull();
    expect(cache.get('h2', 'directory', '')).toBe(r2);
  });

  it('getAsync does not overwrite when key already exists in cache', async () => {
    const cache = new ClusterCache(5);
    const r1 = makeClusterResult();
    const r2 = makeClusterResult();
    const mockIdb = {
      getCluster: vi.fn().mockResolvedValue(r2),
      setCluster: vi.fn().mockResolvedValue(undefined),
      invalidateCluster: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as any;
    cache.setPersistentBackend(mockIdb);
    cache.set('h1', 'directory', '', r1);
    const result = await cache.getAsync('h1', 'directory', '');
    expect(result).toBe(r1);
  });
});