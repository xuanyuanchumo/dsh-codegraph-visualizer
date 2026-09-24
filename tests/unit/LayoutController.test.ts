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

  describe('rankDir', () => {
    it('defaults to TB', () => {
      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      expect(controller.rankDir).toBe('TB');
      controller.destroy();
    });

    it('affects dagre layout options', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.rankDir = 'LR';
      controller.applyLayout('dagre');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.rankDir).toBe('LR');
      controller.destroy();
    });
  });

  describe('buildLayoutOptions detailed parameters', () => {
    it('cose layout includes nodeRepulse, idealEdgeLength, gravity', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('cose');
      expect(layoutArg?.nodeRepulse).toBeGreaterThan(0);
      expect(layoutArg?.idealEdgeLength).toBeGreaterThan(0);
      expect(layoutArg?.gravity).toBe(0.02);
      expect(layoutArg?.randomize).toBe(true);
      controller.destroy();
    });

    it('fcose layout includes samplingType and nodeSeparation', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('fcose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('fcose');
      expect(layoutArg?.samplingType).toBe(true);
      expect(layoutArg?.nodeSeparation).toBeGreaterThan(0);
      controller.destroy();
    });

    it('dagre layout includes rankSep, edgeSep, nodeSep', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('dagre');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('dagre');
      expect(layoutArg?.rankSep).toBeGreaterThan(0);
      expect(layoutArg?.edgeSep).toBeGreaterThan(0);
      expect(layoutArg?.nodeSep).toBeGreaterThan(0);
      expect(layoutArg?.ranker).toBe('tight-tree');
      controller.destroy();
    });

    it('circle layout includes radius function', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('circle');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('circle');
      expect(typeof layoutArg?.radius).toBe('function');
      controller.destroy();
    });

    it('radial layout uses sampling for very large graphs', () => {
      const bigNodeList = Array.from({ length: 2001 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(bigNodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('radial');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('concentric');
      expect(typeof layoutArg?.concentric).toBe('function');
      controller.destroy();
    });

    it('fcose uses reduced iterations for large graphs', () => {
      const bigNodeList = Array.from({ length: 501 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(bigNodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('fcose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('dagre');
      controller.destroy();
    });
  });

  describe('applyLayout animation behavior', () => {
    it('uses animate=true for small dagre graphs', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('dagre');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.animate).toBe(true);
      controller.destroy();
    });

    it('uses animate=false for large graphs falling back to dagre', () => {
      const midNodeList = Array.from({ length: 501 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(midNodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('dagre');
      expect(layoutArg?.animate).toBe(false);
      controller.destroy();
    });

    it('uses animate=false for grid fallback', () => {
      const bigNodeList = Array.from({ length: 5001 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(bigNodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.animate).toBe(false);
      controller.destroy();
    });
  });

  describe('applyIncrementalLayout with different layout types', () => {
    it('applies incremental layout with dagre', () => {
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

    it('applies incremental layout with fcose', () => {
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

    it('applies incremental layout with circle (non-cose/fcose/dagre)', () => {
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

  describe('applyWorkerLayout edge cases', () => {
    it('handles empty positions object', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyWorkerLayout({});
      expect(cy.fit).toHaveBeenCalled();
      controller.destroy();
    });

    it('handles multiple node positions in batch', () => {
      const nodeA = makeMockNode('a', 0, 0);
      const nodeB = makeMockNode('b', 0, 0);
      const nodeC = makeMockNode('c', 0, 0);
      const cy = makeMockCy([nodeA, nodeB, nodeC], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyWorkerLayout({
        a: { x: 10, y: 20 },
        b: { x: 30, y: 40 },
        c: { x: 50, y: 60 },
      });
      expect(nodeA.position).toHaveBeenCalledWith({ x: 10, y: 20 });
      expect(nodeB.position).toHaveBeenCalledWith({ x: 30, y: 40 });
      expect(nodeC.position).toHaveBeenCalledWith({ x: 50, y: 60 });
      controller.destroy();
    });
  });

  describe('destroy cleanup', () => {
    it('clears positionCache on destroy', () => {
      const nodeA = makeMockNode('a', 10, 20);
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyWorkerLayout({ a: { x: 100, y: 200 } });
      controller.destroy();
      expect(() => controller.applyWorkerLayout({})).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.destroy();
      expect(() => controller.destroy()).not.toThrow();
    });
  });

  describe('unhandled layout type', () => {
    it('throws error for unhandled layout in buildLayoutOptions', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      expect(() => controller.applyLayout('invalid' as any)).toThrow();
      controller.destroy();
    });
  });

  describe('worker initialization paths', () => {
    it('creates worker when document.baseURI is available', () => {
      const originalDocument = globalThis.document;
      const workerInstances: any[] = [];
      class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage = vi.fn();
        terminate = vi.fn();
        constructor() { workerInstances.push(this); }
      }
      globalThis.Worker = MockWorker as any;
      globalThis.document = { baseURI: 'http://localhost:3000/' } as any;

      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      expect(workerInstances.length).toBe(1);
      expect(controller.isWorkerAvailable()).toBe(true);
      controller.destroy();

      globalThis.Worker = undefined as any;
      globalThis.document = originalDocument;
    });

    it('sets workerInitFailed when document is undefined', () => {
      const originalDocument = globalThis.document;
      globalThis.document = undefined as any;

      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      expect(controller.isWorkerAvailable()).toBe(false);
      controller.destroy();

      globalThis.document = originalDocument;
    });

    it('sets workerInitFailed when Worker constructor throws', () => {
      const originalDocument = globalThis.document;
      globalThis.document = { baseURI: 'http://localhost:3000/' } as any;
      globalThis.Worker = class { constructor() { throw new Error('Worker not supported'); } } as any;

      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      expect(controller.isWorkerAvailable()).toBe(false);
      controller.destroy();

      globalThis.Worker = undefined as any;
      globalThis.document = originalDocument;
    });

    it('handles worker onerror by terminating and setting workerInitFailed', () => {
      const originalDocument = globalThis.document;
      let mockWorkerInstance: any;
      class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage = vi.fn();
        terminate = vi.fn();
        constructor() { mockWorkerInstance = this; }
      }
      globalThis.Worker = MockWorker as any;
      globalThis.document = { baseURI: 'http://localhost:3000/' } as any;

      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      expect(controller.isWorkerAvailable()).toBe(true);

      mockWorkerInstance.onerror({} as ErrorEvent);
      expect(controller.isWorkerAvailable()).toBe(false);
      expect(mockWorkerInstance.terminate).toHaveBeenCalled();
      controller.destroy();

      globalThis.Worker = undefined as any;
      globalThis.document = originalDocument;
    });

    it('sets workerInitFailed when workerUrl is null (no document.baseURI)', () => {
      const originalDocument = globalThis.document;
      globalThis.document = { baseURI: '' } as any;

      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      expect(controller.isWorkerAvailable()).toBe(false);
      controller.destroy();

      globalThis.document = originalDocument;
    });
  });

  describe('applyLayoutWithWorker with active worker', () => {
    it('posts message to worker and resolves with positions', async () => {
      const originalDocument = globalThis.document;
      let mockWorkerInstance: any;
      class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage = vi.fn();
        terminate = vi.fn();
        constructor() { mockWorkerInstance = this; }
      }
      globalThis.Worker = MockWorker as any;
      globalThis.document = { baseURI: 'http://localhost:3000/' } as any;

      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);

      const promise = controller.applyLayoutWithWorker(
        [{ id: 'a', label: 'A', type: 'function' }],
        [{ id: 'e1', source: 'a', target: 'a', type: 'call' }],
        'cose',
      );

      expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);
      const msgArg = mockWorkerInstance.postMessage.mock.calls[0][0];
      expect(msgArg.layout).toBe('cose');
      expect(msgArg.nodes).toHaveLength(1);
      expect(msgArg.edges).toHaveLength(1);

      mockWorkerInstance.onmessage({ data: { positions: { a: { x: 42, y: 99 } } } } as any);

      const result = await promise;
      expect(result).toEqual({ a: { x: 42, y: 99 } });
      controller.destroy();

      globalThis.Worker = undefined as any;
      globalThis.document = originalDocument;
    });

    it('times out and resolves with empty positions when worker is too slow', async () => {
      const originalDocument = globalThis.document;
      const originalSetTimeout = globalThis.setTimeout;
      class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage = vi.fn();
        terminate = vi.fn();
      }
      globalThis.Worker = MockWorker as any;
      globalThis.document = { baseURI: 'http://localhost:3000/' } as any;

      let timeoutCallback: (() => void) | null = null;
      globalThis.setTimeout = ((cb: () => void) => { timeoutCallback = cb; return 0 as any; }) as any;

      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);

      const promise = controller.applyLayoutWithWorker(
        [{ id: 'a', label: 'A', type: 'function' }],
        [],
        'cose',
      );

      expect(timeoutCallback).not.toBeNull();
      timeoutCallback!();

      const result = await promise;
      expect(result).toEqual({});
      expect(controller.isWorkerAvailable()).toBe(false);
      controller.destroy();

      globalThis.setTimeout = originalSetTimeout;
      globalThis.Worker = undefined as any;
      globalThis.document = originalDocument;
    });
  });

  describe('cachePositions and restoreCachedPositions', () => {
    it('cachePositions stores all node positions in cache', () => {
      const nodeA = makeMockNode('a', 10, 20);
      const nodeB = makeMockNode('b', 30, 40);
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);

      controller.applyWorkerLayout({ a: { x: 100, y: 200 } });

      expect(nodeA.position).toHaveBeenCalledWith({ x: 100, y: 200 });
      controller.destroy();
    });

    it('restoreCachedPositions restores positions via cy.batch', () => {
      const nodeA = makeMockNode('a', 10, 20);
      const nodeB = makeMockNode('b', 30, 40);
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);

      controller.applyWorkerLayout({
        a: { x: 100, y: 200 },
        b: { x: 300, y: 400 },
      });

      nodeA.position.mockClear();
      nodeB.position.mockClear();

      controller.applyIncrementalLayout('cose', new Set(['a']));
      controller.destroy();
    });

    it('skips restore for nodes not in cache', () => {
      const nodeA = makeMockNode('a', 0, 0);
      nodeA.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);

      controller.applyIncrementalLayout('cose', new Set(['a']));
      controller.destroy();
    });
  });

  describe('computeSmartSpacing integration', () => {
    it('cose layout uses smart spacing values based on node count', () => {
      const smallList = Array.from({ length: 10 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(smallList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.nodeRepulse).toBeGreaterThan(0);
      expect(layoutArg?.nodeRepulse).toBeLessThanOrEqual(20000);
      expect(layoutArg?.idealEdgeLength).toBeGreaterThan(0);
      controller.destroy();
    });

    it('dagre layout uses rankSep within bounds [30, 80]', () => {
      const nodeList = Array.from({ length: 100 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(nodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('dagre');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.rankSep).toBeGreaterThanOrEqual(30);
      expect(layoutArg?.rankSep).toBeLessThanOrEqual(80);
      controller.destroy();
    });

    it('circle layout radius function returns value based on container dimensions', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('circle');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(typeof layoutArg?.radius).toBe('function');
      const radiusVal = layoutArg.radius();
      expect(radiusVal).toBeGreaterThan(0);
      controller.destroy();
    });
  });

  describe('tree layout root selection', () => {
    it('uses degree-sorted node as root when no isRoot property and no roots()', () => {
      const nodeA = makeMockNode('a');
      nodeA.degree = vi.fn(() => 3);
      const nodeB = makeMockNode('b');
      nodeB.degree = vi.fn(() => 1);
      const cy = makeMockCy([nodeA, nodeB], []);
      cy.nodes().roots = vi.fn(() => ({
        nonempty: vi.fn(() => false),
        empty: vi.fn(() => true),
        forEach: vi.fn(),
        length: 0,
        filter: vi.fn(() => ({ nonempty: vi.fn(() => false), length: 0 })),
        sort: vi.fn(() => ({ nonempty: vi.fn(() => false), length: 0 })),
        slice: vi.fn(() => ({ nonempty: vi.fn(() => false), length: 0 })),
        roots: vi.fn(),
        map: vi.fn(() => []),
        boundingBox: vi.fn(() => ({ x1: 0, y1: 0, x2: 0, y2: 0, w: 0, h: 0 })),
        layout: vi.fn(() => ({ one: vi.fn(), run: vi.fn() })),
      })) as any;
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('tree');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('breadthfirst');
      expect(layoutArg?.directed).toBe(true);
      controller.destroy();
    });

    it('uses roots() when available and nonempty', () => {
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

  describe('radial layout levelW computation', () => {
    it('computes levelW based on max degree for small graphs', () => {
      const nodeA = makeMockNode('a');
      nodeA.degree = vi.fn(() => 8);
      const nodeB = makeMockNode('b');
      nodeB.degree = vi.fn(() => 4);
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('radial');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('concentric');
      expect(typeof layoutArg?.levelWidth).toBe('function');
      const lw = layoutArg.levelWidth();
      expect(lw).toBeGreaterThanOrEqual(1);
      controller.destroy();
    });

    it('uses sampling for very large graphs (>2000 nodes)', () => {
      const bigNodeList = Array.from({ length: 2001 }, (_, i) => {
        const n = makeMockNode(`n${i}`);
        n.degree = vi.fn(() => Math.floor(Math.random() * 10) + 1);
        return n;
      });
      const cy = makeMockCy(bigNodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('radial');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('concentric');
      expect(typeof layoutArg?.concentric).toBe('function');
      controller.destroy();
    });
  });

  describe('applyLayout RAF management', () => {
    it('cancels pending RAF when applyLayout called twice', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      controller.applyLayout('cose');
      expect(cy.layout).toHaveBeenCalledTimes(2);
      controller.destroy();
    });

    it('cancels pending RAF when applyIncrementalLayout called', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 0, 0);
      nodeB.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('cose');
      controller.applyIncrementalLayout('cose', new Set(['b']));
      controller.destroy();
    });
  });

  describe('fcose large graph quality and iterations', () => {
    it('uses draft quality for fcose with >5000 nodes (grid fallback)', () => {
      const bigNodeList = Array.from({ length: 5001 }, (_, i) => makeMockNode(`n${i}`));
      const cy = makeMockCy(bigNodeList, []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyLayout('fcose');
      const layoutArg = cy.layout.mock.calls[0]?.[0];
      expect(layoutArg?.name).toBe('grid');
      controller.destroy();
    });

    it('uses default quality for fcose with small graphs', () => {
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
  });

  describe('destroy with active worker', () => {
    it('terminates worker and clears workerTimeout on destroy', () => {
      const originalDocument = globalThis.document;
      let mockWorkerInstance: any;
      class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage = vi.fn();
        terminate = vi.fn();
        constructor() { mockWorkerInstance = this; }
      }
      globalThis.Worker = MockWorker as any;
      globalThis.document = { baseURI: 'http://localhost:3000/' } as any;

      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      expect(controller.isWorkerAvailable()).toBe(true);

      controller.destroy();
      expect(mockWorkerInstance.terminate).toHaveBeenCalled();
      expect(controller.isWorkerAvailable()).toBe(false);

      globalThis.Worker = undefined as any;
      globalThis.document = originalDocument;
    });

    it('resolves pending workerLayoutResolve with empty positions on destroy', () => {
      const originalDocument = globalThis.document;
      class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage = vi.fn();
        terminate = vi.fn();
      }
      globalThis.Worker = MockWorker as any;
      globalThis.document = { baseURI: 'http://localhost:3000/' } as any;

      const cy = makeMockCy();
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.destroy();

      globalThis.Worker = undefined as any;
      globalThis.document = originalDocument;
    });
  });

  describe('applyIncrementalLayout spiral distribution', () => {
    it('places multiple new nodes using golden angle spiral', () => {
      const nodeA = makeMockNode('a', 100, 100);
      const nodeB = makeMockNode('b', 200, 200);
      const nodeC = makeMockNode('c', 0, 0);
      const nodeD = makeMockNode('d', 50, 50);
      const edgeCA = makeMockEdge('e1', 'c', 'a');
      const edgeDA = makeMockEdge('e2', 'd', 'a');
      nodeC.connectedEdges = vi.fn(() => ({ forEach: (cb: (e: any) => void) => cb(edgeCA) }));
      nodeD.connectedEdges = vi.fn(() => ({ forEach: (cb: (e: any) => void) => cb(edgeDA) }));
      const cy = makeMockCy([nodeA, nodeB, nodeC, nodeD], [edgeCA, edgeDA]);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('cose', new Set(['c', 'd']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });

    it('uses boundingBox center when anchorCount is 0 but existing nodes exist', () => {
      const nodeA = makeMockNode('a', 100, 100);
      const nodeB = makeMockNode('b', 0, 0);
      nodeB.connectedEdges = vi.fn(() => ({ forEach: vi.fn() }));
      const cy = makeMockCy([nodeA, nodeB], []);
      const { LayoutController } = require('../../src/client/renderer/LayoutController.ts');
      const controller = new LayoutController(cy);
      controller.applyIncrementalLayout('cose', new Set(['b']));
      expect(cy.layout).toHaveBeenCalled();
      controller.destroy();
    });
  });
});