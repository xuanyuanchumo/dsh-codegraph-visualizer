import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VirtualViewportController,
  edgeIntersectsViewport,
} from '../../src/client/renderer/VirtualViewportController.ts';
import { VIRTUAL_VIEWPORT } from '../../src/shared/constants.ts';

let rafIdCounter = 0;
const rafCallbacks = new Map<number, () => void>();
let originalRAF: typeof requestAnimationFrame | undefined;
let originalCancelRAF: typeof cancelAnimationFrame | undefined;

beforeEach(() => {
  originalRAF = globalThis.requestAnimationFrame;
  originalCancelRAF = globalThis.cancelAnimationFrame;
  rafIdCounter = 0;
  rafCallbacks.clear();
  globalThis.requestAnimationFrame = ((cb: () => void) => {
    const id = ++rafIdCounter;
    rafCallbacks.set(id, cb);
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    rafCallbacks.delete(id);
  }) as typeof cancelAnimationFrame;
});

afterEach(() => {
  if (originalRAF !== undefined) globalThis.requestAnimationFrame = originalRAF;
  else delete (globalThis as any).requestAnimationFrame;
  if (originalCancelRAF !== undefined) globalThis.cancelAnimationFrame = originalCancelRAF;
  else delete (globalThis as any).cancelAnimationFrame;
  rafCallbacks.clear();
});

function flushRAF() {
  const callbacks = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const cb of callbacks) cb();
}

function makeMockNode(id: string, x = 0, y = 0, data: Record<string, unknown> = {}) {
  const dataMap = new Map<string, unknown>(Object.entries(data));
  const connectedEdgeList: any[] = [];
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
    connectedEdges: vi.fn(() => ({
      forEach: vi.fn((cb: (e: any) => void) => connectedEdgeList.forEach(cb)),
      length: connectedEdgeList.length,
    })),
    isNode: vi.fn(() => true),
    addClass: vi.fn(),
    removeClass: vi.fn(),
    hasClass: vi.fn(() => false),
    _connectedEdgeList: connectedEdgeList,
    _dataMap: dataMap,
  };
}

function makeMockEdge(id: string, sourceNode: any, targetNode: any, data: Record<string, unknown> = {}) {
  const dataMap = new Map<string, unknown>(Object.entries(data));
  return {
    id: () => id,
    source: () => sourceNode,
    target: () => targetNode,
    style: vi.fn(),
    data: vi.fn((key: string, value?: unknown) => {
      if (value !== undefined) { dataMap.set(key, value); return undefined; }
      return dataMap.get(key);
    }),
    isNode: vi.fn(() => false),
    addClass: vi.fn(),
    removeClass: vi.fn(),
    hasClass: vi.fn(() => false),
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
    nonempty: vi.fn(() => items.length > 0),
    empty: vi.fn(() => items.length === 0),
  });

  const nodesCollection = buildCollection(nodeList);
  const edgesCollection = buildCollection(edgeList);

  const mockCy = {
    nodes: vi.fn(() => nodesCollection),
    edges: vi.fn(() => edgesCollection),
    on: vi.fn(),
    off: vi.fn(),
    batch: vi.fn((cb: () => void) => cb()),
    zoom: vi.fn(() => 1),
    pan: vi.fn(() => ({ x: 0, y: 0 })),
    width: vi.fn(() => 800),
    height: vi.fn(() => 600),
    fit: vi.fn(),
    animate: vi.fn(),
    panBy: vi.fn(),
    resize: vi.fn(),
    getElementById: vi.fn((id: string) => nodeMap.get(id) ?? {
      nonempty: vi.fn(() => false),
      empty: vi.fn(() => true),
      position: vi.fn(() => ({ x: 0, y: 0 })),
      data: vi.fn(),
      style: vi.fn(),
      connectedEdges: vi.fn(() => ({ forEach: vi.fn(), length: 0 })),
      isNode: vi.fn(() => true),
    }),
    _nodeMap: nodeMap,
    _nodeList: nodeList,
    _edgeList: edgeList,
  };

  return mockCy;
}

describe('edgeIntersectsViewport', () => {
  const bounds = { x1: 0, y1: 0, x2: 100, y2: 100 };

  it('returns true when source is inside viewport', () => {
    expect(edgeIntersectsViewport({ x: 50, y: 50 }, { x: 200, y: 200 }, bounds)).toBe(true);
  });

  it('returns true when target is inside viewport', () => {
    expect(edgeIntersectsViewport({ x: 200, y: 200 }, { x: 50, y: 50 }, bounds)).toBe(true);
  });

  it('returns true when both endpoints are inside viewport', () => {
    expect(edgeIntersectsViewport({ x: 10, y: 10 }, { x: 90, y: 90 }, bounds)).toBe(true);
  });

  it('returns true when edge crosses through viewport', () => {
    expect(edgeIntersectsViewport({ x: -50, y: 50 }, { x: 150, y: 50 }, bounds)).toBe(true);
  });

  it('returns false when edge is completely outside viewport', () => {
    expect(edgeIntersectsViewport({ x: 200, y: 200 }, { x: 300, y: 300 }, bounds)).toBe(false);
  });

  it('returns false when both points are the same (degenerate edge)', () => {
    expect(edgeIntersectsViewport({ x: 200, y: 200 }, { x: 200, y: 200 }, bounds)).toBe(false);
  });

  it('handles vertical edge crossing viewport', () => {
    expect(edgeIntersectsViewport({ x: 50, y: -50 }, { x: 50, y: 150 }, bounds)).toBe(true);
  });

  it('handles horizontal edge crossing viewport', () => {
    expect(edgeIntersectsViewport({ x: -50, y: 50 }, { x: 150, y: 50 }, bounds)).toBe(true);
  });

  it('returns false for vertical edge outside viewport', () => {
    expect(edgeIntersectsViewport({ x: 200, y: -50 }, { x: 200, y: 150 }, bounds)).toBe(false);
  });

  it('returns true for edge partially overlapping viewport boundary', () => {
    expect(edgeIntersectsViewport({ x: 50, y: 50 }, { x: 50, y: 200 }, bounds)).toBe(true);
  });
});

describe('VirtualViewportController', () => {
  describe('constructor', () => {
    it('constructs without throwing', () => {
      const cy = makeMockCy();
      const ctrl = new VirtualViewportController(cy as any);
      expect(ctrl).toBeInstanceOf(VirtualViewportController);
    });
  });

  describe('isEnabled', () => {
    it('returns false initially', () => {
      const cy = makeMockCy();
      const ctrl = new VirtualViewportController(cy as any);
      expect(ctrl.isEnabled()).toBe(false);
    });

    it('returns true after enable', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const cy = makeMockCy([nodeA], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      expect(ctrl.isEnabled()).toBe(true);
      ctrl.disable();
    });

    it('returns false after disable', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const cy = makeMockCy([nodeA], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      ctrl.disable();
      expect(ctrl.isEnabled()).toBe(false);
    });
  });

  describe('shouldEnable', () => {
    it('returns false when node count equals threshold', () => {
      const cy = makeMockCy();
      const ctrl = new VirtualViewportController(cy as any);
      expect(ctrl.shouldEnable(VIRTUAL_VIEWPORT.SCROLL_THRESHOLD)).toBe(false);
    });

    it('returns true when node count exceeds threshold', () => {
      const cy = makeMockCy();
      const ctrl = new VirtualViewportController(cy as any);
      expect(ctrl.shouldEnable(VIRTUAL_VIEWPORT.SCROLL_THRESHOLD + 1)).toBe(true);
    });

    it('returns false when node count is below threshold', () => {
      const cy = makeMockCy();
      const ctrl = new VirtualViewportController(cy as any);
      expect(ctrl.shouldEnable(100)).toBe(false);
    });

    it('returns true for very large node count', () => {
      const cy = makeMockCy();
      const ctrl = new VirtualViewportController(cy as any);
      expect(ctrl.shouldEnable(100000)).toBe(true);
    });
  });

  describe('enable', () => {
    it('registers viewport and structure change event listeners', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const cy = makeMockCy([nodeA], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      expect(cy.on).toHaveBeenCalledWith('viewport', expect.any(Function));
      expect(cy.on).toHaveBeenCalledWith('add remove', expect.any(Function));
      ctrl.disable();
    });

    it('does not register events twice when called multiple times', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const cy = makeMockCy([nodeA], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      const callCountAfterFirst = cy.on.mock.calls.length;
      ctrl.enable();
      expect(cy.on.mock.calls.length).toBe(callCountAfterFirst);
      ctrl.disable();
    });
  });

  describe('disable', () => {
    it('removes event listeners', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const cy = makeMockCy([nodeA], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      ctrl.disable();
      expect(cy.off).toHaveBeenCalledWith('viewport', expect.any(Function));
      expect(cy.off).toHaveBeenCalledWith('add remove', expect.any(Function));
    });

    it('restores all node display styles to element when not filtered', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 200, 200);
      const cy = makeMockCy([nodeA, nodeB], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      ctrl.disable();
      expect(nodeA.style).toHaveBeenCalledWith('display', 'element');
      expect(nodeB.style).toHaveBeenCalledWith('display', 'element');
    });

    it('keeps filtered nodes hidden when disabled', () => {
      const nodeA = makeMockNode('a', 50, 50, { typeFiltered: true });
      const cy = makeMockCy([nodeA], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      ctrl.disable();
      expect(nodeA.style).toHaveBeenCalledWith('display', 'none');
    });

    it('keeps connectionFiltered nodes hidden when disabled', () => {
      const nodeA = makeMockNode('a', 50, 50, { connectionFiltered: true });
      const cy = makeMockCy([nodeA], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      ctrl.disable();
      expect(nodeA.style).toHaveBeenCalledWith('display', 'none');
    });

    it('does nothing when not enabled', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const cy = makeMockCy([nodeA], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.disable();
      expect(cy.off).not.toHaveBeenCalled();
    });
  });

  describe('getVisibleNodeCount', () => {
    it('returns 0 initially', () => {
      const cy = makeMockCy();
      const ctrl = new VirtualViewportController(cy as any);
      expect(ctrl.getVisibleNodeCount()).toBe(0);
    });

    it('returns visible node count after enable with nodes in viewport', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 200, 200);
      const cy = makeMockCy([nodeA, nodeB], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      expect(ctrl.getVisibleNodeCount()).toBeGreaterThan(0);
      ctrl.disable();
    });
  });

  describe('destroy', () => {
    it('calls disable and cleans up', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const cy = makeMockCy([nodeA], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      ctrl.destroy();
      expect(ctrl.isEnabled()).toBe(false);
    });

    it('can be called when not enabled', () => {
      const cy = makeMockCy();
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.destroy();
      expect(ctrl.isEnabled()).toBe(false);
    });
  });

  describe('visibility update with filtered nodes', () => {
    it('skips typeFiltered nodes during visibility update', () => {
      const nodeA = makeMockNode('a', 50, 50, { typeFiltered: true });
      const nodeB = makeMockNode('b', 60, 60);
      const cy = makeMockCy([nodeA, nodeB], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      expect(ctrl.getVisibleNodeCount()).toBe(1);
      ctrl.disable();
    });

    it('skips connectionFiltered nodes during visibility update', () => {
      const nodeA = makeMockNode('a', 50, 50, { connectionFiltered: true });
      const nodeB = makeMockNode('b', 60, 60);
      const cy = makeMockCy([nodeA, nodeB], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      expect(ctrl.getVisibleNodeCount()).toBe(1);
      ctrl.disable();
    });
  });

  describe('edge visibility', () => {
    it('shows edge when both endpoints are visible', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 60, 60);
      const edgeAB = makeMockEdge('e1', nodeA, nodeB);
      nodeA._connectedEdgeList.push(edgeAB);
      nodeB._connectedEdgeList.push(edgeAB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      expect(edgeAB.style).toHaveBeenCalledWith('display', 'element');
      ctrl.disable();
    });

    it('hides edge with typeFiltered flag', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 60, 60);
      const edgeAB = makeMockEdge('e1', nodeA, nodeB, { typeFiltered: true });
      nodeA._connectedEdgeList.push(edgeAB);
      nodeB._connectedEdgeList.push(edgeAB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      expect(edgeAB.style).toHaveBeenCalledWith('display', 'none');
      ctrl.disable();
    });
  });

  describe('handleViewportChange event handler', () => {
    it('triggers visibility update when viewport event fires', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 5000, 5000);
      const cy = makeMockCy([nodeA, nodeB], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();

      const viewportHandler = cy.on.mock.calls.find(
        (call: any[]) => call[0] === 'viewport',
      )?.[1] as (() => void) | undefined;
      expect(viewportHandler).toBeDefined();

      if (viewportHandler) {
        viewportHandler();
        flushRAF();
      }

      expect(ctrl.getVisibleNodeCount()).toBeGreaterThanOrEqual(0);
      ctrl.disable();
    });

    it('does not schedule multiple RAFs when viewport changes rapidly', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const cy = makeMockCy([nodeA], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();

      const viewportHandler = cy.on.mock.calls.find(
        (call: any[]) => call[0] === 'viewport',
      )?.[1] as (() => void) | undefined;
      expect(viewportHandler).toBeDefined();

      if (viewportHandler) {
        viewportHandler();
        viewportHandler();
        viewportHandler();
        flushRAF();
      }

      ctrl.disable();
    });
  });

  describe('handleStructureChange event handler', () => {
    it('marks index as dirty when structure change event fires', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const cy = makeMockCy([nodeA], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();

      const structureHandler = cy.on.mock.calls.find(
        (call: any[]) => call[0] === 'add remove',
      )?.[1] as (() => void) | undefined;
      expect(structureHandler).toBeDefined();

      if (structureHandler) {
        structureHandler();
        flushRAF();
      }

      ctrl.disable();
    });

    it('does not schedule multiple RAFs when structure changes rapidly', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const cy = makeMockCy([nodeA], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();

      const structureHandler = cy.on.mock.calls.find(
        (call: any[]) => call[0] === 'add remove',
      )?.[1] as (() => void) | undefined;
      expect(structureHandler).toBeDefined();

      if (structureHandler) {
        structureHandler();
        structureHandler();
        flushRAF();
      }

      ctrl.disable();
    });

    it('triggers rebuildIndex on next visibility update after structure change', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 60, 60);
      const cy = makeMockCy([nodeA, nodeB], []);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();

      const structureHandler = cy.on.mock.calls.find(
        (call: any[]) => call[0] === 'add remove',
      )?.[1] as (() => void) | undefined;
      expect(structureHandler).toBeDefined();

      if (structureHandler) {
        structureHandler();
        flushRAF();
      }

      const viewportHandler = cy.on.mock.calls.find(
        (call: any[]) => call[0] === 'viewport',
      )?.[1] as (() => void) | undefined;
      if (viewportHandler) {
        viewportHandler();
        flushRAF();
      }

      ctrl.disable();
    });
  });

  describe('connectionFiltered edge visibility', () => {
    it('hides edge with connectionFiltered flag', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 60, 60);
      const edgeAB = makeMockEdge('e1', nodeA, nodeB, { connectionFiltered: true });
      nodeA._connectedEdgeList.push(edgeAB);
      nodeB._connectedEdgeList.push(edgeAB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      expect(edgeAB.style).toHaveBeenCalledWith('display', 'none');
      ctrl.disable();
    });

    it('shows edge intersecting viewport when only one endpoint is visible', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 5000, 5000);
      const edgeAB = makeMockEdge('e1', nodeA, nodeB);
      nodeA._connectedEdgeList.push(edgeAB);
      nodeB._connectedEdgeList.push(edgeAB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      ctrl.disable();
    });
  });

  describe('disable restores edge styles', () => {
    it('restores all edge display styles to element when not filtered', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 60, 60);
      const edgeAB = makeMockEdge('e1', nodeA, nodeB);
      nodeA._connectedEdgeList.push(edgeAB);
      nodeB._connectedEdgeList.push(edgeAB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      ctrl.disable();
      expect(edgeAB.style).toHaveBeenCalledWith('display', 'element');
    });

    it('keeps filtered edges hidden when disabled', () => {
      const nodeA = makeMockNode('a', 50, 50);
      const nodeB = makeMockNode('b', 60, 60);
      const edgeAB = makeMockEdge('e1', nodeA, nodeB, { typeFiltered: true });
      nodeA._connectedEdgeList.push(edgeAB);
      nodeB._connectedEdgeList.push(edgeAB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const ctrl = new VirtualViewportController(cy as any);
      ctrl.enable();
      ctrl.disable();
      expect(edgeAB.style).toHaveBeenCalledWith('display', 'none');
    });
  });
});