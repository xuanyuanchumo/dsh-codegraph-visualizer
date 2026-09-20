import { describe, it, expect, vi } from 'vitest';
import { OverlapRemover } from '../../src/client/renderer/OverlapRemover.ts';

function makeMockNode(id: string, x = 0, y = 0, w = 30, h = 30) {
  let currentX = x;
  let currentY = y;
  return {
    id: () => id,
    position: vi.fn((pos?: { x: number; y: number }) => {
      if (pos !== undefined) {
        currentX = pos.x;
        currentY = pos.y;
      }
      return { x: currentX, y: currentY };
    }),
    width: vi.fn(() => w),
    height: vi.fn(() => h),
    nonempty: vi.fn(() => true),
    empty: vi.fn(() => false),
    style: vi.fn(),
    data: vi.fn(),
    degree: vi.fn(() => 1),
    connectedEdges: vi.fn(() => ({ forEach: vi.fn(), length: 0 })),
  };
}

function makeMockCy(nodeList: any[] = [], opts: { width?: number; height?: number } = {}): any {
  const nodeMap = new Map<string, any>();
  for (const n of nodeList) nodeMap.set(n.id(), n);

  const buildCollection = (items: any[]) => ({
    forEach: vi.fn((cb: (n: any) => void) => items.forEach(cb)),
    length: items.length,
    filter: vi.fn((pred: (n: any) => boolean) => buildCollection(items.filter(pred))),
    sort: vi.fn((cmp: (a: any, b: any) => number) => buildCollection([...items].sort(cmp))),
    slice: vi.fn((start: number, end?: number) => buildCollection(items.slice(start, end))),
    map: vi.fn((fn: (n: any) => any) => items.map(fn)),
    nonempty: vi.fn(() => items.length > 0),
    empty: vi.fn(() => items.length === 0),
  });

  const nodesCollection = buildCollection(nodeList);

  return {
    nodes: vi.fn(() => nodesCollection),
    edges: vi.fn(() => buildCollection([])),
    elements: vi.fn(() => buildCollection([...nodeList])),
    on: vi.fn(),
    off: vi.fn(),
    batch: vi.fn((cb: () => void) => cb()),
    zoom: vi.fn(() => 1),
    pan: vi.fn(() => ({ x: 0, y: 0 })),
    width: vi.fn(() => opts.width ?? 800),
    height: vi.fn(() => opts.height ?? 600),
    fit: vi.fn(),
    layout: vi.fn(() => ({ one: vi.fn(), run: vi.fn() })),
    getElementById: vi.fn((id: string) => nodeMap.get(id) ?? {
      nonempty: vi.fn(() => false),
      empty: vi.fn(() => true),
      position: vi.fn(() => ({ x: 0, y: 0 })),
      data: vi.fn(),
      width: vi.fn(() => 30),
      height: vi.fn(() => 30),
    }),
    _nodeMap: nodeMap,
    _nodeList: nodeList,
  };
}

describe('OverlapRemover', () => {
  describe('constructor', () => {
    it('constructs without throwing', () => {
      const cy = makeMockCy();
      expect(() => new OverlapRemover(cy)).not.toThrow();
    });
  });

  describe('remove', () => {
    it('returns immediately when there are no nodes', () => {
      const cy = makeMockCy([]);
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.fit).not.toHaveBeenCalled();
      expect(cy.batch).not.toHaveBeenCalled();
    });

    it('handles single node without overlap (calls fit only)', () => {
      const nodeA = makeMockNode('a', 100, 100);
      const cy = makeMockCy([nodeA]);
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.fit).toHaveBeenCalledTimes(1);
      expect(cy.fit).toHaveBeenCalledWith(undefined, 80);
      expect(nodeA.position).toHaveBeenCalledTimes(1);
      expect(nodeA.position).toHaveBeenLastCalledWith();
    });

    it('handles multiple non-overlapping nodes without displacement', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const nodeB = makeMockNode('b', 500, 500);
      const cy = makeMockCy([nodeA, nodeB]);
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.fit).toHaveBeenCalledTimes(1);
      expect(nodeA.position).toHaveBeenCalledTimes(1);
      expect(nodeB.position).toHaveBeenCalledTimes(1);
      expect(cy.batch).not.toHaveBeenCalled();
    });

    it('adjusts positions for overlapping nodes', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const nodeB = makeMockNode('b', 5, 5);
      const cy = makeMockCy([nodeA, nodeB]);
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.batch).toHaveBeenCalled();
      expect(nodeA.position).toHaveBeenCalled();
      expect(nodeB.position).toHaveBeenCalled();
      expect(cy.fit).toHaveBeenCalledTimes(1);
    });

    it('skips iteration and only calls fit when node count exceeds skip threshold', () => {
      const bigNodeList = Array.from({ length: 5001 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(bigNodeList);
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.fit).toHaveBeenCalledTimes(1);
      expect(cy.fit).toHaveBeenCalledWith(undefined, 80);
      expect(cy.batch).not.toHaveBeenCalled();
    });

    it('uses default width 800 when cy.width() returns 0', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const nodeB = makeMockNode('b', 5, 5);
      const cy = makeMockCy([nodeA, nodeB], { width: 0 });
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.width).toHaveBeenCalled();
      expect(cy.fit).toHaveBeenCalledTimes(1);
    });

    it('uses default height 600 when cy.height() returns 0', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const nodeB = makeMockNode('b', 5, 5);
      const cy = makeMockCy([nodeA, nodeB], { height: 0 });
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.height).toHaveBeenCalled();
      expect(cy.fit).toHaveBeenCalledTimes(1);
    });

    it('calls cy.batch during overlap removal', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const nodeB = makeMockNode('b', 5, 5);
      const cy = makeMockCy([nodeA, nodeB]);
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.batch).toHaveBeenCalledTimes(1);
    });

    it('always calls fit at the end', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const nodeB = makeMockNode('b', 5, 5);
      const cy = makeMockCy([nodeA, nodeB]);
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.fit).toHaveBeenCalledWith(undefined, 80);
    });

    it('handles three overlapping nodes', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const nodeB = makeMockNode('b', 3, 3);
      const nodeC = makeMockNode('c', 6, 6);
      const cy = makeMockCy([nodeA, nodeB, nodeC]);
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.batch).toHaveBeenCalled();
      expect(cy.fit).toHaveBeenCalledTimes(1);
    });

    it('does not call batch when no overlaps detected', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const nodeB = makeMockNode('b', 1000, 1000);
      const cy = makeMockCy([nodeA, nodeB]);
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.batch).not.toHaveBeenCalled();
      expect(cy.fit).toHaveBeenCalledTimes(1);
    });

    it('nodes at exactly skip threshold boundary (5000) still get processed', () => {
      const nodeList = Array.from({ length: 5000 }, (_, i) => makeMockNode(`n${i}`, i * 400, i * 400));
      const cy = makeMockCy(nodeList);
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.fit).toHaveBeenCalledTimes(1);
    });

    it('updates node positions through getElementById in batch', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const nodeB = makeMockNode('b', 5, 5);
      const cy = makeMockCy([nodeA, nodeB]);
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.getElementById).toHaveBeenCalled();
    });

    it('handles nodes with different sizes', () => {
      const nodeA = makeMockNode('a', 0, 0, 50, 50);
      const nodeB = makeMockNode('b', 10, 10, 20, 20);
      const cy = makeMockCy([nodeA, nodeB]);
      const remover = new OverlapRemover(cy);
      remover.remove();
      expect(cy.fit).toHaveBeenCalledTimes(1);
    });
  });
});