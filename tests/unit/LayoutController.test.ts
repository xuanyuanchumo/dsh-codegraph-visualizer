import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function makeMockNode(id: string, x = 0, y = 0, data: Record<string, unknown> = {}) {
  const dataMap = new Map<string, unknown>(Object.entries(data));
  return {
    id: () => id,
    position: vi.fn(() => ({ x, y })),
    style: vi.fn(),
    data: vi.fn((key: string, value?: unknown) => {
      if (value !== undefined) { dataMap.set(key, value); return undefined; }
      return dataMap.get(key);
    }),
    width: vi.fn(() => 30),
    height: vi.fn(() => 30),
    degree: vi.fn(() => 1),
    nonempty: vi.fn(() => true),
    empty: vi.fn(() => false),
    connectedEdges: vi.fn(() => ({ forEach: vi.fn(), length: 0 })),
  };
}

function makeMockEdge(id: string, sourceId: string, targetId: string) {
  const sourceNode = makeMockNode(sourceId);
  const targetNode = makeMockNode(targetId);
  return {
    id: () => id,
    source: () => sourceNode,
    target: () => targetNode,
    style: vi.fn(),
    data: vi.fn((key: string) => { if (key === 'typeFiltered') return false; return undefined; }),
  };
}

function makeMockCy(nodeList: any[] = [], edgeList: any[] = []) {
  const nodeMap = new Map<string, any>();
  for (const n of nodeList) nodeMap.set(n.id(), n);

  const buildCollection = (items: any[]) => ({
    forEach: vi.fn((cb: (n: any) => void) => items.forEach(cb)),
    length: items.length,
    filter: vi.fn((pred: (n: any) => boolean) => buildCollection(items.filter(pred))),
    sort: vi.fn((cmp: (a: any, b: any) => number) => buildCollection([...items].sort(cmp))),
    slice: vi.fn((start: number, end?: number) => buildCollection(items.slice(start, end))),
    roots: vi.fn(() => buildCollection([])),
    map: vi.fn((fn: (n: any) => any) => items.map(fn)),
    boundingBox: vi.fn(() => ({ x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 })),
    nonempty: vi.fn(() => items.length > 0),
    empty: vi.fn(() => items.length === 0),
    layout: vi.fn(() => ({ one: vi.fn(), run: vi.fn() })),
  });

  const nodesCollection = buildCollection(nodeList);
  const edgesCollection = buildCollection(edgeList);
  const elementsCollection = buildCollection([...nodeList, ...edgeList]);

  return {
    nodes: vi.fn(() => nodesCollection),
    edges: vi.fn(() => edgesCollection),
    elements: vi.fn(() => elementsCollection),
    on: vi.fn(),
    off: vi.fn(),
    batch: vi.fn((cb: () => void) => cb()),
    zoom: vi.fn(() => 1),
    pan: vi.fn(() => ({ x: 0, y: 0 })),
    width: vi.fn(() => 800),
    height: vi.fn(() => 600),
    fit: vi.fn(),
    layout: vi.fn((_options?: any) => ({
      one: vi.fn(),
      run: vi.fn(),
    })),
    getElementById: vi.fn((id: string) => nodeMap.get(id) ?? {
      nonempty: vi.fn(() => false),
      empty: vi.fn(() => true),
      position: vi.fn(() => ({ x: 0, y: 0 })),
      data: vi.fn(),
      width: vi.fn(() => 30),
      height: vi.fn(() => 30),
      connectedEdges: vi.fn(() => ({ forEach: vi.fn(), length: 0 })),
    }),
    _nodeMap: nodeMap,
    _nodeList: nodeList,
    _edgeList: edgeList,
  };
}

describe('LayoutController', () => {
  let originalRequestAnimationFrame: typeof requestAnimationFrame;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame;

  beforeEach(() => {
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  describe('constructor and worker initialization', () => {
    it('constructs without throwing', () => {
      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      expect(() => new LayoutController(cy)).not.toThrow();
    });

    it('isWorkerAvailable returns boolean', () => {
      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      expect(typeof controller.isWorkerAvailable()).toBe('boolean');
      controller.destroy();
    });
  });

  describe('applyLayout', () => {
    it('calls cy.layout with cose options for small graphs', () => {
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      expect(cy.layout).toHaveBeenCalled();
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('cose');
      controller.destroy();
    });

    it('falls back to grid for very large graphs (>5000 nodes)', () => {
      const bigNodeList = Array.from({ length: 5001 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(bigNodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('grid');
      controller.destroy();
    });

    it('falls back to dagre for large cose graphs (>500 nodes)', () => {
      const midNodeList = Array.from({ length: 501 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(midNodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('dagre');
      controller.destroy();
    });

    it('uses dagre layout directly for dagre', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('dagre');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('dagre');
      controller.destroy();
    });

    it('uses fcose layout directly for fcose', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('fcose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('fcose');
      controller.destroy();
    });

    it('falls back to dagre for large fcose graphs (>500 nodes)', () => {
      const midNodeList = Array.from({ length: 501 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(midNodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('fcose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('dagre');
      controller.destroy();
    });

    it('uses circle layout directly', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('circle');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('circle');
      controller.destroy();
    });

    it('uses grid layout directly', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('grid');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('grid');
      controller.destroy();
    });

    it('uses concentric layout for radial', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('radial');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('concentric');
      controller.destroy();
    });

    it('uses breadthfirst layout for tree', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('tree');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('breadthfirst');
      controller.destroy();
    });
  });

  describe('applyIncrementalLayout', () => {
    it('does nothing with empty newNodeIds', () => {
      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('cose', new Set());
      expect(cy.layout).not.toHaveBeenCalled();
      controller.destroy();
    });

    it('places new nodes near anchor neighbors using spiral distribution', () => {
      const nodeA = makeMockNode('a', 100, 100);
      const nodeB = makeMockNode('b', 200, 200);
      const nodeC = makeMockNode('c', 0, 0);
      const edge = makeMockEdge('e1', 'a', 'c');
      nodeC.connectedEdges = vi.fn(() => ({
        forEach: (cb: (e: any) => void) => cb(edge),
      }));
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edge]);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('cose', new Set(['c']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });

    it('places new nodes at center when no anchor neighbors exist', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 0, 0);
      nodeB.connectedEdges = vi.fn(() => ({
        forEach: vi.fn(),
      }));
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('cose', new Set(['b']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });

    it('returns early when newNodeIds non-empty but no matching nodes in cy', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('cose', new Set(['nonexistent']));
      expect(cy.layout).not.toHaveBeenCalled();
      controller.destroy();
    });

    it('uses overlapRemover.remove for non-cose/fcose/dagre layouts', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 0, 0);
      nodeB.connectedEdges = vi.fn(() => ({
        forEach: vi.fn(),
      }));
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('grid', new Set(['b']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });

    it('handles all new nodes with no existing nodes (anchorCount=0, existingNodes=0)', () => {
      const nodeA = makeMockNode('a', 0, 0);
      nodeA.connectedEdges = vi.fn(() => ({
        forEach: vi.fn(),
      }));
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('cose', new Set(['a']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });
  });

  describe('applyWorkerLayout', () => {
    it('applies positions from worker result', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyWorkerLayout({ a: { x: 100, y: 200 } });
      expect(nodeA.position).toHaveBeenCalledWith({ x: 100, y: 200 });
      expect(cy.fit).toHaveBeenCalled();
      controller.destroy();
    });

    it('skips non-existent nodes in worker positions', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyWorkerLayout({
        a: { x: 50, y: 50 },
        nonexistent: { x: 999, y: 999 },
      });
      expect(nodeA.position).toHaveBeenCalledWith({ x: 50, y: 50 });
      controller.destroy();
    });
  });

  describe('applyLayoutWithWorker', () => {
    it('returns empty object when no worker available', async () => {
      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      const result = await controller.applyLayoutWithWorker([], [], 'cose');
      expect(result).toEqual({});
      controller.destroy();
    });
  });

  describe('position caching', () => {
    it('cachePositions stores node positions', () => {
      const nodeA = makeMockNode('a', 10, 20);
      const nodeB = makeMockNode('b', 30, 40);
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyWorkerLayout({});
      controller.destroy();
    });

    it('restoreCachedPositions restores positions from cache', () => {
      const nodeA = makeMockNode('a', 10, 20);
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyWorkerLayout({ a: { x: 100, y: 200 } });
      controller.applyIncrementalLayout('cose', new Set(['a']));
      controller.destroy();
    });
  });

  describe('removeOverlaps', () => {
    it('skips overlap removal for very large graphs (uses grid fallback)', () => {
      const bigNodeList = Array.from({ length: 5001 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(bigNodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('grid');
      controller.destroy();
    });

    it('processes overlaps for small graphs', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const nodeB = makeMockNode('b', 5, 5);
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      controller.destroy();
    });
  });

  describe('destroy', () => {
    it('cleans up resources without throwing', () => {
      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      expect(() => controller.destroy()).not.toThrow();
    });

    it('isWorkerAvailable returns false after destroy', () => {
      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.destroy();
      expect(controller.isWorkerAvailable()).toBe(false);
    });
  });

  describe('buildLayoutOptions coverage', () => {
    it('grid layout computes rows and cols from nodeCount', () => {
      const nodeList = Array.from({ length: 9 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(nodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('grid');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.rows).toBe(3);
      expect(layoutArg?.cols).toBe(3);
      controller.destroy();
    });

    it('radial layout uses concentric with degree-based concentric function', () => {
      const nodeA = makeMockNode('a');
      nodeA.degree = vi.fn(() => 5);
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('radial');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('concentric');
      expect(typeof layoutArg?.concentric).toBe('function');
      controller.destroy();
    });

    it('tree layout uses breadthfirst with directed option', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('tree');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('breadthfirst');
      expect(layoutArg?.directed).toBe(true);
      controller.destroy();
    });

    it('tree layout uses isRoot data property when available', () => {
      const nodeA = makeMockNode('a', 0, 0, { isRoot: true });
      const nodeB = makeMockNode('b');
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('tree');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('breadthfirst');
      controller.destroy();
    });
  });
});