import { scoped } from '../../shared/Logger.ts';
import { INDEXED_DB } from '../../shared/constants.ts';

const log = scoped('indexeddb-cache');

const DB_PREFIX = 'codegraph-cache-';

const CLUSTER_STORE = 'cluster-cache';
const DIAGRAM_STORE = 'diagram-cache';
const OUTLINE_STORE = 'outline-cache';
const AST_STORE = 'ast-cache';
const EDGES_STORE = 'edges-cache';

const ALL_STORES = [CLUSTER_STORE, DIAGRAM_STORE, OUTLINE_STORE, AST_STORE, EDGES_STORE] as const;

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttlMs: number;
}

function isCacheEntry(obj: unknown): obj is CacheEntry<unknown> {
  return (
    typeof obj === 'object' && obj !== null &&
    'value' in obj && 'timestamp' in obj && 'ttlMs' in obj &&
    typeof (obj as CacheEntry<unknown>).timestamp === 'number' &&
    typeof (obj as CacheEntry<unknown>).ttlMs === 'number'
  );
}

function isExpired(entry: CacheEntry<unknown>): boolean {
  return Date.now() - entry.timestamp > entry.ttlMs;
}

function openDB(repoId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const dbName = `${DB_PREFIX}${repoId}`;
    const request = indexedDB.open(dbName, INDEXED_DB.DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CLUSTER_STORE)) {
        db.createObjectStore(CLUSTER_STORE);
      }
      if (!db.objectStoreNames.contains(DIAGRAM_STORE)) {
        db.createObjectStore(DIAGRAM_STORE);
      }
      if (!db.objectStoreNames.contains(OUTLINE_STORE)) {
        db.createObjectStore(OUTLINE_STORE);
      }
      if (!db.objectStoreNames.contains(AST_STORE)) {
        db.createObjectStore(AST_STORE);
      }
      if (!db.objectStoreNames.contains(EDGES_STORE)) {
        db.createObjectStore(EDGES_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  usageRatio: number;
}

export interface BatchEntry {
  key: string;
  value: unknown;
}

const TTL_BY_STORE: Record<string, number> = {
  [CLUSTER_STORE]: INDEXED_DB.TTL.CLUSTER_MS,
  [DIAGRAM_STORE]: INDEXED_DB.TTL.DIAGRAM_MS,
  [OUTLINE_STORE]: INDEXED_DB.TTL.OUTLINE_MS,
  [AST_STORE]: INDEXED_DB.TTL.AST_MS,
  [EDGES_STORE]: INDEXED_DB.TTL.EDGES_MS,
};

export class IndexedDBCache {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private repoId: string;

  constructor(repoId: string) {
    this.repoId = repoId;
  }

  private getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB(this.repoId).catch((err) => {
        log.warn('failed to open IndexedDB', { repoId: this.repoId, error: err });
        this.dbPromise = null;
        throw err;
      });
    }
    return this.dbPromise;
  }

  async getCluster(key: string): Promise<unknown | null> {
    return this.getFromStore(CLUSTER_STORE, key);
  }

  async setCluster(key: string, value: unknown): Promise<void> {
    return this.setToStore(CLUSTER_STORE, key, value);
  }

  async getDiagram(key: string): Promise<unknown | null> {
    return this.getFromStore(DIAGRAM_STORE, key);
  }

  async setDiagram(key: string, value: unknown): Promise<void> {
    return this.setToStore(DIAGRAM_STORE, key, value);
  }

  async invalidateCluster(): Promise<void> {
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CLUSTER_STORE, 'readwrite');
        tx.objectStore(CLUSTER_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      log.warn('IndexedDB invalidateCluster failed', { error: e });
    }
  }

  async invalidateDiagram(viewMode?: string): Promise<void> {
    try {
      const db = await this.getDB();
      if (viewMode) {
        const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
          const tx = db.transaction(DIAGRAM_STORE, 'readonly');
          const req = tx.objectStore(DIAGRAM_STORE).getAllKeys();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const matching = keys.filter((k) => String(k).startsWith(`${viewMode}:`));
        if (matching.length > 0) {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(DIAGRAM_STORE, 'readwrite');
            for (const k of matching) tx.objectStore(DIAGRAM_STORE).delete(k);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        }
      } else {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(DIAGRAM_STORE, 'readwrite');
          tx.objectStore(DIAGRAM_STORE).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    } catch (e) {
      log.warn('IndexedDB invalidateDiagram failed', { viewMode, error: e });
    }
  }

  async getOutline(nodeId: string): Promise<unknown | null> {
    return this.getFromStore(OUTLINE_STORE, nodeId);
  }

  async setOutline(nodeId: string, value: unknown): Promise<void> {
    return this.setToStore(OUTLINE_STORE, nodeId, value);
  }

  async getAST(nodeId: string): Promise<unknown | null> {
    return this.getFromStore(AST_STORE, nodeId);
  }

  async setAST(nodeId: string, value: unknown): Promise<void> {
    return this.setToStore(AST_STORE, nodeId, value);
  }

  async getEdges(key: string): Promise<unknown | null> {
    return this.getFromStore(EDGES_STORE, key);
  }

  async setEdges(key: string, value: unknown): Promise<void> {
    return this.setToStore(EDGES_STORE, key, value);
  }

  async setMany(storeName: string, entries: BatchEntry[]): Promise<void> {
    if (entries.length === 0) return;
    if (entries.length > INDEXED_DB.BATCH.MAX_ENTRIES) {
      log.warn('setMany batch exceeds limit, splitting', { count: entries.length, limit: INDEXED_DB.BATCH.MAX_ENTRIES });
      for (let i = 0; i < entries.length; i += INDEXED_DB.BATCH.MAX_ENTRIES) {
        await this.setMany(storeName, entries.slice(i, i + INDEXED_DB.BATCH.MAX_ENTRIES));
      }
      return;
    }
    const ttlMs = TTL_BY_STORE[storeName] ?? INDEXED_DB.TTL.CLUSTER_MS;
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const now = Date.now();
        for (const { key, value } of entries) {
          const entry: CacheEntry<unknown> = { value, timestamp: now, ttlMs };
          store.put(entry, key);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      log.warn(`IndexedDB setMany(${storeName}) failed`, { count: entries.length, error: e });
    }
  }

  async getStorageEstimate(): Promise<StorageEstimate | null> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return {
        usage,
        quota,
        usageRatio: quota > 0 ? usage / quota : 0,
      };
    } catch (e) {
      log.warn('storage.estimate() failed', { error: e });
      return null;
    }
  }

  async isCapacityHigh(): Promise<boolean> {
    const estimate = await this.getStorageEstimate();
    if (!estimate) return false;
    return estimate.usageRatio >= INDEXED_DB.CAPACITY.HIGH_WATERMARK;
  }

  async purgeExpired(): Promise<number> {
    let totalPurged = 0;
    for (const storeName of ALL_STORES) {
      totalPurged += await this.purgeExpiredStore(storeName);
    }
    if (totalPurged > 0) {
      log.info('purged expired entries', { count: totalPurged });
    }
    return totalPurged;
  }

  private async purgeExpiredStore(storeName: string): Promise<number> {
    try {
      const db = await this.getDB();
      const allEntries = await new Promise<[IDBValidKey, unknown][]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const cursorReq = store.openCursor();
        const results: [IDBValidKey, unknown][] = [];
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            results.push([cursor.key, cursor.value]);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
      const expiredKeys: IDBValidKey[] = [];
      for (const [key, value] of allEntries) {
        if (isCacheEntry(value) && isExpired(value)) {
          expiredKeys.push(key);
        }
      }
      if (expiredKeys.length === 0) return 0;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const key of expiredKeys) store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return expiredKeys.length;
    } catch (e) {
      log.warn(`purgeExpiredStore(${storeName}) failed`, { error: e });
      return 0;
    }
  }

  private async getFromStore(storeName: string, key: string): Promise<unknown | null> {
    try {
      const db = await this.getDB();
      const raw = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
      if (raw === null) return null;
      if (isCacheEntry(raw)) {
        if (isExpired(raw)) {
          this.deleteFromStore(storeName, key).catch(() => {});
          return null;
        }
        return raw.value;
      }
      return raw;
    } catch (e) {
      log.warn(`IndexedDB getFromStore(${storeName}) failed`, { key, error: e });
      return null;
    }
  }

  private async setToStore(storeName: string, key: string, value: unknown): Promise<void> {
    const ttlMs = TTL_BY_STORE[storeName] ?? INDEXED_DB.TTL.CLUSTER_MS;
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const entry: CacheEntry<unknown> = { value, timestamp: Date.now(), ttlMs };
        tx.objectStore(storeName).put(entry, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      log.warn(`IndexedDB setToStore(${storeName}) failed`, { key, error: e });
    }
  }

  private async deleteFromStore(storeName: string, key: string): Promise<void> {
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      log.warn(`IndexedDB deleteFromStore(${storeName}) failed`, { key, error: e });
    }
  }

  close(): void {
    if (this.dbPromise) {
      this.dbPromise.then((db) => db.close()).catch(() => {});
      this.dbPromise = null;
    }
  }
}