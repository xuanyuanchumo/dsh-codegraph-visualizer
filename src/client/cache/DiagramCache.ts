import type { ViewMode } from '../../types/index.ts';
import type { LayeredDiagram } from '../diagram/DiagramAssembler.ts';
import type { ClusterLevel, ClusterResult } from '../store/cluster/index.ts';

function computeDataHash(nodes: { id: string; type: string }[], edges: { id: string; source: string; target: string; type: string }[]): string {
  const nodeHash = nodes.map((n) => `${n.id}:${n.type}`).join('|');
  const edgeHash = edges.map((e) => `${e.id}:${e.source}:${e.target}:${e.type}`).join('|');
  return `${nodeHash.length}_${edgeHash.length}`;
}

export class DiagramCache {
  private cache: Map<string, LayeredDiagram> = new Map();
  private maxEntries: number;

  constructor(maxEntries = 10) {
    this.maxEntries = maxEntries;
  }

  get(viewMode: ViewMode, dataHash: string): LayeredDiagram | null {
    const key = `${viewMode}:${dataHash}`;
    return this.cache.get(key) ?? null;
  }

  set(viewMode: ViewMode, dataHash: string, diagram: LayeredDiagram): void {
    const key = `${viewMode}:${dataHash}`;
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, diagram);
  }

  invalidate(viewMode?: ViewMode): void {
    if (viewMode) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(viewMode)) this.cache.delete(key);
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
    nodesHash: string,
    edgesHash: string,
    level: ClusterLevel,
    expandedKey: string,
  ): ClusterResult | null {
    const key = `${nodesHash}:${edgesHash}:${level}:${expandedKey}`;
    return this.cache.get(key) ?? null;
  }

  set(
    nodesHash: string,
    edgesHash: string,
    level: ClusterLevel,
    expandedKey: string,
    result: ClusterResult,
  ): void {
    const key = `${nodesHash}:${edgesHash}:${level}:${expandedKey}`;
    if (this.cache.size >= this.maxEntries) {
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