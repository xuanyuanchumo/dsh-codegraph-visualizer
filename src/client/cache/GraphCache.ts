import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { LayoutType } from '../renderer/IRenderer.ts';

interface CacheEntry {
  nodes: GraphNode[];
  edges: GraphEdge[];
  repoId: string;
  timestamp: number;
  layoutPositions: Map<string, { x: number; y: number }> | null;
  layoutType: LayoutType | null;
}

export class GraphCache {
  private cache = new Map<string, CacheEntry>();
  private maxEntries = 5;

  get(repoId: string): CacheEntry | null {
    return this.cache.get(repoId) ?? null;
  }

  set(repoId: string, nodes: GraphNode[], edges: GraphEdge[], layoutPositions?: Map<string, { x: number; y: number }>, layoutType?: LayoutType): void {
    const existing = this.cache.get(repoId);
    this.cache.set(repoId, {
      nodes,
      edges,
      repoId,
      timestamp: Date.now(),
      layoutPositions: layoutPositions ?? existing?.layoutPositions ?? null,
      layoutType: layoutType ?? existing?.layoutType ?? null,
    });
    if (this.cache.size > this.maxEntries) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
  }

  getLayoutPositions(repoId: string): Map<string, { x: number; y: number }> | null {
    return this.cache.get(repoId)?.layoutPositions ?? null;
  }

  setLayoutPositions(repoId: string, positions: Map<string, { x: number; y: number }>, layoutType: LayoutType): void {
    const entry = this.cache.get(repoId);
    if (entry) {
      entry.layoutPositions = positions;
      entry.layoutType = layoutType;
    }
  }

  has(repoId: string): boolean {
    return this.cache.has(repoId);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
