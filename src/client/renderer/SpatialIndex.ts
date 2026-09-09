import type { Core } from 'cytoscape';

interface Bounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export class SpatialIndex {
  private cellSize: number;
  private grid: Map<string, Set<string>> = new Map();
  private nodePositions: Map<string, { x: number; y: number }> = new Map();
  private cy: Core;

  constructor(cy: Core, cellSize = 200) {
    this.cy = cy;
    this.cellSize = cellSize;
  }

  private cellKey(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  insert(nodeId: string, x: number, y: number): void {
    this.nodePositions.set(nodeId, { x, y });
    const key = this.cellKey(x, y);
    let bucket = this.grid.get(key);
    if (!bucket) {
      bucket = new Set();
      this.grid.set(key, bucket);
    }
    bucket.add(nodeId);
  }

  remove(nodeId: string): void {
    const pos = this.nodePositions.get(nodeId);
    if (!pos) return;
    this.nodePositions.delete(nodeId);
    const key = this.cellKey(pos.x, pos.y);
    const bucket = this.grid.get(key);
    if (bucket) {
      bucket.delete(nodeId);
      if (bucket.size === 0) this.grid.delete(key);
    }
  }

  update(nodeId: string, newX: number, newY: number): void {
    this.remove(nodeId);
    this.insert(nodeId, newX, newY);
  }

  query(bounds: Bounds): Set<string> {
    const result = new Set<string>();
    const minX = Math.floor(bounds.x1 / this.cellSize);
    const maxX = Math.floor(bounds.x2 / this.cellSize);
    const minY = Math.floor(bounds.y1 / this.cellSize);
    const maxY = Math.floor(bounds.y2 / this.cellSize);

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const bucket = this.grid.get(`${cx},${cy}`);
        if (bucket) {
          for (const id of bucket) result.add(id);
        }
      }
    }
    return result;
  }

  rebuildFromCytoscape(): void {
    this.grid.clear();
    this.nodePositions.clear();
    this.cy.nodes().forEach((node) => {
      const p = node.position();
      this.insert(node.id(), p.x, p.y);
    });
  }

  getCellCount(): number {
    return this.grid.size;
  }

  getNodeCount(): number {
    return this.nodePositions.size;
  }

  clear(): void {
    this.grid.clear();
    this.nodePositions.clear();
  }
}