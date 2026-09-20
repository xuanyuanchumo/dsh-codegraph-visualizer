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

describe('ImpactAnalyzer', () => {
  it('getImpactStats returns null for non-existent node', async () => {
    const { ImpactAnalyzer } = await import('../../src/client/renderer/ImpactAnalyzer.ts');
    const cy = makeMockCy([], []);
    const ia = new ImpactAnalyzer(cy as any);
    expect(ia.getImpactStats(NodeId('nonexistent'))).toBeNull();
  });

  it('getImpactStats returns stats for existing node', async () => {
    const { ImpactAnalyzer } = await import('../../src/client/renderer/ImpactAnalyzer.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const ia = new ImpactAnalyzer(cy as any);
    const stats = ia.getImpactStats(NodeId('a'));
    expect(stats).not.toBeNull();
    expect(stats!.total).toBeGreaterThanOrEqual(0);
  });

  it('highlightImpact with null clears impact classes', async () => {
    const { ImpactAnalyzer } = await import('../../src/client/renderer/ImpactAnalyzer.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const ia = new ImpactAnalyzer(cy as any);
    ia.highlightImpact(null);
    expect(nodeA.removeClass).toHaveBeenCalledWith('impact-d1 impact-d2 impact-d3 impact-source');
  });

  it('highlightImpact adds impact-source class to source node', async () => {
    const { ImpactAnalyzer } = await import('../../src/client/renderer/ImpactAnalyzer.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const ia = new ImpactAnalyzer(cy as any);
    ia.highlightImpact(NodeId('a'));
    expect(nodeA.addClass).toHaveBeenCalledWith('impact-source');
  });

  it('adds impact-d1 class to direct callers', async () => {
    const { ImpactAnalyzer } = await import('../../src/client/renderer/ImpactAnalyzer.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edgeBA = makeMockEdge('e1', 'b', 'a');
    const cy = makeMockCy([nodeA, nodeB], [edgeBA]);
    nodeA.incomers = vi.fn(() => ({
      forEach: (cb: (e: any) => void) => { cb(edgeBA); },
    }));
    const ia = new ImpactAnalyzer(cy as any);
    ia.highlightImpact(NodeId('a'));
    expect(nodeA.addClass).toHaveBeenCalledWith('impact-source');
    expect(nodeB.addClass).toHaveBeenCalledWith('impact-d1');
  });

  it('getImpactStats returns d1 count for direct callers', async () => {
    const { ImpactAnalyzer } = await import('../../src/client/renderer/ImpactAnalyzer.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edgeBA = makeMockEdge('e1', 'b', 'a');
    const cy = makeMockCy([nodeA, nodeB], [edgeBA]);
    nodeA.incomers = vi.fn(() => ({
      forEach: (cb: (e: any) => void) => { cb(edgeBA); },
    }));
    const ia = new ImpactAnalyzer(cy as any);
    const stats = ia.getImpactStats(NodeId('a'));
    expect(stats).not.toBeNull();
    expect(stats!.d1).toBeGreaterThanOrEqual(1);
    expect(stats!.total).toBeGreaterThanOrEqual(1);
  });
});