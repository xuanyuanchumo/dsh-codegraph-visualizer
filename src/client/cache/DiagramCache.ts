import type { ViewMode } from '../../types/index.ts';
import type { LayeredDiagram } from '../diagram/DiagramAssembler.ts';
import type { ClusterLevel, ClusterResult } from '../store/cluster/index.ts';


function computeDataHash(nodes: { id: string; type: string }[], edges: { id: string; source: string; target: string; type: string }[]): string {
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

  return `${(nodeHash >>> 0).toString(16)}_${(edgeHash >>> 0).toString(16)}`;
}

export class DiagramCache {
  private cache: Map<string, LayeredDiagram> = new Map();
  private maxEntries: number;

  constructor(maxEntries = 10) {
    this.maxEntries = maxEntries;
  }

  get(viewMode: ViewMode, dataHash: string): LayeredDiagram | null {
    const key = `${viewMode}:${dataHash}`;
    const value = this.cache.get(key);
    if (value) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value ?? null;
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
  }

  invalidate(viewMode?: ViewMode): void {
    if (viewMode) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${viewMode}:`)) this.cache.delete(key);
      }
    } else {
      this.cache.clear();
    }
  }

  size(): number {
    return this.cache.size;
  }
}

export class ClusterCache {
  private cache: Map<string, ClusterResult> = new Map();
  private maxEntries: number;

  constructor(maxEntries = 20) {
    this.maxEntries = maxEntries;
  }

  get(
    dataHash: string,
    level: ClusterLevel,
    expandedKey: string,
  ): ClusterResult | null {
    const key = `${dataHash}:${level}:${expandedKey}`;
    const value = this.cache.get(key);
    if (value) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value ?? null;
  }

  set(
    dataHash: string,
    level: ClusterLevel,
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
  }

  invalidate(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export { computeDataHash };