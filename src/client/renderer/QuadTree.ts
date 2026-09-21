import type { Core } from 'cytoscape';
import { QUADTREE } from '../../shared/constants.ts';

interface Bounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface QuadEntry {
  id: string;
  x: number;
  y: number;
}

class QuadNode {
  bounds: Bounds;
  depth: number;
  maxNodesPerQuad: number;
  maxDepth: number;
  entries: QuadEntry[] = [];
  children: QuadNode[] | null = null;

  constructor(bounds: Bounds, depth: number, maxNodesPerQuad: number, maxDepth: number) {
    this.bounds = bounds;
    this.depth = depth;
    this.maxNodesPerQuad = maxNodesPerQuad;
    this.maxDepth = maxDepth;
  }

  isLeaf(): boolean {
    return this.children === null;
  }

  shouldSubdivide(): boolean {
    return this.entries.length > this.maxNodesPerQuad && this.depth < this.maxDepth && this.isLeaf();
  }

  subdivide(): void {
    const { x1, y1, x2, y2 } = this.bounds;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    this.children = [
      new QuadNode({ x1, y1, x2: midX, y2: midY }, this.depth + 1, this.maxNodesPerQuad, this.maxDepth),
      new QuadNode({ x1: midX, y1, x2, y2: midY }, this.depth + 1, this.maxNodesPerQuad, this.maxDepth),
      new QuadNode({ x1, y1: midY, x2: midX, y2 }, this.depth + 1, this.maxNodesPerQuad, this.maxDepth),
      new QuadNode({ x1: midX, y1: midY, x2, y2 }, this.depth + 1, this.maxNodesPerQuad, this.maxDepth),
    ];
    const oldEntries = this.entries;
    this.entries = [];
    for (const entry of oldEntries) {
      this.insertIntoChild(entry);
    }
  }

  private getQuadrant(x: number, y: number): number {
    const midX = (this.bounds.x1 + this.bounds.x2) / 2;
    const midY = (this.bounds.y1 + this.bounds.y2) / 2;
    if (x < midX && y < midY) return 0;
    if (x >= midX && y < midY) return 1;
    if (x < midX && y >= midY) return 2;
    return 3;
  }

  insertIntoChild(entry: QuadEntry): void {
    if (!this.children) return;
    const idx = this.getQuadrant(entry.x, entry.y);
    this.children[idx]!.insert(entry);
  }

  insert(entry: QuadEntry): void {
    if (!this.isLeaf()) {
      this.insertIntoChild(entry);
      return;
    }
    this.entries.push(entry);
    if (this.shouldSubdivide()) {
      this.subdivide();
    }
  }

  remove(id: string): QuadEntry | null {
    if (!this.isLeaf()) {
      for (const child of this.children!) {
        const removed = child.remove(id);
        if (removed) return removed;
      }
      return null;
    }
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    const removed = this.entries[idx]!;
    this.entries.splice(idx, 1);
    return removed;
  }

  query(bounds: Bounds, result: Set<string>): void {
    if (this.isLeaf()) {
      for (const entry of this.entries) {
        if (entry.x >= bounds.x1 && entry.x <= bounds.x2 &&
            entry.y >= bounds.y1 && entry.y <= bounds.y2) {
          result.add(entry.id);
        }
      }
      return;
    }
    for (const child of this.children!) {
      if (child.bounds.x2 < bounds.x1 || child.bounds.x1 > bounds.x2 ||
          child.bounds.y2 < bounds.y1 || child.bounds.y1 > bounds.y2) {
        continue;
      }
      child.query(bounds, result);
    }
  }

  countLeaves(): number {
    if (this.isLeaf()) return 1;
    let count = 0;
    for (const child of this.children!) count += child.countLeaves();
    return count;
  }

  countEntries(): number {
    if (this.isLeaf()) return this.entries.length;
    let count = 0;
    for (const child of this.children!) count += child.countEntries();
    return count;
  }
}

export class QuadTree {
  private root: QuadNode;
  private nodePositions: Map<string, { x: number; y: number }> = new Map();
  private cy: Core;
  private maxNodesPerQuad: number;
  private maxDepth: number;

  constructor(cy: Core, maxNodesPerQuad: number = QUADTREE.MAX_NODES_PER_QUAD, maxDepth: number = QUADTREE.MAX_DEPTH) {
    this.cy = cy;
    this.maxNodesPerQuad = maxNodesPerQuad;
    this.maxDepth = maxDepth;
    this.root = new QuadNode({ ...QUADTREE.INITIAL_BOUNDS }, 0, this.maxNodesPerQuad, this.maxDepth);
  }

  insert(nodeId: string, x: number, y: number): void {
    this.nodePositions.set(nodeId, { x, y });
    this.root.insert({ id: nodeId, x, y });
  }

  remove(nodeId: string): void {
    const pos = this.nodePositions.get(nodeId);
    if (!pos) return;
    this.nodePositions.delete(nodeId);
    this.root.remove(nodeId);
  }

  update(nodeId: string, newX: number, newY: number): void {
    this.remove(nodeId);
    this.insert(nodeId, newX, newY);
  }

  query(bounds: Bounds): Set<string> {
    const result = new Set<string>();
    this.root.query(bounds, result);
    return result;
  }

  rebuildFromCytoscape(): void {
    this.root = new QuadNode({ ...QUADTREE.INITIAL_BOUNDS }, 0, this.maxNodesPerQuad, this.maxDepth);
    this.nodePositions.clear();
    this.cy.nodes().forEach((node) => {
      const p = node.position();
      this.insert(node.id(), p.x, p.y);
    });
  }

  getCellCount(): number {
    return this.root.countLeaves();
  }

  getNodeCount(): number {
    return this.nodePositions.size;
  }

  clear(): void {
    this.root = new QuadNode({ ...QUADTREE.INITIAL_BOUNDS }, 0, this.maxNodesPerQuad, this.maxDepth);
    this.nodePositions.clear();
  }
}
