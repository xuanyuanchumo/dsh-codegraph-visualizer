import { describe, it, expect, vi } from 'vitest';
import { NodeId } from '../../src/types/index.ts';

function makeMockNode(id: string, data: Record<string, unknown> = {}) {
  const classes = new Set<string>();
  const dataMap = new Map<string, unknown>(Object.entries(data));
  const mockNode: any = {
    id: () => id,
    data: vi.fn((key: string, value?: unknown) => {
      if (value !== undefined) { dataMap.set(key, value); return undefined; }
      return dataMap.get(key);
    }),
    removeData: vi.fn((key: string) => dataMap.delete(key)),
    style: vi.fn(),
    addClass: vi.fn((cls: string) => classes.add(cls)),
    removeClass: vi.fn((cls: string) => classes.delete(cls)),
    toggleClass: vi.fn((cls: string, on: boolean) => { if (on) classes.add(cls); else classes.delete(cls); }),
    hasClass: vi.fn((cls: string) => classes.has(cls)),
    nonempty: vi.fn(() => true),
    empty: vi.fn(() => false),
    isNode: vi.fn(() => true),
    isEdge: vi.fn(() => false),
    position: vi.fn(() => ({ x: 0, y: 0 })),
    indegree: vi.fn(() => 0),
    outdegree: vi.fn(() => 0),
    degree: vi.fn(() => 0),
    connectedEdges: vi.fn(() => ({ forEach: vi.fn(), length: 0 })),
    neighborhood: vi.fn(() => ({ forEach: vi.fn(), length: 0 })),
    incomers: vi.fn(() => ({ forEach: vi.fn(), length: 0 })),
    outgoers: vi.fn(() => ({ forEach: vi.fn(), length: 0 })),
    _classes: classes,
    _dataMap: dataMap,
  };
  return mockNode;
}

function makeMockEdge(id: string, sourceId: string, targetId: string, data: Record<string, unknown> = {}) {
  const classes = new Set<string>();
  const dataMap = new Map<string, unknown>(Object.entries(data));
  const sourceNode = makeMockNode(sourceId);
  const targetNode = makeMockNode(targetId);
  return {
    id: () => id,
    source: () => sourceNode,
    target: () => targetNode,
    data: vi.fn((key: string, value?: unknown) => {
      if (value !== undefined) { dataMap.set(key, value); return undefined; }
      return dataMap.get(key);
    }),
    style: vi.fn(),
    addClass: vi.fn((cls: string) => classes.add(cls)),
    removeClass: vi.fn((cls: string) => classes.delete(cls)),
    toggleClass: vi.fn((cls: string, on: boolean) => { if (on) classes.add(cls); else classes.delete(cls); }),
    hasClass: vi.fn((cls: string) => classes.has(cls)),
    nonempty: vi.fn(() => true),
    empty: vi.fn(() => false),
    isNode: vi.fn(() => false),
    isEdge: vi.fn(() => true),
    connectedEdges: vi.fn(() => ({ forEach: vi.fn(), length: 0 })),
    _classes: classes,
    _sourceNode: sourceNode,
    _targetNode: targetNode,
  };
}

function makeMockCy(nodeList: any[] = [], edgeList: any[] = []) {
  const nodeMap = new Map<string, any>();
  const edgeMap = new Map<string, any>();
  for (const n of nodeList) nodeMap.set(n.id(), n);
  for (const e of edgeList) edgeMap.set(e.id(), e);

  const buildCollection = (items: any[]) => ({
    forEach: vi.fn((cb: (el: any) => void) => items.forEach(cb)),
    length: items.length,
    // cycle-146 T146-5：真实 cytoscape 集合契约含 empty()/animate()/stop()——
    // HighlightController.startCallChainFlow 依赖三者，mock 必须逐字对齐（fixture
    // 只允许转录真实契约，不允许省略被依赖的方法）。
    empty: vi.fn(() => items.length === 0),
    animate: vi.fn(function chain(this: any) { return this; }),
    stop: vi.fn(),
    filter: vi.fn((pred: (el: any) => boolean) => buildCollection(items.filter(pred))),
    addClass: vi.fn((cls: string) => items.forEach(el => el.addClass(cls))),
    removeClass: vi.fn((cls: string) => items.forEach(el => el.removeClass(cls))),
    boundingBox: vi.fn(() => ({ x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 })),
    layout: vi.fn(() => ({ run: vi.fn(), one: vi.fn() })),
  });

  let elementsList = [...nodeList, ...edgeList];

  const cy: any = {
    nodes: vi.fn(() => buildCollection(nodeList)),
    edges: vi.fn(() => buildCollection(edgeList)),
    elements: vi.fn((selector?: string) => {
      if (!selector) return buildCollection(elementsList);
      if (selector.includes('type="extend"') || selector.includes('type="implement"')) {
        const filtered = edgeList.filter(e => {
          const t = e.data('type');
          return t === 'extend' || t === 'implement';
        });
        return buildCollection(filtered);
      }
      if (selector.includes('type!=')) {
        const filtered = edgeList.filter(e => {
          const t = e.data('type');
          return t !== 'extend' && t !== 'implement';
        });
        return buildCollection(filtered);
      }
      return buildCollection(elementsList);
    }),
    batch: vi.fn((cb: () => void) => cb()),
    getElementById: vi.fn((id: string) => nodeMap.get(id) ?? edgeMap.get(id) ?? {
      nonempty: vi.fn(() => false),
      empty: vi.fn(() => true),
      length: 0,
      addClass: vi.fn(),
      removeClass: vi.fn(),
      data: vi.fn(),
    }),
    add: vi.fn(),
    remove: vi.fn(),
    json: vi.fn(() => ({ nodes: [], edges: [] })),
    _nodeMap: nodeMap,
    _edgeMap: edgeMap,
    _nodeList: nodeList,
    _edgeList: edgeList,
  };
  return cy;
}

describe('HighlightController', () => {
  it('highlightNodes adds highlighted class to specified nodes', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const cy = makeMockCy([nodeA, nodeB], []);
    const hc = new HighlightController(cy as any);
    hc.highlightNodes([NodeId('a'), NodeId('b')]);
    expect(nodeA.addClass).toHaveBeenCalledWith('highlighted');
    expect(nodeB.addClass).toHaveBeenCalledWith('highlighted');
  });

  it('highlightNodes removes highlighted class from previously highlighted nodes', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const cy = makeMockCy([nodeA, nodeB], []);
    const hc = new HighlightController(cy as any);
    hc.highlightNodes([NodeId('a'), NodeId('b')]);
    hc.highlightNodes([NodeId('a')]);
    expect(nodeB.removeClass).toHaveBeenCalledWith('highlighted');
  });

  it('highlightNodes highlights edges connected to highlighted nodes', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edge = makeMockEdge('e1', 'a', 'b');
    const cy = makeMockCy([nodeA, nodeB], [edge]);
    const hc = new HighlightController(cy as any);
    hc.highlightNodes([NodeId('a')]);
    expect(edge.toggleClass).toHaveBeenCalledWith('highlighted', true);
  });

  it('selectNode adds selected class', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const hc = new HighlightController(cy as any);
    hc.selectNode(NodeId('a'));
    expect(nodeA.addClass).toHaveBeenCalledWith('selected');
  });

  it('selectNode with null removes selected class from previously selected', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const hc = new HighlightController(cy as any);
    hc.selectNode(NodeId('a'));
    hc.selectNode(null);
    expect(nodeA.removeClass).toHaveBeenCalledWith('selected');
  });

  it('selectNode same node is a no-op', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const hc = new HighlightController(cy as any);
    hc.selectNode(NodeId('a'));
    const callCountBefore = nodeA.addClass.mock.calls.length;
    hc.selectNode(NodeId('a'));
    expect(nodeA.addClass.mock.calls.length).toBe(callCountBefore);
  });

  it('highlightCallChain adds call-chain class to node and outgoing edges', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edge = makeMockEdge('e1', 'a', 'b');
    edge.connectedEdges = vi.fn(() => ({
      forEach: (cb: (e: any) => void) => cb(edge),
    }));
    const cy = makeMockCy([nodeA, nodeB], [edge]);
    const hc = new HighlightController(cy as any);
    hc.highlightCallChain(NodeId('a'));
    expect(nodeA.addClass).toHaveBeenCalledWith('call-chain');
  });

  it('highlightCallChain with null clears call-chain classes', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const hc = new HighlightController(cy as any);
    hc.highlightCallChain(null);
    expect(nodeA.removeClass).toHaveBeenCalledWith('call-chain');
  });

  it('highlightInheritance with null clears inheritance classes', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const hc = new HighlightController(cy as any);
    hc.highlightInheritance(null);
    expect(nodeA.removeClass).toHaveBeenCalledWith('inheritance-highlight inheritance-dim inheritance-focus inheritance-extend inheritance-implement');
  });

  it('destroy clears highlightedNodeIds', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const cy = makeMockCy([], []);
    const hc = new HighlightController(cy as any);
    hc.highlightNodes([NodeId('a')]);
    hc.destroy();
    expect(cy.batch).toHaveBeenCalled();
  });

  describe('selectNode neighbor highlighting', () => {
    it('adds neighbor-dim to non-neighbor nodes when a node is selected', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB]);
      nodeA.neighborhood = vi.fn(() => ({
        forEach: (cb: (el: any) => void) => { cb(nodeB); },
        length: 1,
      }));
      const hc = new HighlightController(cy as any);
      hc.selectNode(NodeId('a'));
      expect(nodeC.addClass).toHaveBeenCalledWith('neighbor-dim');
    });

    it('adds neighbor-highlight to edges between selected node and neighbors', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      nodeA.neighborhood = vi.fn(() => ({
        forEach: (cb: (el: any) => void) => { cb(nodeB); },
        length: 1,
      }));
      const hc = new HighlightController(cy as any);
      hc.selectNode(NodeId('a'));
      expect(edgeAB.addClass).toHaveBeenCalledWith('neighbor-highlight');
    });

    it('clears neighbor-dim and neighbor-highlight when selectNode(null)', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const cy = makeMockCy([nodeA, nodeB], []);
      const hc = new HighlightController(cy as any);
      hc.selectNode(NodeId('a'));
      hc.selectNode(null);
      expect(nodeA.removeClass).toHaveBeenCalledWith('neighbor-highlight neighbor-dim');
    });
  });

  describe('highlightCallChain depth limit', () => {
    it('does not traverse beyond maxDepth', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      const edgeBC = makeMockEdge('e2', 'b', 'c');
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB, edgeBC]);
      nodeA.connectedEdges = vi.fn(() => ({
        forEach: (cb: (e: any) => void) => cb(edgeAB),
      }));
      nodeB.connectedEdges = vi.fn(() => ({
        forEach: (cb: (e: any) => void) => cb(edgeBC),
      }));
      const hc = new HighlightController(cy as any);
      hc.highlightCallChain(NodeId('a'), 0);
      expect(nodeA.addClass).toHaveBeenCalledWith('call-chain');
      expect(nodeB.addClass).not.toHaveBeenCalledWith('call-chain');
    });

    it('traverses to depth 1 when maxDepth=1', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      const edgeBC = makeMockEdge('e2', 'b', 'c');
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB, edgeBC]);
      nodeA.connectedEdges = vi.fn(() => ({
        forEach: (cb: (e: any) => void) => cb(edgeAB),
      }));
      nodeB.connectedEdges = vi.fn(() => ({
        forEach: (cb: (e: any) => void) => cb(edgeBC),
      }));
      const hc = new HighlightController(cy as any);
      hc.highlightCallChain(NodeId('a'), 1);
      expect(nodeA.addClass).toHaveBeenCalledWith('call-chain');
      expect(nodeB.addClass).toHaveBeenCalledWith('call-chain');
      expect(nodeC.addClass).not.toHaveBeenCalledWith('call-chain');
    });
  });

  describe('adjacency map caching', () => {
    it('invalidateCache does not throw', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const hc = new HighlightController(cy as any);
      hc.invalidateCache();
      hc.highlightNodes([NodeId('a')]);
      expect(cy.batch).toHaveBeenCalled();
    });

    it('highlightNodes works after invalidateCache', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edge = makeMockEdge('e1', 'a', 'b');
      const cy = makeMockCy([nodeA, nodeB], [edge]);
      const hc = new HighlightController(cy as any);
      hc.highlightNodes([NodeId('a')]);
      hc.invalidateCache();
      hc.highlightNodes([NodeId('b')]);
      expect(nodeB.addClass).toHaveBeenCalledWith('highlighted');
    });
  });

  describe('highlightInheritance with actual nodes', () => {
    it('adds inheritance-focus class to the focused node', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const extendEdge = makeMockEdge('e1', 'a', 'b', { type: 'extend' });
      const cy = makeMockCy([nodeA, nodeB], [extendEdge]);
      nodeA.outgoers = vi.fn(() => ({
        forEach: (cb: (e: any) => void) => cb(extendEdge),
      }));
      const hc = new HighlightController(cy as any);
      hc.highlightInheritance(NodeId('a'));
      expect(nodeA.addClass).toHaveBeenCalledWith('inheritance-focus');
    });

    it('clears all inheritance classes when highlightInheritance(null)', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const hc = new HighlightController(cy as any);
      hc.highlightInheritance(null);
      expect(nodeA.removeClass).toHaveBeenCalledWith('inheritance-highlight inheritance-dim inheritance-focus inheritance-extend inheritance-implement');
    });
  });

  // -----------------------------------------------------------------
  // T146-5：调用链边流动动画契约（cycle-146）
  // -----------------------------------------------------------------
  describe('call chain flow animation (cycle-146 T146-5)', () => {
    /** 让 makeMockCy.edges('.call-chain') 返回带 animate/stop 的可观察集合。 */
    function makeAnimatableEdgeCollection(edges: any[]) {
      const animate = vi.fn(function chain(this: any) {
        // cytoscape animate 返回同一集合以支持链式调用
        return this;
      });
      const stop = vi.fn();
      return {
        ...edges,
        empty: vi.fn(() => edges.length === 0),
        animate,
        stop,
        _animate: animate,
        _stop: stop,
      };
    }

    it('CFA-1 highlightCallChain with matching edges starts the flow animation', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      edgeAB.addClass('call-chain');
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      nodeA.connectedEdges = vi.fn(() => ({ forEach: (cb: (e: any) => void) => cb(edgeAB) }));
      // edges('.call-chain') 调用打桩：返回可动画集合
      const animCollection = makeAnimatableEdgeCollection([edgeAB]);
      cy.edges = vi.fn((selector?: string) =>
        selector === '.call-chain' ? animCollection : makeMockCy([nodeA, nodeB], [edgeAB]).edges(),
      );

      const hc = new HighlightController(cy as any);
      hc.highlightCallChain(NodeId('a'));
      expect(animCollection._animate).toHaveBeenCalled();
    });

    it('CFA-2 clear (null) after a real animation handle exists → stop(true) called', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      nodeA.connectedEdges = vi.fn(() => ({ forEach: (cb: (e: any) => void) => cb(edgeAB) }));
      const animCollection = makeAnimatableEdgeCollection([edgeAB]);
      cy.edges = vi.fn((selector?: string) =>
        selector === '.call-chain' ? animCollection : makeMockCy([nodeA, nodeB], [edgeAB]).edges(),
      );
      const hc = new HighlightController(cy as any);
      // 第一轮：建立动画句柄（有 call-chain 边）
      hc.highlightCallChain(NodeId('a'));
      expect(animCollection._animate).toHaveBeenCalled();
      // 第二轮：清空 → 旧句柄必须 stop
      hc.highlightCallChain(null);
      expect(animCollection._stop).toHaveBeenCalledWith(true);
    });

    it('CFA-3 re-highlight on another node stops the previous animation first (no RAF leak)', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      nodeA.connectedEdges = vi.fn(() => ({ forEach: (cb: (e: any) => void) => cb(edgeAB) }));
      nodeB.connectedEdges = vi.fn(() => ({ forEach: (cb: (e: any) => void) => cb(edgeAB) }));
      const animCollection = makeAnimatableEdgeCollection([edgeAB]);
      cy.edges = vi.fn((selector?: string) =>
        selector === '.call-chain' ? animCollection : makeMockCy([nodeA, nodeB], [edgeAB]).edges(),
      );
      const hc = new HighlightController(cy as any);
      hc.highlightCallChain(NodeId('a'));
      expect(animCollection._stop).not.toHaveBeenCalled();
      hc.highlightCallChain(NodeId('b'));
      // 换节点时旧动画必须先停（句柄生命周期与新边集合对齐）
      expect(animCollection._stop).toHaveBeenCalledWith(true);
    });

    it('CFA-4 empty call-chain set does not create an animation handle', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const animCollection = makeAnimatableEdgeCollection([]);
      cy.edges = vi.fn((selector?: string) =>
        selector === '.call-chain' ? animCollection : makeMockCy([nodeA], []).edges(selector),
      );
      const hc = new HighlightController(cy as any);
      hc.highlightCallChain(NodeId('a'));
      // 空集合：animate 不得被调用（句柄只在真有边时存在）
      expect(animCollection._animate).not.toHaveBeenCalled();
    });
  });
});
