import { scoped } from '../../shared/Logger.ts';

const log = scoped('indexeddb-cache');

const DB_PREFIX = 'codegraph-cache-';
const DB_VERSION = 1;
const CLUSTER_STORE = 'cluster-cache';
const DIAGRAM_STORE = 'diagram-cache';

function openDB(repoId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const dbName = `${DB_PREFIX}${repoId}`;
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CLUSTER_STORE)) {
        db.createObjectStore(CLUSTER_STORE);
      }
      if (!db.objectStoreNames.contains(DIAGRAM_STORE)) {
        db.createObjectStore(DIAGRAM_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

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
    try {
      const db = await this.getDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(CLUSTER_STORE, 'readonly');
        const req = tx.objectStore(CLUSTER_STORE).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      log.warn('IndexedDB getCluster failed', { key, error: e });
      return null;
    }
  }

  async setCluster(key: string, value: unknown): Promise<void> {
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(CLUSTER_STORE, 'readwrite');
        tx.objectStore(CLUSTER_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      log.warn('IndexedDB setCluster failed', { key, error: e });
    }
  }

  async getDiagram(key: string): Promise<unknown | null> {
    try {
      const db = await this.getDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DIAGRAM_STORE, 'readonly');
        const req = tx.objectStore(DIAGRAM_STORE).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      log.warn('IndexedDB getDiagram failed', { key, error: e });
      return null;
    }
  }

  async setDiagram(key: string, value: unknown): Promise<void> {
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(DIAGRAM_STORE, 'readwrite');
        tx.objectStore(DIAGRAM_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      log.warn('IndexedDB setDiagram failed', { key, error: e });
    }
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

  close(): void {
    if (this.dbPromise) {
      this.dbPromise.then((db) => db.close()).catch(() => {});
      this.dbPromise = null;
    }
  }
}