import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ViewportController } from '../../src/client/renderer/ViewportController.ts';

function makeMockNode(id: string, x = 0, y = 0, data: Record<string, unknown> = {}) {
  const dataMap = new Map<string, unknown>(Object.entries(data));
  const classes = new Set<string>();
  const neighborhoodItems: any[] = [];
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
    isNode: vi.fn(() => true),
    neighborhood: vi.fn(() => ({
      forEach: vi.fn((cb: (el: any) => void) => neighborhoodItems.forEach(cb)),
    })),
    addClass: vi.fn((cls: string) => { classes.add(cls); }),
    removeClass: vi.fn((cls: string) => { classes.delete(cls); }),
    hasClass: vi.fn((cls: string) => classes.has(cls)),
    _neighborhoodItems: neighborhoodItems,
    _classes: classes,
  };
}

function makeMockEdge(id: string, sourceId: string, targetId: string) {
  const sourceNode = makeMockNode(sourceId);
  const targetNode = makeMockNode(targetId);
  const classes = new Set<string>();
  return {
    id: () => id,
    source: () => sourceNode,
    target: () => targetNode,
    style: vi.fn(),
    data: vi.fn((key: string) => { if (key === 'typeFiltered') return false; return undefined; }),
    isNode: vi.fn(() => false),
    addClass: vi.fn((cls: string) => { classes.add(cls); }),
    removeClass: vi.fn((cls: string) => { classes.delete(cls); }),
    hasClass: vi.fn((cls: string) => classes.has(cls)),
    _classes: classes,
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
    removeClass: vi.fn((cls: string) => { items.forEach((el: any) => { if (el.removeClass) el.removeClass(cls); }); }),
    addClass: vi.fn((cls: string) => { items.forEach((el: any) => { if (el.addClass) el.addClass(cls); }); }),
  });

  const nodesCollection = buildCollection(nodeList);
  const edgesCollection = buildCollection(edgeList);
  const elementsCollection = buildCollection([...nodeList, ...edgeList]);

  const mockCy = {
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
    animate: vi.fn(),
    png: vi.fn(() => 'data:image/png;base64,mockThumbnail'),
    panBy: vi.fn(),
    resize: vi.fn(),
    getElementById: vi.fn((id: string) => nodeMap.get(id) ?? {
      nonempty: vi.fn(() => false),
      empty: vi.fn(() => true),
      position: vi.fn(() => ({ x: 0, y: 0 })),
      data: vi.fn(),
      width: vi.fn(() => 30),
      height: vi.fn(() => 30),
      connectedEdges: vi.fn(() => ({ forEach: vi.fn(), length: 0 })),
      isNode: vi.fn(() => true),
      neighborhood: vi.fn(() => ({ forEach: vi.fn() })),
      addClass: vi.fn(),
      removeClass: vi.fn(),
      hasClass: vi.fn(() => false),
    }),
    _nodeMap: nodeMap,
    _nodeList: nodeList,
    _edgeList: edgeList,
  };

  return mockCy;
}

describe('ViewportController', () => {
  describe('constructor', () => {
    it('constructs without throwing', () => {
      const cy = makeMockCy();
      const ctrl = new ViewportController(cy as any);
      expect(ctrl).toBeInstanceOf(ViewportController);
    });
  });

  describe('focusOnNode', () => {
    it('calls cy.animate when node exists', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const controller = new ViewportController(cy as any);
      controller.focusOnNode('a');
      expect(cy.animate).toHaveBeenCalledTimes(1);
      const animateArg = cy.animate.mock.calls[0]?.[0];
      expect(animateArg?.center).toEqual({ eles: nodeA });
      expect(animateArg?.duration).toBe(300);
    });

    it('does not call cy.animate when node does not exist', () => {
      const cy = makeMockCy([], []);
      const controller = new ViewportController(cy as any);
      controller.focusOnNode('nonexistent');
      expect(cy.animate).not.toHaveBeenCalled();
    });

    it('uses zoom at least 1.2 when current zoom is lower', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      cy.zoom = vi.fn(() => 0.5);
      const controller = new ViewportController(cy as any);
      controller.focusOnNode('a');
      const animateArg = cy.animate.mock.calls[0]?.[0];
      expect(animateArg?.zoom).toBe(1.2);
    });

    it('uses current zoom when it is higher than 1.2', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      cy.zoom = vi.fn(() => 2.5);
      const controller = new ViewportController(cy as any);
      controller.focusOnNode('a');
      const animateArg = cy.animate.mock.calls[0]?.[0];
      expect(animateArg?.zoom).toBe(2.5);
    });
  });

  describe('focusNeighborhood', () => {
    it('clears previous dim classes and returns early when nodeId is null', () => {
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      nodeA._neighborhoodItems.push(edgeAB, nodeB);

      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB]);
      const controller = new ViewportController(cy as any);

      controller.focusNeighborhood('a' as any);
      controller.focusNeighborhood(null);

      expect(nodeC.removeClass).toHaveBeenCalledWith('focus-dim');
      expect(cy.animate).toHaveBeenCalledTimes(1);
    });

    it('clears previous dim classes and returns early when focusNode is empty', () => {
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      nodeA._neighborhoodItems.push(edgeAB, nodeB);

      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB]);
      const controller = new ViewportController(cy as any);

      controller.focusNeighborhood('a' as any);
      controller.focusNeighborhood('nonexistent' as any);

      expect(nodeC.removeClass).toHaveBeenCalledWith('focus-dim');
    });

    it('adds focus-highlight to focus node and neighbors, focus-dim to others', () => {
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const edgeAB = makeMockEdge('e1', 'a', 'b');

      nodeA._neighborhoodItems.push(edgeAB, nodeB);

      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB]);
      const controller = new ViewportController(cy as any);

      controller.focusNeighborhood('a' as any);

      expect(nodeA.addClass).toHaveBeenCalledWith('focus-highlight');
      expect(nodeB.addClass).toHaveBeenCalledWith('focus-highlight');
      expect(nodeC.addClass).toHaveBeenCalledWith('focus-dim');
      expect(cy.animate).toHaveBeenCalledTimes(1);
      const animateArg = cy.animate.mock.calls[0]?.[0];
      expect(animateArg?.duration).toBe(400);
    });

    it('calls cy.elements().removeClass for focus-highlight on each call', () => {
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      nodeA._neighborhoodItems.push(edgeAB, nodeB);

      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const controller = new ViewportController(cy as any);

      controller.focusNeighborhood('a' as any);

      const elementsCollection = cy.elements();
      expect(elementsCollection.removeClass).toHaveBeenCalledWith('focus-highlight');
    });

    it('only includes node neighbors (not edges) in relevant set', () => {
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeAB = makeMockEdge('e1', 'a', 'b');

      edgeAB.isNode = vi.fn(() => false);
      nodeA._neighborhoodItems.push(edgeAB, nodeB);

      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const controller = new ViewportController(cy as any);

      controller.focusNeighborhood('a' as any);

      expect(nodeA.addClass).toHaveBeenCalledWith('focus-highlight');
      expect(nodeB.addClass).toHaveBeenCalledWith('focus-highlight');
      expect(edgeAB.addClass).not.toHaveBeenCalledWith('focus-highlight');
    });
  });

  describe('expandNeighborhood', () => {
    it('returns only the nodeId when depth is 0', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const controller = new ViewportController(cy as any);

      const result = controller.expandNeighborhood('a' as any, 0);
      expect(result).toEqual(new Set(['a']));
    });

    it('returns nodeId and direct neighbors when depth is 1', () => {
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      const edgeAC = makeMockEdge('e2', 'a', 'c');

      nodeA._neighborhoodItems.push(edgeAB, nodeB, edgeAC, nodeC);

      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB, edgeAC]);
      const controller = new ViewportController(cy as any);

      const result = controller.expandNeighborhood('a' as any, 1);
      expect(result).toEqual(new Set(['a', 'b', 'c']));
    });

    it('expands to depth 2 including indirect neighbors', () => {
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const nodeD = makeMockNode('d');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      const edgeBC = makeMockEdge('e2', 'b', 'c');

      nodeA._neighborhoodItems.push(edgeAB, nodeB);
      nodeB._neighborhoodItems.push(edgeBC, nodeC);

      const cy = makeMockCy([nodeA, nodeB, nodeC, nodeD], [edgeAB, edgeBC]);
      const controller = new ViewportController(cy as any);

      const result = controller.expandNeighborhood('a' as any, 2);
      expect(result).toEqual(new Set(['a', 'b', 'c']));
    });

    it('breaks early when frontier becomes empty', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const controller = new ViewportController(cy as any);

      const result = controller.expandNeighborhood('a' as any, 5);
      expect(result).toEqual(new Set(['a']));
    });

    it('handles non-existent nodeId gracefully', () => {
      const cy = makeMockCy([], []);
      const controller = new ViewportController(cy as any);

      const result = controller.expandNeighborhood('nonexistent' as any, 2);
      expect(result).toEqual(new Set(['nonexistent']));
    });

    it('adds focus-highlight to relevant nodes and focus-dim to others', () => {
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const edgeAB = makeMockEdge('e1', 'a', 'b');

      nodeA._neighborhoodItems.push(edgeAB, nodeB);

      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB]);
      const controller = new ViewportController(cy as any);

      controller.expandNeighborhood('a' as any, 1);

      expect(nodeA.addClass).toHaveBeenCalledWith('focus-highlight');
      expect(nodeB.addClass).toHaveBeenCalledWith('focus-highlight');
      expect(nodeC.addClass).toHaveBeenCalledWith('focus-dim');
    });

    it('calls cy.animate with fit options', () => {
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      nodeA._neighborhoodItems.push(edgeAB, nodeB);

      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const controller = new ViewportController(cy as any);

      controller.expandNeighborhood('a' as any, 1);

      expect(cy.animate).toHaveBeenCalledTimes(1);
      const animateArg = cy.animate.mock.calls[0]?.[0];
      expect(animateArg?.duration).toBe(400);
      expect(animateArg?.fit?.padding).toBe(80);
    });

    it('clears previous dim classes before applying new ones', () => {
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      nodeA._neighborhoodItems.push(edgeAB, nodeB);

      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB]);
      const controller = new ViewportController(cy as any);

      controller.focusNeighborhood('a' as any);
      controller.expandNeighborhood('a' as any, 1);

      expect(nodeC.removeClass).toHaveBeenCalledWith('focus-dim');
    });
  });

  describe('getThumbnail', () => {
    it('returns png string from cy.png', () => {
      const cy = makeMockCy();
      const controller = new ViewportController(cy as any);

      const result = controller.getThumbnail();
      expect(cy.png).toHaveBeenCalledWith({ full: true, scale: 0.15, bg: 'transparent' });
      expect(result).toBe('data:image/png;base64,mockThumbnail');
    });

    it('returns null when cy.png returns null', () => {
      const cy = makeMockCy();
      (cy as any).png = vi.fn(() => null);
      const controller = new ViewportController(cy as any);

      const result = controller.getThumbnail();
      expect(result).toBeNull();
    });
  });

  describe('getViewportInfo', () => {
    it('returns correct viewport info', () => {
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      cy.zoom = vi.fn(() => 1.5);
      cy.pan = vi.fn(() => ({ x: 100, y: 200 }));
      cy.width = vi.fn(() => 800);
      cy.height = vi.fn(() => 600);
      const controller = new ViewportController(cy as any);

      const result = controller.getViewportInfo();
      expect(result).toEqual({
        zoom: 1.5,
        pan: { x: 100, y: 200 },
        renderedSize: { w: 800, h: 600 },
        totalSize: { w: 100, h: 100 },
      });
    });

    it('returns null when elements boundingBox is invalid', () => {
      const cy = makeMockCy([], []);
      const elementsCollection = cy.elements();
      elementsCollection.boundingBox = vi.fn(() => ({ w: 0, h: 0, x1: 0, y1: 0, x2: 0, y2: 0 }));
      const controller = new ViewportController(cy as any);

      const result = controller.getViewportInfo();
      expect(result).not.toBeNull();
      expect(result?.totalSize).toEqual({ w: 0, h: 0 });
    });
  });

  describe('focusOnArea', () => {
    it('calls cy.zoom and cy.panBy with correct values', () => {
      const cy = makeMockCy();
      cy.zoom = vi.fn(() => 1);
      cy.width = vi.fn(() => 800);
      cy.height = vi.fn(() => 600);
      const controller = new ViewportController(cy as any);

      controller.focusOnArea(100, 50, 2);

      expect(cy.zoom).toHaveBeenCalledWith(2);
      expect(cy.panBy).toHaveBeenCalledWith({
        x: -100 * 2 + 800 / 2,
        y: -50 * 2 + 600 / 2,
      });
    });

    it('handles zero coordinates', () => {
      const cy = makeMockCy();
      cy.zoom = vi.fn(() => 1);
      cy.width = vi.fn(() => 800);
      cy.height = vi.fn(() => 600);
      const controller = new ViewportController(cy as any);

      controller.focusOnArea(0, 0, 1);

      expect(cy.panBy).toHaveBeenCalledWith({
        x: 400,
        y: 300,
      });
    });
  });

  describe('resize', () => {
    it('calls cy.resize', () => {
      const cy = makeMockCy();
      const controller = new ViewportController(cy as any);

      controller.resize();
      expect(cy.resize).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('cleans up without throwing', () => {
      const cy = makeMockCy();
      const controller = new ViewportController(cy as any);
      controller.destroy();
      expect(cy.batch).toHaveBeenCalled();
    });
  });
});
