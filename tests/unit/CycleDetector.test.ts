import { describe, it, expect, vi } from 'vitest';

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

describe('CycleDetector', () => {
  it('detectCycles returns empty set when no cycles', async () => {
    const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edge = makeMockEdge('e1', 'a', 'b');
    const cy = makeMockCy([nodeA, nodeB], [edge]);
    const cd = new CycleDetector(cy as any);
    const cycles = cd.detectCycles();
    expect(cycles.size).toBe(0);
  });

  it('detectCycles finds a simple cycle', async () => {
    const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edgeAB = makeMockEdge('e1', 'a', 'b');
    const edgeBA = makeMockEdge('e2', 'b', 'a');
    const cy = makeMockCy([nodeA, nodeB], [edgeAB, edgeBA]);
    const cd = new CycleDetector(cy as any);
    const cycles = cd.detectCycles();
    expect(cycles.size).toBeGreaterThan(0);
    expect(cycles.has('a')).toBe(true);
    expect(cycles.has('b')).toBe(true);
  });

  it('detectCycles finds self-loop', async () => {
    const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
    const nodeA = makeMockNode('a');
    const edgeSelf = makeMockEdge('e1', 'a', 'a');
    const cy = makeMockCy([nodeA], [edgeSelf]);
    const cd = new CycleDetector(cy as any);
    const cycles = cd.detectCycles();
    expect(cycles.has('a')).toBe(true);
  });

  it('highlightCycles adds cycle-highlight class to cycle nodes', async () => {
    const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const cy = makeMockCy([nodeA, nodeB], []);
    const cd = new CycleDetector(cy as any);
    cd.highlightCycles(new Set(['a', 'b']));
    expect(nodeA.addClass).toHaveBeenCalledWith('cycle-highlight');
    expect(nodeB.addClass).toHaveBeenCalledWith('cycle-highlight');
  });

  it('isolateCycles adds cycle-hidden class to non-cycle nodes', async () => {
    const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const nodeC = makeMockNode('c');
    const edgeAB = makeMockEdge('e1', 'a', 'b');
    const edgeAC = makeMockEdge('e2', 'a', 'c');
    const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB, edgeAC]);
    const cd = new CycleDetector(cy as any);
    cd.isolateCycles(new Set(['a', 'b']));
    expect(nodeC.addClass).toHaveBeenCalledWith('cycle-hidden');
    expect(edgeAC.addClass).toHaveBeenCalledWith('cycle-hidden');
  });

  it('isolateCycles does not hide cycle nodes or edges between cycle nodes', async () => {
    const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edgeAB = makeMockEdge('e1', 'a', 'b');
    const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
    const cd = new CycleDetector(cy as any);
    cd.isolateCycles(new Set(['a', 'b']));
    expect(nodeA.addClass).not.toHaveBeenCalledWith('cycle-hidden');
    expect(nodeB.addClass).not.toHaveBeenCalledWith('cycle-hidden');
    expect(edgeAB.addClass).not.toHaveBeenCalledWith('cycle-hidden');
  });

  it('restoreIsolation removes cycle-hidden class from all elements', async () => {
    const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const cy = makeMockCy([nodeA, nodeB], []);
    const cd = new CycleDetector(cy as any);
    cd.restoreIsolation();
    expect(nodeA.removeClass).toHaveBeenCalledWith('cycle-hidden');
    expect(nodeB.removeClass).toHaveBeenCalledWith('cycle-hidden');
  });

  describe('detectCyclesDetailed', () => {
    it('returns empty array when no cycles', async () => {
      const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edge = makeMockEdge('e1', 'a', 'b');
      const cy = makeMockCy([nodeA, nodeB], [edge]);
      const cd = new CycleDetector(cy as any);
      const cycles = cd.detectCyclesDetailed();
      expect(cycles.length).toBe(0);
    });

    it('finds a simple two-node cycle with nodes and edges', async () => {
      const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      const edgeBA = makeMockEdge('e2', 'b', 'a');
      const cy = makeMockCy([nodeA, nodeB], [edgeAB, edgeBA]);
      const cd = new CycleDetector(cy as any);
      const cycles = cd.detectCyclesDetailed();
      expect(cycles.length).toBeGreaterThan(0);
      const firstCycle = cycles[0]!;
      expect(firstCycle.length).toBeGreaterThanOrEqual(2);
      expect(firstCycle.nodes).toContain('a');
      expect(firstCycle.nodes).toContain('b');
      expect(firstCycle.edges.length).toBeGreaterThan(0);
    });

    it('finds a self-loop cycle', async () => {
      const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
      const nodeA = makeMockNode('a');
      const edgeSelf = makeMockEdge('e1', 'a', 'a');
      const cy = makeMockCy([nodeA], [edgeSelf]);
      const cd = new CycleDetector(cy as any);
      const cycles = cd.detectCyclesDetailed();
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0]!.nodes).toContain('a');
    });

    it('deduplicates cycles with same nodes', async () => {
      const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const edgeAB = makeMockEdge('e1', 'a', 'b');
      const edgeBC = makeMockEdge('e2', 'b', 'c');
      const edgeCA = makeMockEdge('e3', 'c', 'a');
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB, edgeBC, edgeCA]);
      const cd = new CycleDetector(cy as any);
      const cycles = cd.detectCyclesDetailed();
      const uniqueKeys = new Set(cycles.map(c => [...c.nodes].sort().join('|')));
      expect(uniqueKeys.size).toBe(cycles.length);
    });
  });

  describe('relayoutCycles', () => {
    it('calls layout with circle name on cycle nodes', async () => {
      const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const nodeC = makeMockNode('c');
      const cy = makeMockCy([nodeA, nodeB, nodeC], []);
      const cd = new CycleDetector(cy as any);
      cd.relayoutCycles(new Set(['a', 'b']));
      const nodesCollection = cy.nodes.mock.results[0].value;
      const filteredCollection = nodesCollection.filter.mock.results[0].value;
      expect(filteredCollection.layout).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'circle' }),
      );
    });

    it('does nothing when cycleIds is empty', async () => {
      const { CycleDetector } = await import('../../src/client/renderer/CycleDetector.ts');
      const nodeA = makeMockNode('a');
      const cy = makeMockCy([nodeA], []);
      const cd = new CycleDetector(cy as any);
      cd.relayoutCycles(new Set());
      expect(cy.nodes).not.toHaveBeenCalled();
    });
  });
});