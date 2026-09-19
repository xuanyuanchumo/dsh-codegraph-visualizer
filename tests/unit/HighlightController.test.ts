import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeId } from '../../src/types/index.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';

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
    filter: vi.fn((pred: (el: any) => boolean) => items.filter(pred)),
    addClass: vi.fn((cls: string) => items.forEach(el => el.addClass(cls))),
    removeClass: vi.fn((cls: string) => items.forEach(el => el.removeClass(cls))),
    boundingBox: vi.fn(() => ({ x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 })),
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
    add: vi.fn((spec: any) => {
      if (spec.group === 'nodes') {
        const node = makeMockNode(spec.data.id, spec.data);
        nodeMap.set(spec.data.id, node);
        nodeList.push(node);
        elementsList.push(node);
      } else if (spec.group === 'edges') {
        const edge = makeMockEdge(spec.data.id, spec.data.source, spec.data.target, spec.data);
        edgeMap.set(spec.data.id, edge);
        edgeList.push(edge);
        elementsList.push(edge);
      }
    }),
    remove: vi.fn((els: any) => {
      if (Array.isArray(els)) {
        els.forEach(el => {
          nodeMap.delete(el.id());
          edgeMap.delete(el.id());
        });
      } else if (els && els.id) {
        nodeMap.delete(els.id());
        edgeMap.delete(els.id());
      }
    }),
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

  it('detectCycles returns empty set when no cycles', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edge = makeMockEdge('e1', 'a', 'b');
    const cy = makeMockCy([nodeA, nodeB], [edge]);
    const hc = new HighlightController(cy as any);
    const cycles = hc.detectCycles();
    expect(cycles.size).toBe(0);
  });

  it('detectCycles finds a simple cycle', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edgeAB = makeMockEdge('e1', 'a', 'b');
    const edgeBA = makeMockEdge('e2', 'b', 'a');
    const cy = makeMockCy([nodeA, nodeB], [edgeAB, edgeBA]);
    const hc = new HighlightController(cy as any);
    const cycles = hc.detectCycles();
    expect(cycles.size).toBeGreaterThan(0);
    expect(cycles.has('a')).toBe(true);
    expect(cycles.has('b')).toBe(true);
  });

  it('detectCycles finds self-loop', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const edgeSelf = makeMockEdge('e1', 'a', 'a');
    const cy = makeMockCy([nodeA], [edgeSelf]);
    const hc = new HighlightController(cy as any);
    const cycles = hc.detectCycles();
    expect(cycles.has('a')).toBe(true);
  });

  it('highlightCycles adds cycle-highlight class to cycle nodes', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const cy = makeMockCy([nodeA, nodeB], []);
    const hc = new HighlightController(cy as any);
    hc.highlightCycles(new Set(['a', 'b']));
    expect(nodeA.addClass).toHaveBeenCalledWith('cycle-highlight');
    expect(nodeB.addClass).toHaveBeenCalledWith('cycle-highlight');
  });

  it('isolateCycles adds cycle-hidden class to non-cycle nodes', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const nodeC = makeMockNode('c');
    const edgeAB = makeMockEdge('e1', 'a', 'b');
    const edgeAC = makeMockEdge('e2', 'a', 'c');
    const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB, edgeAC]);
    const hc = new HighlightController(cy as any);
    hc.isolateCycles(new Set(['a', 'b']));
    expect(nodeC.addClass).toHaveBeenCalledWith('cycle-hidden');
    expect(edgeAC.addClass).toHaveBeenCalledWith('cycle-hidden');
  });

  it('isolateCycles does not hide cycle nodes or edges between cycle nodes', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edgeAB = makeMockEdge('e1', 'a', 'b');
    const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
    const hc = new HighlightController(cy as any);
    hc.isolateCycles(new Set(['a', 'b']));
    expect(nodeA.addClass).not.toHaveBeenCalledWith('cycle-hidden');
    expect(nodeB.addClass).not.toHaveBeenCalledWith('cycle-hidden');
    expect(edgeAB.addClass).not.toHaveBeenCalledWith('cycle-hidden');
  });

  it('restoreIsolation removes cycle-hidden class from all elements', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const cy = makeMockCy([nodeA, nodeB], []);
    const hc = new HighlightController(cy as any);
    hc.restoreIsolation();
    expect(nodeA.removeClass).toHaveBeenCalledWith('cycle-hidden');
    expect(nodeB.removeClass).toHaveBeenCalledWith('cycle-hidden');
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

  it('getImpactStats returns null for non-existent node', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const cy = makeMockCy([], []);
    const hc = new HighlightController(cy as any);
    expect(hc.getImpactStats(NodeId('nonexistent'))).toBeNull();
  });

  it('getImpactStats returns stats for existing node', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const hc = new HighlightController(cy as any);
    const stats = hc.getImpactStats(NodeId('a'));
    expect(stats).not.toBeNull();
    expect(stats!.total).toBeGreaterThanOrEqual(0);
  });

  it('highlightImpact with null clears impact classes', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const hc = new HighlightController(cy as any);
    hc.highlightImpact(null);
    expect(nodeA.removeClass).toHaveBeenCalledWith('impact-d1 impact-d2 impact-d3 impact-source');
  });

  it('highlightImpact adds impact-source class to source node', async () => {
    const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const hc = new HighlightController(cy as any);
    hc.highlightImpact(NodeId('a'));
    expect(nodeA.addClass).toHaveBeenCalledWith('impact-source');
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
    expect(() => hc.destroy()).not.toThrow();
  });

  describe('detectCyclesDetailed', () => {
    it('returns empty array when no cycles', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edge = makeMockEdge('e1', 'a', 'b');
      const cy = makeMockCy([nodeA, nodeB], [edge]);
      const hc = new HighlightController(cy as any);
      const cycles = hc.detectCyclesDetailed();
      expect(cycles.length).toBe(0);
    });

    it('finds a simple two-node cycle with nodes and edges', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      const edgeBA = makeMockEdge('e2', 'b', 'a');
      const cy = makeMockCy([nodeA, nodeB], [edgeAB, edgeBA]);
      const hc = new HighlightController(cy as any);
      const cycles = hc.detectCyclesDetailed();
      expect(cycles.length).toBeGreaterThan(0);
      const firstCycle = cycles[0]!;
      expect(firstCycle.length).toBeGreaterThanOrEqual(2);
      expect(firstCycle.nodes).toContain('a');
      expect(firstCycle.nodes).toContain('b');
      expect(firstCycle.edges.length).toBeGreaterThan(0);
    });

    it('finds a self-loop cycle', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const edgeSelf = makeMockEdge('e1', 'a', 'a');
      const cy = makeMockCy([nodeA], [edgeSelf]);
      const hc = new HighlightController(cy as any);
      const cycles = hc.detectCyclesDetailed();
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0]!.nodes).toContain('a');
    });

    it('deduplicates cycles with same nodes', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      const edgeBC = makeMockEdge('e2', 'b', 'c');
      const edgeCA = makeMockEdge('e3', 'c', 'a');
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB, edgeBC, edgeCA]);
      const hc = new HighlightController(cy as any);
      const cycles = hc.detectCyclesDetailed();
      const uniqueKeys = new Set(cycles.map(c => [...c.nodes].sort().join('|')));
      expect(uniqueKeys.size).toBe(cycles.length);
    });
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

  describe('highlightImpact with actual impact nodes', () => {
    it('adds impact-d1 class to direct callers', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeBA = makeMockEdge('e1', 'b', 'a');
      const cy = makeMockCy([nodeA, nodeB], [edgeBA]);
      nodeA.incomers = vi.fn(() => ({
        forEach: (cb: (e: any) => void) => { cb(edgeBA); },
      }));
      const hc = new HighlightController(cy as any);
      hc.highlightImpact(NodeId('a'));
      expect(nodeA.addClass).toHaveBeenCalledWith('impact-source');
      expect(nodeB.addClass).toHaveBeenCalledWith('impact-d1');
    });

    it('getImpactStats returns d1 count for direct callers', async () => {
      const { HighlightController } = await import('../../src/client/renderer/HighlightController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeBA = makeMockEdge('e1', 'b', 'a');
      const cy = makeMockCy([nodeA, nodeB], [edgeBA]);
      nodeA.incomers = vi.fn(() => ({
        forEach: (cb: (e: any) => void) => { cb(edgeBA); },
      }));
      const hc = new HighlightController(cy as any);
      const stats = hc.getImpactStats(NodeId('a'));
      expect(stats).not.toBeNull();
      expect(stats!.d1).toBeGreaterThanOrEqual(1);
      expect(stats!.total).toBeGreaterThanOrEqual(1);
    });
  });
});