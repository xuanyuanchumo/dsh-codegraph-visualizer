import type { ViewMode } from '../../types/index.ts';
import type { LayeredDiagram } from '../diagram/DiagramAssembler.ts';
import type { ClusterResult } from '../store/cluster/index.ts';
import { IndexedDBCache } from './IndexedDBCache.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('cache');


function computeDataHash(
  nodes: { id: string; type: string; label?: string; filePath?: string; lineNumber?: number; parentId?: string; properties?: Record<string, unknown> }[],
  edges: { id: string; source: string; target: string; type: string; properties?: Record<string, unknown> }[],
): string {
  let nodeHash = 0x811c9dc5;
  for (const n of nodes) {
    for (let i = 0; i < n.id.length; i++) {
      nodeHash ^= n.id.charCodeAt(i);
      nodeHash = Math.imul(nodeHash, 0x01000193);
    }
    nodeHash ^= ':'.charCodeAt(0);
    nodeHash = Math.imul(nodeHash, 0x01000193);
    for (let i = 0; i < n.type.length; i++) {
      nodeHash ^= n.type.charCodeAt(i);
      nodeHash = Math.imul(nodeHash, 0x01000193);
    }
    nodeHash ^= ':'.charCodeAt(0);
    nodeHash = Math.imul(nodeHash, 0x01000193);
    const parentId = n.parentId ?? '';
    for (let i = 0; i < parentId.length; i++) {
      nodeHash ^= parentId.charCodeAt(i);
      nodeHash = Math.imul(nodeHash, 0x01000193);
    }
    nodeHash ^= '|'.charCodeAt(0);
    nodeHash = Math.imul(nodeHash, 0x01000193);
  }

  let edgeHash = 0x811c9dc5;
  for (const e of edges) {
    for (let i = 0; i < e.id.length; i++) {
      edgeHash ^= e.id.charCodeAt(i);
      edgeHash = Math.imul(edgeHash, 0x01000193);
    }
    edgeHash ^= ':'.charCodeAt(0);
    edgeHash = Math.imul(edgeHash, 0x01000193);
    for (let i = 0; i < e.source.length; i++) {
      edgeHash ^= e.source.charCodeAt(i);
      edgeHash = Math.imul(edgeHash, 0x01000193);
    }
    edgeHash ^= ':'.charCodeAt(0);
    edgeHash = Math.imul(edgeHash, 0x01000193);
    for (let i = 0; i < e.target.length; i++) {
      edgeHash ^= e.target.charCodeAt(i);
      edgeHash = Math.imul(edgeHash, 0x01000193);
    }
    edgeHash ^= ':'.charCodeAt(0);
    edgeHash = Math.imul(edgeHash, 0x01000193);
    for (let i = 0; i < e.type.length; i++) {
      edgeHash ^= e.type.charCodeAt(i);
      edgeHash = Math.imul(edgeHash, 0x01000193);
    }
    edgeHash ^= '|'.charCodeAt(0);
    edgeHash = Math.imul(edgeHash, 0x01000193);
  }

  return `${(nodeHash >>> 0).toString(16)}_${(edgeHash >>> 0).toString(16)}_${nodes.length}_${edges.length}`;
}

export class DiagramCache {
  private cache: Map<string, LayeredDiagram> = new Map();
  private maxEntries: number;
  private idbCache: IndexedDBCache | null = null;

  constructor(maxEntries = 10) {
    this.maxEntries = maxEntries;
  }

  setPersistentBackend(idbCache: IndexedDBCache): void {
    this.idbCache = idbCache;
  }

  get(viewMode: ViewMode, dataHash: string): LayeredDiagram | null {
    const key = `${viewMode}:${dataHash}`;
    const value = this.cache.get(key);
    if (value) {
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return null;
  }

  async getAsync(viewMode: ViewMode, dataHash: string): Promise<LayeredDiagram | null> {
    const key = `${viewMode}:${dataHash}`;
    const value = this.cache.get(key);
    if (value) {
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    if (this.idbCache) {
      try {
        const diagram = await this.idbCache.getDiagram(key);
        if (diagram && !this.cache.has(key)) {
          if (this.cache.size >= this.maxEntries) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
          }
          this.cache.set(key, diagram as LayeredDiagram);
          return diagram as LayeredDiagram;
        }
      } catch (e) {
        log.warn('IndexedDB diagram getAsync failed', e);
      }
    }
    return null;
  }

  set(viewMode: ViewMode, dataHash: string, diagram: LayeredDiagram): void {
    const key = `${viewMode}:${dataHash}`;
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, diagram);
    if (this.idbCache) {
      this.idbCache.setDiagram(key, diagram).catch((e: unknown) => log.warn('IndexedDB diagram set failed', e));
    }
  }

  invalidate(viewMode?: ViewMode): void {
    if (viewMode) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${viewMode}:`)) this.cache.delete(key);
      }
    } else {
      this.cache.clear();
    }
    if (this.idbCache) {
      this.idbCache.invalidateDiagram(viewMode).catch((e: unknown) => log.warn('IndexedDB diagram invalidate failed', e));
    }
  }

  size(): number {
    return this.cache.size;
  }
}

export class ClusterCache {
  private cache: Map<string, ClusterResult> = new Map();
  private maxEntries: number;
  private idbCache: IndexedDBCache | null = null;

  constructor(maxEntries = 20) {
    this.maxEntries = maxEntries;
  }

  setPersistentBackend(idbCache: IndexedDBCache): void {
    this.idbCache = idbCache;
  }

  get(
    dataHash: string,
    level: string,
    expandedKey: string,
  ): ClusterResult | null {
    const key = `${dataHash}:${level}:${expandedKey}`;
    const value = this.cache.get(key);
    if (value) {
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return null;
  }

  async getAsync(
    dataHash: string,
    level: string,
    expandedKey: string,
  ): Promise<ClusterResult | null> {
    const key = `${dataHash}:${level}:${expandedKey}`;
    const value = this.cache.get(key);
    if (value) {
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    if (this.idbCache) {
      try {
        const result = await this.idbCache.getCluster(key);
        if (result && !this.cache.has(key)) {
          if (this.cache.size >= this.maxEntries) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
          }
          this.cache.set(key, result as ClusterResult);
          return result as ClusterResult;
        }
      } catch (e) {
        log.warn('IndexedDB cluster getAsync failed', e);
      }
    }
    return null;
  }

  set(
    dataHash: string,
    level: string,
    expandedKey: string,
    result: ClusterResult,
  ): void {
    const key = `${dataHash}:${level}:${expandedKey}`;
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, result);
    if (this.idbCache) {
      this.idbCache.setCluster(key, result).catch((e: unknown) => log.warn('IndexedDB cluster set failed', e));
    }
  }

  invalidate(): void {
    this.cache.clear();
    if (this.idbCache) {
      this.idbCache.invalidateCluster().catch((e: unknown) => log.warn('IndexedDB cluster invalidate failed', e));
    }
  }

  size(): number {
    return this.cache.size;
  }
}

export { computeDataHash };
