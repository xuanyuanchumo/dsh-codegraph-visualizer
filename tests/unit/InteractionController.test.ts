import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractionController, type InteractionCallbacks } from '../../src/client/renderer/InteractionController.ts';

function makeMockNode(id: string) {
  const classes = new Set<string>();
  return {
    id: () => id,
    addClass: vi.fn((cls: string) => classes.add(cls)),
    removeClass: vi.fn((cls: string) => classes.delete(cls)),
    hasClass: vi.fn((cls: string) => classes.has(cls)),
    renderedPosition: vi.fn(() => ({ x: 10, y: 20 })),
    _classes: classes,
  };
}

function makeMockEdge(id: string) {
  const classes = new Set<string>();
  return {
    id: () => id,
    addClass: vi.fn((cls: string) => classes.add(cls)),
    removeClass: vi.fn((cls: string) => classes.delete(cls)),
    hasClass: vi.fn((cls: string) => classes.has(cls)),
    renderedMidpoint: vi.fn(() => ({ x: 50, y: 60 })),
    _classes: classes,
  };
}

function makeMockCy(nodeList: any[] = [], edgeList: any[] = []) {
  const handlers: Record<string, Function[]> = {};
  const nodeCollection = {
    forEach: vi.fn((cb: (n: any) => void) => nodeList.forEach(cb)),
    removeClass: vi.fn((cls: string) => nodeList.forEach(n => n.removeClass(cls))),
  };
  const edgeCollection = {
    forEach: vi.fn((cb: (e: any) => void) => edgeList.forEach(cb)),
    removeClass: vi.fn((cls: string) => edgeList.forEach(e => e.removeClass(cls))),
  };
  return {
    on: vi.fn((event: string, selector: string, handler: Function) => {
      const key = `${event}:${selector}`;
      if (!handlers[key]) handlers[key] = [];
      handlers[key].push(handler);
    }),
    off: vi.fn((event: string, selector: string) => {
      const key = `${event}:${selector}`;
      delete handlers[key];
    }),
    nodes: vi.fn(() => nodeCollection),
    edges: vi.fn(() => edgeCollection),
    _handlers: handlers,
    _nodeList: nodeList,
    _edgeList: edgeList,
  };
}

function makeCallbacks(): InteractionCallbacks {
  return {
    onNodeTap: vi.fn(),
    onEdgeTap: vi.fn(),
    onNodeDoubleTap: vi.fn(),
    onNodeHover: vi.fn(),
    onNodeHoverOut: vi.fn(),
    onEdgeHover: vi.fn(),
    onEdgeHoverOut: vi.fn(),
    onNodeContextTap: vi.fn(),
  };
}

describe('InteractionController', () => {
  describe('constructor', () => {
    it('constructs without throwing', () => {
      const cy = makeMockCy();
      const callbacks = makeCallbacks();
      expect(() => new InteractionController(cy as any, callbacks)).not.toThrow();
    });

    it('binds all event handlers on construction', () => {
      const cy = makeMockCy();
      const callbacks = makeCallbacks();
      new InteractionController(cy as any, callbacks);
      const expectedEvents: [string, string][] = [
        ['tap', 'node'], ['tap', 'edge'], ['dbltap', 'node'],
        ['mouseover', 'node'], ['mouseout', 'node'],
        ['mouseover', 'edge'], ['mouseout', 'edge'],
        ['cxttap', 'node'],
      ];
      for (const [evt, sel] of expectedEvents) {
        expect(cy.on).toHaveBeenCalledWith(evt, sel, expect.any(Function));
      }
    });
  });

  describe('event handling', () => {
    it('calls onNodeTap when node is tapped', () => {
      const cy = makeMockCy();
      const callbacks = makeCallbacks();
      new InteractionController(cy as any, callbacks);
      const handler = cy._handlers['tap:node'][0];
      const mockNode = makeMockNode('node1');
      handler({ target: mockNode });
      expect(callbacks.onNodeTap).toHaveBeenCalledWith('node1');
    });

    it('calls onEdgeTap with rendered midpoint', () => {
      const cy = makeMockCy();
      const callbacks = makeCallbacks();
      new InteractionController(cy as any, callbacks);
      const handler = cy._handlers['tap:edge'][0];
      const mockEdge = makeMockEdge('edge1');
      handler({ target: mockEdge });
      expect(callbacks.onEdgeTap).toHaveBeenCalledWith('edge1', { x: 50, y: 60 });
    });

    it('calls onNodeDoubleTap on dbltap', () => {
      const cy = makeMockCy();
      const callbacks = makeCallbacks();
      new InteractionController(cy as any, callbacks);
      const handler = cy._handlers['dbltap:node'][0];
      const mockNode = makeMockNode('node2');
      handler({ target: mockNode });
      expect(callbacks.onNodeDoubleTap).toHaveBeenCalledWith('node2');
    });

    it('adds hovered class and calls onNodeHover on mouseover', () => {
      const cy = makeMockCy();
      const callbacks = makeCallbacks();
      new InteractionController(cy as any, callbacks);
      const handler = cy._handlers['mouseover:node'][0];
      const mockNode = makeMockNode('node3');
      handler({ target: mockNode });
      expect(mockNode.addClass).toHaveBeenCalledWith('hovered');
      expect(callbacks.onNodeHover).toHaveBeenCalledWith('node3', { x: 10, y: 20 });
    });

    it('removes hovered class and calls onNodeHoverOut on mouseout', () => {
      const cy = makeMockCy();
      const callbacks = makeCallbacks();
      new InteractionController(cy as any, callbacks);
      const handler = cy._handlers['mouseout:node'][0];
      const mockNode = makeMockNode('node4');
      handler({ target: mockNode });
      expect(mockNode.removeClass).toHaveBeenCalledWith('hovered');
      expect(callbacks.onNodeHoverOut).toHaveBeenCalled();
    });

    it('adds hovered class and calls onEdgeHover on edge mouseover', () => {
      const cy = makeMockCy();
      const callbacks = makeCallbacks();
      new InteractionController(cy as any, callbacks);
      const handler = cy._handlers['mouseover:edge'][0];
      const mockEdge = makeMockEdge('edge2');
      handler({ target: mockEdge });
      expect(mockEdge.addClass).toHaveBeenCalledWith('hovered');
      expect(callbacks.onEdgeHover).toHaveBeenCalledWith('edge2', { x: 50, y: 60 });
    });

    it('removes hovered class and calls onEdgeHoverOut on edge mouseout', () => {
      const cy = makeMockCy();
      const callbacks = makeCallbacks();
      new InteractionController(cy as any, callbacks);
      const handler = cy._handlers['mouseout:edge'][0];
      const mockEdge = makeMockEdge('edge3');
      handler({ target: mockEdge });
      expect(mockEdge.removeClass).toHaveBeenCalledWith('hovered');
      expect(callbacks.onEdgeHoverOut).toHaveBeenCalled();
    });

    it('calls onNodeContextTap on cxttap', () => {
      const cy = makeMockCy();
      const callbacks = makeCallbacks();
      new InteractionController(cy as any, callbacks);
      const handler = cy._handlers['cxttap:node'][0];
      const mockNode = makeMockNode('node5');
      handler({ target: mockNode });
      expect(callbacks.onNodeContextTap).toHaveBeenCalledWith('node5', { x: 10, y: 20 });
    });
  });

  describe('optional callbacks', () => {
    it('does not throw when optional callbacks are not provided', () => {
      const cy = makeMockCy();
      const callbacks: InteractionCallbacks = {};
      new InteractionController(cy as any, callbacks);
      const handler = cy._handlers['tap:node'][0];
      const mockNode = makeMockNode('node6');
      expect(() => handler({ target: mockNode })).not.toThrow();
    });
  });

  describe('updateCallbacks', () => {
    it('replaces callbacks with new ones', () => {
      const cy = makeMockCy();
      const callbacks1 = makeCallbacks();
      const ctrl = new InteractionController(cy as any, callbacks1);
      const callbacks2 = makeCallbacks();
      ctrl.updateCallbacks(callbacks2);
      const handler = cy._handlers['tap:node'][0];
      const mockNode = makeMockNode('node7');
      handler({ target: mockNode });
      expect(callbacks2.onNodeTap).toHaveBeenCalledWith('node7');
      expect(callbacks1.onNodeTap).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('removes all event handlers', () => {
      const cy = makeMockCy();
      const callbacks = makeCallbacks();
      const ctrl = new InteractionController(cy as any, callbacks);
      ctrl.destroy();
      const expectedEvents = [
        ['tap', 'node'], ['tap', 'edge'], ['dbltap', 'node'],
        ['mouseover', 'node'], ['mouseout', 'node'],
        ['mouseover', 'edge'], ['mouseout', 'edge'],
        ['cxttap', 'node'],
      ];
      for (const [evt, sel] of expectedEvents) {
        expect(cy.off).toHaveBeenCalledWith(evt, sel);
      }
    });

    it('removes hovered class from all nodes and edges', () => {
      const mockNode = makeMockNode('n1');
      const mockEdge = makeMockEdge('e1');
      const cy = makeMockCy([mockNode], [mockEdge]);
      const callbacks = makeCallbacks();
      const ctrl = new InteractionController(cy as any, callbacks);
      ctrl.destroy();
      expect(mockNode.removeClass).toHaveBeenCalledWith('hovered');
      expect(mockEdge.removeClass).toHaveBeenCalledWith('hovered');
    });

    it('does not throw when destroy called twice', () => {
      const cy = makeMockCy();
      const callbacks = makeCallbacks();
      const ctrl = new InteractionController(cy as any, callbacks);
      ctrl.destroy();
      expect(() => ctrl.destroy()).not.toThrow();
    });
  });
});