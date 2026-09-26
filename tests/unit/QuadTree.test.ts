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

  it('expands bounds when node is outside initial bounds', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('far', 200000, 200000);
    expect(tree.getNodeCount()).toBe(1);
    const result = tree.query({ x1: 190000, y1: 190000, x2: 210000, y2: 210000 });
    expect(result.has('far')).toBe(true);
  });

  it('expands bounds for negative coordinates beyond initial bounds', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('neg', -200000, -200000);
    expect(tree.getNodeCount()).toBe(1);
    const result = tree.query({ x1: -210000, y1: -210000, x2: -190000, y2: -190000 });
    expect(result.has('neg')).toBe(true);
  });

  it('preserves existing nodes when bounds expand', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('inner', 50, 50);
    tree.insert('outer', 200000, 200000);
    expect(tree.getNodeCount()).toBe(2);
    const innerResult = tree.query({ x1: 0, y1: 0, x2: 100, y2: 100 });
    expect(innerResult.has('inner')).toBe(true);
    const outerResult = tree.query({ x1: 190000, y1: 190000, x2: 210000, y2: 210000 });
    expect(outerResult.has('outer')).toBe(true);
  });

  it('update triggers bounds expansion when new position is outside', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('a', 50, 50);
    tree.update('a', 200000, 200000);
    expect(tree.getNodeCount()).toBe(1);
    const result = tree.query({ x1: 190000, y1: 190000, x2: 210000, y2: 210000 });
    expect(result.has('a')).toBe(true);
  });

  it('removes node from subdivided tree correctly', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 2, 8);
    tree.insert('a', 10, 10);
    tree.insert('b', 20, 20);
    tree.insert('c', 300, 300);
    tree.remove('c');
    expect(tree.getNodeCount()).toBe(2);
    const result = tree.query({ x1: 0, y1: 0, x2: 100, y2: 100 });
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(false);
  });

  it('remove returns null for non-existent id in subdivided tree', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 2, 8);
    tree.insert('a', 10, 10);
    tree.insert('b', 20, 20);
    tree.insert('c', 300, 300);
    tree.remove('nonexistent');
    expect(tree.getNodeCount()).toBe(3);
  });

  it('query skips non-intersecting child quadrants', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 2, 8);
    tree.insert('a', 10, 10);
    tree.insert('b', 50000, 50000);
    tree.insert('c', -50000, -50000);
    tree.insert('d', 50000, -50000);
    const result = tree.query({ x1: 0, y1: 0, x2: 20, y2: 20 });
    expect(result.size).toBe(1);
    expect(result.has('a')).toBe(true);
  });

  it('rebuildFromCytoscape clears existing data and reinserts', () => {
    const cy = makeMockCy([
      { id: 'a', x: 50, y: 50 },
      { id: 'b', x: 150, y: 150 },
      { id: 'c', x: 250, y: 250 },
    ]);
    const tree = new QuadTree(cy, 10, 8);
    tree.insert('old', 999, 999);
    expect(tree.getNodeCount()).toBe(1);
    tree.rebuildFromCytoscape();
    expect(tree.getNodeCount()).toBe(3);
    const oldResult = tree.query({ x1: 900, y1: 900, x2: 1100, y2: 1100 });
    expect(oldResult.has('old')).toBe(false);
  });

  it('handles repeated insertions and removals without corruption', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 3, 4);
    for (let i = 0; i < 20; i++) {
      tree.insert(`n${i}`, i * 10, i * 10);
    }
    expect(tree.getNodeCount()).toBe(20);
    for (let i = 0; i < 10; i++) {
      tree.remove(`n${i}`);
    }
    expect(tree.getNodeCount()).toBe(10);
    const result = tree.query({ x1: 100, y1: 100, x2: 200, y2: 200 });
    expect(result.size).toBeGreaterThan(0);
  });

  it('query with bounds matching exactly one quadrant boundary', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 2, 8);
    tree.insert('a', 0, 0);
    tree.insert('b', 100000, 100000);
    const midResult = tree.query({ x1: 0, y1: 0, x2: 0, y2: 0 });
    expect(midResult.has('a')).toBe(true);
  });

  it('handles insert at exact boundary midpoints', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 1, 4);
    tree.insert('a', 0, 0);
    tree.insert('b', 1, 1);
    tree.insert('c', -1, -1);
    expect(tree.getNodeCount()).toBe(3);
  });

  it('countEntries returns total entries in subdivided tree', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 2, 8);
    tree.insert('a', 10, 10);
    tree.insert('b', 20, 20);
    tree.insert('c', 300, 300);
    tree.insert('d', 400, 400);
    expect(tree.getNodeCount()).toBe(4);
  });

  it('countEntries returns 0 for empty tree', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 10, 8);
    expect(tree.getNodeCount()).toBe(0);
  });

  it('countEntries after removals in subdivided tree', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 2, 8);
    tree.insert('a', 10, 10);
    tree.insert('b', 20, 20);
    tree.insert('c', 300, 300);
    tree.insert('d', 400, 400);
    tree.remove('a');
    tree.remove('c');
    expect(tree.getNodeCount()).toBe(2);
  });

  it('getCellCount reflects subdivision structure', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 2, 8);
    tree.insert('a', 10, 10);
    tree.insert('b', 20, 20);
    tree.insert('c', 300, 300);
    expect(tree.getCellCount()).toBeGreaterThan(1);
  });

  it('query returns correct results after subdivide and remove', () => {
    const cy = makeMockCy([]);
    const tree = new QuadTree(cy, 2, 8);
    tree.insert('a', 10, 10);
    tree.insert('b', 20, 20);
    tree.insert('c', 300, 300);
    tree.insert('d', 400, 400);
    tree.remove('c');
    const result = tree.query({ x1: 0, y1: 0, x2: 50, y2: 50 });
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(false);
    expect(result.has('d')).toBe(false);
  });
});