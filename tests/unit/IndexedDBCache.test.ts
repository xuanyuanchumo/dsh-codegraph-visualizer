import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IndexedDBCache } from '../../src/client/cache/IndexedDBCache.ts';

interface MockIDBTransaction {
  objectStore: ReturnType<typeof vi.fn>;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  error: DOMException | null;
}

interface MockIDBObjectStore {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  getAllKeys: ReturnType<typeof vi.fn>;
}

interface MockIDBRequest {
  result: unknown;
  error: DOMException | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

interface MockIDBDatabase {
  transaction: ReturnType<typeof vi.fn>;
  objectStoreNames: { contains: ReturnType<typeof vi.fn> };
  createObjectStore: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createMockDB(): MockIDBDatabase {
  const stores: Map<string, Map<string, unknown>> = new Map();
  const storeNames = new Set<string>();

  const createObjectStore = vi.fn((name: string) => {
    stores.set(name, new Map());
    storeNames.add(name);
    return createMockObjectStore(name);
  });

  function createMockObjectStore(name: string): MockIDBObjectStore {
    const storeMap = stores.get(name)!;
    return {
      get: vi.fn((key: string): MockIDBRequest => {
        const req: MockIDBRequest = {
          result: storeMap.get(key) ?? null,
          error: null,
          onsuccess: null,
          onerror: null,
        };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      }),
      put: vi.fn((value: unknown, key: string): MockIDBRequest => {
        storeMap.set(key, value);
        const req: MockIDBRequest = { result: undefined, error: null, onsuccess: null, onerror: null };
        return req;
      }),
      delete: vi.fn((key: string): MockIDBRequest => {
        storeMap.delete(key);
        const req: MockIDBRequest = { result: undefined, error: null, onsuccess: null, onerror: null };
        return req;
      }),
      clear: vi.fn((): MockIDBRequest => {
        storeMap.clear();
        const req: MockIDBRequest = { result: undefined, error: null, onsuccess: null, onerror: null };
        return req;
      }),
      getAllKeys: vi.fn((): MockIDBRequest => {
        const keys = Array.from(storeMap.keys());
        const req: MockIDBRequest = { result: keys, error: null, onsuccess: null, onerror: null };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      }),
    };
  }

  const db: MockIDBDatabase = {
    transaction: vi.fn((storeName: string, _mode: string): MockIDBTransaction => {
      const store = createMockObjectStore(storeName);
      const tx: MockIDBTransaction = {
        objectStore: vi.fn(() => store),
        oncomplete: null,
        onerror: null,
        error: null,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    }),
    objectStoreNames: { contains: vi.fn((name: string) => storeNames.has(name)) },
    createObjectStore,
    close: vi.fn(),
  };

  return db;
}

function mockIndexedDB(db: MockIDBDatabase) {
  const openRequest = {
    result: db,
    error: null,
    onupgradeneeded: null as (() => void) | null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };

  vi.stubGlobal('indexedDB', {
    open: vi.fn(() => {
      queueMicrotask(() => {
        openRequest.onupgradeneeded?.();
        openRequest.onsuccess?.();
      });
      return openRequest;
    }),
  });

  return openRequest;
}

describe('IndexedDBCache', () => {
  let cache: IndexedDBCache;
  let mockDB: MockIDBDatabase;

  beforeEach(() => {
    mockDB = createMockDB();
    mockIndexedDB(mockDB);
    cache = new IndexedDBCache('test-repo');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('constructs with a repoId', () => {
    expect(cache).toBeInstanceOf(IndexedDBCache);
  });

  it('setCluster and getCluster round-trip', async () => {
    const data = { nodes: [{ id: 'n1' }], edges: [] };
    await cache.setCluster('key1', data);
    const result = await cache.getCluster('key1');
    expect(result).toEqual(data);
  });

  it('getCluster returns null for missing key', async () => {
    const result = await cache.getCluster('nonexistent');
    expect(result).toBeNull();
  });

  it('setDiagram and getDiagram round-trip', async () => {
    const data = { viewMode: 'inheritance', layers: [] };
    await cache.setDiagram('inheritance:hash1', data);
    const result = await cache.getDiagram('inheritance:hash1');
    expect(result).toEqual(data);
  });

  it('getDiagram returns null for missing key', async () => {
    const result = await cache.getDiagram('nonexistent');
    expect(result).toBeNull();
  });

  it('invalidateCluster clears all cluster entries', async () => {
    await cache.setCluster('key1', { data: 1 });
    await cache.setCluster('key2', { data: 2 });
    await cache.invalidateCluster();
    const r1 = await cache.getCluster('key1');
    const r2 = await cache.getCluster('key2');
    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });

  it('invalidateDiagram without viewMode clears all diagram entries', async () => {
    await cache.setDiagram('inheritance:hash1', { data: 1 });
    await cache.setDiagram('callgraph:hash2', { data: 2 });
    await cache.invalidateDiagram();
    const r1 = await cache.getDiagram('inheritance:hash1');
    const r2 = await cache.getDiagram('callgraph:hash2');
    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });

  it('invalidateDiagram with viewMode clears only matching entries', async () => {
    await cache.setDiagram('inheritance:hash1', { data: 1 });
    await cache.setDiagram('callgraph:hash2', { data: 2 });
    await cache.invalidateDiagram('inheritance');
    const r1 = await cache.getDiagram('inheritance:hash1');
    const r2 = await cache.getDiagram('callgraph:hash2');
    expect(r1).toBeNull();
    expect(r2).toEqual({ data: 2 });
  });

  it('close calls database close method after db is opened', async () => {
    await cache.setCluster('key1', { data: 1 });
    cache.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockDB.close).toHaveBeenCalled();
  });

  it('close after operations closes the database', async () => {
    await cache.setCluster('key1', { data: 1 });
    cache.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockDB.close).toHaveBeenCalled();
  });

  it('handles IndexedDB open failure gracefully', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        const req: { result: unknown; error: DOMException | null; onupgradeneeded: (() => void) | null; onsuccess: (() => void) | null; onerror: (() => void) | null } = { result: null, error: new DOMException('fail'), onupgradeneeded: null, onsuccess: null, onerror: null };
        queueMicrotask(() => req.onerror?.());
        return req;
      }),
    });

    const failCache = new IndexedDBCache('fail-repo');
    const result = await failCache.getCluster('key1');
    expect(result).toBeNull();
  });

  it('handles getCluster transaction failure gracefully', async () => {
    const badDB = createMockDB();
    badDB.transaction = vi.fn(() => {
      const tx: MockIDBTransaction = {
        objectStore: vi.fn(() => ({
          get: vi.fn(() => {
            const req: MockIDBRequest = { result: null, error: new DOMException('tx fail'), onsuccess: null, onerror: null };
            queueMicrotask(() => req.onerror?.());
            return req;
          }),
          put: vi.fn(),
          delete: vi.fn(),
          clear: vi.fn(),
          getAllKeys: vi.fn(),
        })),
        oncomplete: null,
        onerror: null,
        error: new DOMException('tx fail'),
      };
      queueMicrotask(() => tx.onerror?.());
      return tx;
    });
    mockIndexedDB(badDB);

    const failCache = new IndexedDBCache('tx-fail-repo');
    const result = await failCache.getCluster('key1');
    expect(result).toBeNull();
  });

  it('handles setCluster tx.onerror callback', async () => {
    const badDB = createMockDB();
    badDB.transaction = vi.fn(() => {
      const tx: MockIDBTransaction = {
        objectStore: vi.fn(() => ({
          get: vi.fn(),
          put: vi.fn(() => ({ result: undefined, error: null, onsuccess: null, onerror: null })),
          delete: vi.fn(),
          clear: vi.fn(),
          getAllKeys: vi.fn(),
        })),
        oncomplete: null,
        onerror: null,
        error: new DOMException('setCluster tx error'),
      };
      queueMicrotask(() => tx.onerror?.());
      return tx;
    });
    mockIndexedDB(badDB);

    const failCache = new IndexedDBCache('setcluster-fail-repo');
    await expect(failCache.setCluster('key1', { data: 1 })).resolves.toBeUndefined();
  });

  it('handles getDiagram req.onerror callback', async () => {
    const badDB = createMockDB();
    badDB.transaction = vi.fn(() => {
      const tx: MockIDBTransaction = {
        objectStore: vi.fn(() => ({
          get: vi.fn(() => {
            const req: MockIDBRequest = { result: null, error: new DOMException('getDiagram fail'), onsuccess: null, onerror: null };
            queueMicrotask(() => req.onerror?.());
            return req;
          }),
          put: vi.fn(),
          delete: vi.fn(),
          clear: vi.fn(),
          getAllKeys: vi.fn(),
        })),
        oncomplete: null,
        onerror: null,
        error: null,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    });
    mockIndexedDB(badDB);

    const failCache = new IndexedDBCache('getdiagram-fail-repo');
    const result = await failCache.getDiagram('key1');
    expect(result).toBeNull();
  });

  it('handles setDiagram tx.onerror callback', async () => {
    const badDB = createMockDB();
    badDB.transaction = vi.fn(() => {
      const tx: MockIDBTransaction = {
        objectStore: vi.fn(() => ({
          get: vi.fn(),
          put: vi.fn(() => ({ result: undefined, error: null, onsuccess: null, onerror: null })),
          delete: vi.fn(),
          clear: vi.fn(),
          getAllKeys: vi.fn(),
        })),
        oncomplete: null,
        onerror: null,
        error: new DOMException('setDiagram tx error'),
      };
      queueMicrotask(() => tx.onerror?.());
      return tx;
    });
    mockIndexedDB(badDB);

    const failCache = new IndexedDBCache('setdiagram-fail-repo');
    await expect(failCache.setDiagram('key1', { data: 1 })).resolves.toBeUndefined();
  });

  it('handles invalidateCluster tx.onerror callback', async () => {
    const badDB = createMockDB();
    badDB.transaction = vi.fn(() => {
      const tx: MockIDBTransaction = {
        objectStore: vi.fn(() => ({
          get: vi.fn(),
          put: vi.fn(),
          delete: vi.fn(),
          clear: vi.fn(() => ({ result: undefined, error: null, onsuccess: null, onerror: null })),
          getAllKeys: vi.fn(),
        })),
        oncomplete: null,
        onerror: null,
        error: new DOMException('invalidateCluster tx error'),
      };
      queueMicrotask(() => tx.onerror?.());
      return tx;
    });
    mockIndexedDB(badDB);

    const failCache = new IndexedDBCache('invalidatecluster-fail-repo');
    await expect(failCache.invalidateCluster()).resolves.toBeUndefined();
  });

  it('handles invalidateDiagram tx.onerror callback (clear path)', async () => {
    const badDB = createMockDB();
    badDB.transaction = vi.fn(() => {
      const tx: MockIDBTransaction = {
        objectStore: vi.fn(() => ({
          get: vi.fn(),
          put: vi.fn(),
          delete: vi.fn(),
          clear: vi.fn(() => ({ result: undefined, error: null, onsuccess: null, onerror: null })),
          getAllKeys: vi.fn(),
        })),
        oncomplete: null,
        onerror: null,
        error: new DOMException('invalidateDiagram tx error'),
      };
      queueMicrotask(() => tx.onerror?.());
      return tx;
    });
    mockIndexedDB(badDB);

    const failCache = new IndexedDBCache('invalidatediagram-fail-repo');
    await expect(failCache.invalidateDiagram()).resolves.toBeUndefined();
  });

  it('handles invalidateDiagram with viewMode tx.onerror callback (delete path)', async () => {
    const badDB = createMockDB();
    let callCount = 0;
    badDB.transaction = vi.fn(() => {
      callCount++;
      const tx: MockIDBTransaction = {
        objectStore: vi.fn(() => ({
          get: vi.fn(),
          put: vi.fn(),
          delete: vi.fn(() => ({ result: undefined, error: null, onsuccess: null, onerror: null })),
          clear: vi.fn(),
          getAllKeys: vi.fn(() => {
            const req: MockIDBRequest = { result: ['inheritance:hash1'], error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess?.());
            return req;
          }),
        })),
        oncomplete: null,
        onerror: null,
        error: callCount === 2 ? new DOMException('delete tx error') : null,
      };
      if (callCount === 2) {
        queueMicrotask(() => tx.onerror?.());
      } else {
        queueMicrotask(() => tx.oncomplete?.());
      }
      return tx;
    });
    mockIndexedDB(badDB);

    const failCache = new IndexedDBCache('invalidatediagram-viewmode-fail-repo');
    await expect(failCache.invalidateDiagram('inheritance')).resolves.toBeUndefined();
  });

  it('handles invalidateDiagram getAllKeys req.onerror callback', async () => {
    const badDB = createMockDB();
    badDB.transaction = vi.fn(() => {
      const tx: MockIDBTransaction = {
        objectStore: vi.fn(() => ({
          get: vi.fn(),
          put: vi.fn(),
          delete: vi.fn(),
          clear: vi.fn(),
          getAllKeys: vi.fn(() => {
            const req: MockIDBRequest = { result: null, error: new DOMException('getAllKeys fail'), onsuccess: null, onerror: null };
            queueMicrotask(() => req.onerror?.());
            return req;
          }),
        })),
        oncomplete: null,
        onerror: null,
        error: null,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    });
    mockIndexedDB(badDB);

    const failCache = new IndexedDBCache('getallkeys-fail-repo');
    await expect(failCache.invalidateDiagram('inheritance')).resolves.toBeUndefined();
  });

  it('handles invalidateDiagram with viewMode and no matching keys', async () => {
    const badDB = createMockDB();
    badDB.transaction = vi.fn(() => {
      const tx: MockIDBTransaction = {
        objectStore: vi.fn(() => ({
          get: vi.fn(),
          put: vi.fn(),
          delete: vi.fn(),
          clear: vi.fn(),
          getAllKeys: vi.fn(() => {
            const req: MockIDBRequest = { result: ['callgraph:hash1', 'callgraph:hash2'], error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => req.onsuccess?.());
            return req;
          }),
        })),
        oncomplete: null,
        onerror: null,
        error: null,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    });
    mockIndexedDB(badDB);

    const failCache = new IndexedDBCache('no-match-keys-repo');
    await expect(failCache.invalidateDiagram('inheritance')).resolves.toBeUndefined();
  });

  it('handles getDB failure on retry (dbPromise reset after error)', async () => {
    vi.unstubAllGlobals();
    let openCallCount = 0;
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        openCallCount++;
        const req: { result: unknown; error: DOMException | null; onupgradeneeded: (() => void) | null; onsuccess: (() => void) | null; onerror: (() => void) | null } = { result: null, error: new DOMException('fail'), onupgradeneeded: null, onsuccess: null, onerror: null };
        queueMicrotask(() => req.onerror?.());
        return req;
      }),
    });

    const failCache = new IndexedDBCache('retry-fail-repo');
    const result1 = await failCache.getCluster('key1');
    expect(result1).toBeNull();
    const result2 = await failCache.getCluster('key2');
    expect(result2).toBeNull();
    expect(openCallCount).toBeGreaterThanOrEqual(2);
  });
});