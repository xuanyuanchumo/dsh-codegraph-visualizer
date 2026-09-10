import { describe, it, expect, vi } from 'vitest';
import { SpatialIndex } from '../../src/client/renderer/SpatialIndex.ts';

function makeMockNode(id: string, x: number, y: number) {
  return {
    id: () => id,
    position: () => ({ x, y }),
  };
}

function makeMockCy(nodes: Array<{ id: string; x: number; y: number }>) {
  return {
    nodes: () => ({
      forEach: (cb: (node: ReturnType<typeof makeMockNode>) => void) => {
        for (const n of nodes) cb(makeMockNode(n.id, n.x, n.y));
      },
    }),
  } as any;
}

describe('SpatialIndex', () => {
  it('inserts nodes into correct grid cells', () => {
    const cy = makeMockCy([]);
    const index = new SpatialIndex(cy, 100);
    index.insert('a', 50, 50);
    index.insert('b', 150, 50);
    index.insert('c', 50, 150);

    expect(index.getNodeCount()).toBe(3);
    expect(index.getCellCount()).toBe(3);
  });

  it('inserts multiple nodes into same cell', () => {
    const cy = makeMockCy([]);
    const index = new SpatialIndex(cy, 100);
    index.insert('a', 10, 10);
    index.insert('b', 20, 20);
    index.insert('c', 30, 30);

    expect(index.getNodeCount()).toBe(3);
    expect(index.getCellCount()).toBe(1);
  });

  it('removes nodes correctly', () => {
    const cy = makeMockCy([]);
    const index = new SpatialIndex(cy, 100);
    index.insert('a', 50, 50);
    index.insert('b', 150, 50);

    index.remove('a');
    expect(index.getNodeCount()).toBe(1);
    expect(index.getCellCount()).toBe(1);

    index.remove('b');
    expect(index.getNodeCount()).toBe(0);
    expect(index.getCellCount()).toBe(0);
  });

  it('removes non-existent node gracefully', () => {
    const cy = makeMockCy([]);
    const index = new SpatialIndex(cy, 100);
    index.remove('nonexistent');
    expect(index.getNodeCount()).toBe(0);
  });

  it('updates node position', () => {
    const cy = makeMockCy([]);
    const index = new SpatialIndex(cy, 100);
    index.insert('a', 50, 50);
    expect(index.getCellCount()).toBe(1);

    index.update('a', 250, 250);
    expect(index.getNodeCount()).toBe(1);
    expect(index.getCellCount()).toBe(1);

    const result = index.query({ x1: 200, y1: 200, x2: 300, y2: 300 });
    expect(result.has('a')).toBe(true);
  });

  it('queries nodes within bounds', () => {
    const cy = makeMockCy([]);
    const index = new SpatialIndex(cy, 100);
    index.insert('a', 50, 50);
    index.insert('b', 150, 150);
    index.insert('c', 250, 50);
    index.insert('d', 350, 350);

    const result = index.query({ x1: 0, y1: 0, x2: 199, y2: 199 });
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(false);
    expect(result.has('d')).toBe(false);
  });

  it('queries across multiple cells', () => {
    const cy = makeMockCy([]);
    const index = new SpatialIndex(cy, 100);
    index.insert('a', 50, 50);
    index.insert('b', 150, 50);
    index.insert('c', 250, 50);

    const result = index.query({ x1: 0, y1: 0, x2: 300, y2: 100 });
    expect(result.size).toBe(3);
  });

  it('queries empty bounds', () => {
    const cy = makeMockCy([]);
    const index = new SpatialIndex(cy, 100);
    index.insert('a', 50, 50);

    const result = index.query({ x1: 500, y1: 500, x2: 600, y2: 600 });
    expect(result.size).toBe(0);
  });

  it('rebuilds from cytoscape', () => {
    const cy = makeMockCy([
      { id: 'a', x: 50, y: 50 },
      { id: 'b', x: 150, y: 150 },
      { id: 'c', x: 250, y: 250 },
    ]);
    const index = new SpatialIndex(cy, 100);

    index.rebuildFromCytoscape();
    expect(index.getNodeCount()).toBe(3);
    expect(index.getCellCount()).toBe(3);

    const result = index.query({ x1: 0, y1: 0, x2: 100, y2: 100 });
    expect(result.has('a')).toBe(true);
  });

  it('clears all data', () => {
    const cy = makeMockCy([]);
    const index = new SpatialIndex(cy, 100);
    index.insert('a', 50, 50);
    index.insert('b', 150, 150);

    index.clear();
    expect(index.getNodeCount()).toBe(0);
    expect(index.getCellCount()).toBe(0);
  });

  it('handles negative coordinates', () => {
    const cy = makeMockCy([]);
    const index = new SpatialIndex(cy, 100);
    index.insert('a', -50, -50);
    index.insert('b', -150, -150);

    expect(index.getNodeCount()).toBe(2);
    const result = index.query({ x1: -200, y1: -200, x2: 0, y2: 0 });
    expect(result.size).toBe(2);
  });

  it('handles custom cell size', () => {
    const cy = makeMockCy([]);
    const index = new SpatialIndex(cy, 500);
    index.insert('a', 100, 100);
    index.insert('b', 400, 400);

    expect(index.getCellCount()).toBe(1);

    const result = index.query({ x1: 0, y1: 0, x2: 500, y2: 500 });
    expect(result.size).toBe(2);
  });
});