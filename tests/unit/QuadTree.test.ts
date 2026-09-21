import { describe, it, expect } from 'vitest';
import { QuadTree } from '../../src/client/renderer/QuadTree.ts';

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

describe('QuadTree', () => {
  it('inserts nodes correctly', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('a', 50, 50);
    tree.insert('b', 150, 50);
    tree.insert('c', 50, 150);

    expect(tree.getNodeCount()).toBe(3);
    expect(tree.getCellCount()).toBeGreaterThanOrEqual(1);
  });

  it('auto-subdivides when capacity exceeded', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 3, 8);
    tree.insert('a', 10, 10);
    tree.insert('b', 20, 20);
    tree.insert('c', 30, 30);
    tree.insert('d', 400, 400);

    expect(tree.getNodeCount()).toBe(4);
    expect(tree.getCellCount()).toBeGreaterThan(1);
  });

  it('respects max depth limit', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 1, 2);
    tree.insert('a', 1, 1);
    tree.insert('b', 2, 2);
    tree.insert('c', 3, 3);
    tree.insert('d', 4, 4);

    expect(tree.getNodeCount()).toBe(4);
  });

  it('removes nodes correctly', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('a', 50, 50);
    tree.insert('b', 150, 50);

    tree.remove('a');
    expect(tree.getNodeCount()).toBe(1);

    tree.remove('b');
    expect(tree.getNodeCount()).toBe(0);
  });

  it('removes non-existent node gracefully', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.remove('nonexistent');
    expect(tree.getNodeCount()).toBe(0);
  });

  it('updates node position', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('a', 50, 50);

    tree.update('a', 250, 250);
    expect(tree.getNodeCount()).toBe(1);

    const result = tree.query({ x1: 200, y1: 200, x2: 300, y2: 300 });
    expect(result.has('a')).toBe(true);
  });

  it('queries nodes within bounds', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('a', 50, 50);
    tree.insert('b', 150, 150);
    tree.insert('c', 250, 50);
    tree.insert('d', 350, 350);

    const result = tree.query({ x1: 0, y1: 0, x2: 199, y2: 199 });
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(false);
    expect(result.has('d')).toBe(false);
  });

  it('queries across multiple quadrants', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('a', 50, 50);
    tree.insert('b', 150, 50);
    tree.insert('c', 250, 50);

    const result = tree.query({ x1: 0, y1: 0, x2: 300, y2: 100 });
    expect(result.size).toBe(3);
  });

  it('queries empty bounds', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('a', 50, 50);

    const result = tree.query({ x1: 500, y1: 500, x2: 600, y2: 600 });
    expect(result.size).toBe(0);
  });

  it('rebuilds from cytoscape', () => {
    const cy = makeMockCy([
      { id: 'a', x: 50, y: 50 },
      { id: 'b', x: 150, y: 150 },
      { id: 'c', x: 250, y: 250 },
    ]);
    const tree = new QuadTree(cy, 10, 8);

    tree.rebuildFromCytoscape();
    expect(tree.getNodeCount()).toBe(3);

    const result = tree.query({ x1: 0, y1: 0, x2: 100, y2: 100 });
    expect(result.has('a')).toBe(true);
  });

  it('clears all data', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('a', 50, 50);
    tree.insert('b', 150, 150);

    tree.clear();
    expect(tree.getNodeCount()).toBe(0);
    expect(tree.getCellCount()).toBe(1);
  });

  it('handles negative coordinates', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('a', -50, -50);
    tree.insert('b', -150, -150);

    expect(tree.getNodeCount()).toBe(2);
    const result = tree.query({ x1: -200, y1: -200, x2: 0, y2: 0 });
    expect(result.size).toBe(2);
  });

  it('handles dense cluster of nodes', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 5, 6);
    for (let i = 0; i < 100; i++) {
      tree.insert(`n${i}`, 100 + i * 0.1, 100 + i * 0.1);
    }

    expect(tree.getNodeCount()).toBe(100);
    const result = tree.query({ x1: 90, y1: 90, x2: 120, y2: 120 });
    expect(result.size).toBe(100);
  });

  it('efficiently queries sparse distribution', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 5, 8);
    tree.insert('a', 0, 0);
    tree.insert('b', 50000, 50000);
    tree.insert('c', -50000, -50000);

    const result = tree.query({ x1: -10, y1: -10, x2: 10, y2: 10 });
    expect(result.size).toBe(1);
    expect(result.has('a')).toBe(true);
  });
});