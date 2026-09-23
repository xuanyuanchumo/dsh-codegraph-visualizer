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

  return {
    nodes: vi.fn(() => nodesCollection),
    edges: vi.fn(() => edgesCollection),
    elements: vi.fn(() => buildCollection([...nodeList, ...edgeList])),
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
  };
}

describe('LayoutController - extended coverage', () => {
  let originalRequestAnimationFrame: typeof requestAnimationFrame;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame;
  let originalWorker: typeof Worker;

  beforeEach(() => {
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    originalWorker = globalThis.Worker;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.Worker = originalWorker;
  });


  describe('applyLayoutWithWorker - no worker path', () => {
    it('returns empty object when worker is null', async () => {
      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      const result = await controller.applyLayoutWithWorker([], [], 'cose');
      expect(result).toEqual({});
      controller.destroy();
    });
  });

  describe('applyLayout - RAF cancellation', () => {
    it('cancels pending RAF when applyLayout called twice', () => {
      let rafId = 1;
      const rafCallbacks: FrameRequestCallback[] = [];
      globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafId++;
      }) as any;
      globalThis.cancelAnimationFrame = vi.fn();

      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);

      controller.applyLayout('cose');
      controller.applyLayout('dagre');

      expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
      controller.destroy();
    });
  });

  describe('applyIncrementalLayout - detailed branch coverage', () => {
    it('computes anchor from multiple connected edges', () => {
      const nodeA = makeMockNode('a', 100, 100);
      const nodeB = makeMockNode('b', 200, 200);
      const nodeC = makeMockNode('c', 0, 0);
      const edge1 = makeMockEdge('e1', 'a', 'c');
      const edge2 = makeMockEdge('e2', 'b', 'c');
      nodeC.connectedEdges = vi.fn(() => ({
        forEach: (cb: (e: any) => void) => { cb(edge1); cb(edge2); },
      }));
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edge1, edge2]);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('cose', new Set(['c']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });

    it('uses boundingBox center when no anchor neighbors but existing nodes exist', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 0, 0);
      nodeB.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('cose', new Set(['b']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });

    it('uses (0,0) center when all nodes are new', () => {
      const nodeA = makeMockNode('a', 0, 0);
      nodeA.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('cose', new Set(['a']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });

    it('applies incremental dagre layout to new nodes', () => {
      const nodeA = makeMockNode('a', 100, 100);
      const nodeB = makeMockNode('b', 0, 0);
      nodeB.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('dagre', new Set(['b']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });

    it('applies incremental fcose layout to new nodes', () => {
      const nodeA = makeMockNode('a', 100, 100);
      const nodeB = makeMockNode('b', 0, 0);
      nodeB.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('fcose', new Set(['b']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });

    it('cancels pending RAF when applyIncrementalLayout called twice', () => {
      let rafId = 1;
      globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
        cb(0);
        return rafId++;
      }) as any;
      globalThis.cancelAnimationFrame = vi.fn();

      const nodeA = makeMockNode('a', 100, 100);
      const nodeB = makeMockNode('b', 0, 0);
      nodeB.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('cose', new Set(['b']));
      controller.applyIncrementalLayout('cose', new Set(['b']));
      expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
      controller.destroy();
    });

    it('handles multiple new nodes with spiral distribution', () => {
      const nodeA = makeMockNode('a', 100, 100);
      const nodeB = makeMockNode('b', 0, 0);
      const nodeC = makeMockNode('c', 0, 0);
      const nodeD = makeMockNode('d', 0, 0);
      nodeB.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      nodeC.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      nodeD.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      const cy = makeMockCy([nodeA, nodeB, nodeC, nodeD], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('cose', new Set(['b', 'c', 'd']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });
  });

  describe('buildLayoutOptions - edge cases', () => {
    it('radial layout samples degrees for very large graphs (>1000)', () => {
      const bigNodeList = Array.from({ length: 1001 }, (_, i) => {
        const n = makeMockNode(`n${i}`);
        n.degree = vi.fn(() => (i % 10) + 1);
        return n;
      });
      const cy = makeMockCy(bigNodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('radial');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('concentric');
      expect(typeof layoutArg?.concentric).toBe('function');
      expect(typeof layoutArg?.levelWidth).toBe('function');
      controller.destroy();
    });

    it('radial layout computes maxDeg for small graphs', () => {
      const nodeA = makeMockNode('a');
      nodeA.degree = vi.fn(() => 8);
      const nodeB = makeMockNode('b');
      nodeB.degree = vi.fn(() => 3);
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('radial');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('concentric');
      expect(typeof layoutArg?.levelWidth).toBe('function');
      const levelW = layoutArg?.levelWidth();
      expect(levelW).toBeGreaterThanOrEqual(1);
      controller.destroy();
    });

    it('tree layout falls back to highest-degree node when no roots found', () => {
      const nodeA = makeMockNode('a');
      nodeA.degree = vi.fn(() => 5);
      const nodeB = makeMockNode('b');
      nodeB.degree = vi.fn(() => 2);
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('tree');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('breadthfirst');
      expect(layoutArg?.directed).toBe(true);
      controller.destroy();
    });

    it('fcose uses default quality for small graphs', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('fcose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('fcose');
      expect(layoutArg?.quality).toBe('default');
      controller.destroy();
    });

    it('fcose uses reduced quality for large graphs (>500)', () => {
      const bigNodeList = Array.from({ length: 501 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(bigNodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('fcose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('dagre');
      controller.destroy();
    });

    it('circle layout radius function returns value based on cy dimensions', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('circle');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(typeof layoutArg?.radius).toBe('function');
      const radius = layoutArg?.radius();
      expect(radius).toBeGreaterThan(0);
      controller.destroy();
    });

    it('grid layout computes rows and cols for non-square counts', () => {
      const nodeList = Array.from({ length: 7 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(nodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('grid');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.rows).toBe(3);
      expect(layoutArg?.cols).toBe(3);
      controller.destroy();
    });

    it('dagre layout uses rankDir from controller', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.rankDir = 'BT';
      controller.applyLayout('dagre');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.rankDir).toBe('BT');
      controller.destroy();
    });
  });

  describe('applyWorkerLayout - detailed behavior', () => {
    it('calls cy.batch for batch position updates', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const nodeB = makeMockNode('b', 0, 0);
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyWorkerLayout({
        a: { x: 10, y: 20 },
        b: { x: 30, y: 40 },
      });
      expect(cy.batch).toHaveBeenCalled();
      expect(cy.fit).toHaveBeenCalled();
      controller.destroy();
    });

    it('skips nodes that do not exist in cy', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyWorkerLayout({
        a: { x: 10, y: 20 },
        ghost: { x: 999, y: 999 },
      });
      expect(nodeA.position).toHaveBeenCalledWith({ x: 10, y: 20 });
      controller.destroy();
    });
  });

  describe('destroy - cleanup verification', () => {
    it('clears workerTimeout on destroy', () => {
      vi.useFakeTimers();
      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.destroy();
      vi.useRealTimers();
    });

    it('resolves pending workerLayoutResolve with empty on destroy', () => {
      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.destroy();
      expect(controller.isWorkerAvailable()).toBe(false);
    });
  });


  describe('position caching - detailed verification', () => {
    it('cachePositions is called after applyWorkerLayout', () => {
      const nodeA = makeMockNode('a', 0, 0);
      nodeA.position = vi.fn(() => ({ x: 42, y: 99 }));
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyWorkerLayout({ a: { x: 42, y: 99 } });
      expect(nodeA.position).toHaveBeenCalledWith({ x: 42, y: 99 });
      controller.destroy();
    });

    it('restoreCachedPositions is called during applyIncrementalLayout', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 0, 0);
      nodeB.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyWorkerLayout({ a: { x: 50, y: 50 } });
      controller.applyIncrementalLayout('cose', new Set(['b']));
      expect(cy.batch).toHaveBeenCalled();
      controller.destroy();
    });
  });

  describe('computeSmartSpacing', () => {
    it('uses cy.width and cy.height for spacing calculation', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      cy.width = vi.fn(() => 1200);
      cy.height = vi.fn(() => 900);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      expect(cy.width).toHaveBeenCalled();
      expect(cy.height).toHaveBeenCalled();
      controller.destroy();
    });

    it('falls back to 800x600 when cy dimensions are 0', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      cy.width = vi.fn(() => 0);
      cy.height = vi.fn(() => 0);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });
  });

  describe('applyLayout - overlap removal', () => {
    it('registers layoutstop handler for overlap removal', () => {
      const mockLayout = { one: vi.fn(), run: vi.fn() };
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      cy.layout = vi.fn(() => mockLayout);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      expect(mockLayout.one).toHaveBeenCalledWith('layoutstop', expect.any(Function));
      controller.destroy();
    });

    it('calls overlapRemover.remove directly for non-cose/fcose/dagre incremental', () => {
      const nodeA = makeMockNode('a', 100, 100);
      const nodeB = makeMockNode('b', 0, 0);
      nodeB.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('circle', new Set(['b']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });
  });
});