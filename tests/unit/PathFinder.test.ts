import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeId } from '../../src/types/index.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';

function makeMockNode(id: string, data: Record<string, unknown> = {}) {
  const classes = new Set<string>();
  const dataMap = new Map<string, unknown>(Object.entries(data));
  return {
    id: () => id,
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
    isNode: vi.fn(() => true),
    isEdge: vi.fn(() => false),
    position: vi.fn(() => ({ x: 0, y: 0 })),
    _classes: classes,
  };
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
    _classes: classes,
  };
}

function makeMockCy(nodeList: any[] = [], edgeList: any[] = []) {
  const nodeMap = new Map<string, any>();
  const edgeMap = new Map<string, any>();
  for (const n of nodeList) nodeMap.set(n.id(), n);
  for (const e of edgeList) edgeMap.set(e.id(), e);

  const nodesCollection = {
    forEach: vi.fn((cb: (n: any) => void) => nodeList.forEach(cb)),
    length: nodeList.length,
    filter: vi.fn((pred: (n: any) => boolean) => nodeList.filter(pred)),
    boundingBox: vi.fn(() => ({ x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 })),
  };
  const edgesCollection = {
    forEach: vi.fn((cb: (e: any) => void) => edgeList.forEach(cb)),
    length: edgeList.length,
    filter: vi.fn((pred: (e: any) => boolean) => edgeList.filter(pred)),
  };
  const elementsCollection = {
    forEach: vi.fn((cb: (el: any) => void) => [...nodeList, ...edgeList].forEach(cb)),
    length: nodeList.length + edgeList.length,
    removeClass: vi.fn((cls: string) => { [...nodeList, ...edgeList].forEach(el => el.removeClass(cls)); }),
    dijkstra: vi.fn(() => ({
      pathTo: vi.fn((target: any) => {
        const sourceId = nodeList[0]?.id();
        const targetId = target.id();
        if (sourceId === targetId) return [nodeList[0]];
        const edge = edgeList.find(e => e.source().id() === sourceId && e.target().id() === targetId);
        if (edge) return [nodeList[0], target];
        return [];
      }),
    })),
  };

  return {
    nodes: vi.fn(() => nodesCollection),
    edges: vi.fn(() => edgesCollection),
    elements: vi.fn(() => elementsCollection),
    batch: vi.fn((cb: () => void) => cb()),
    getElementById: vi.fn((id: string) => nodeMap.get(id) ?? edgeMap.get(id) ?? {
      nonempty: vi.fn(() => false),
      empty: vi.fn(() => true),
      length: 0,
    }),
    add: vi.fn(),
    remove: vi.fn(),
    json: vi.fn(() => ({ nodes: [], edges: [] })),
    png: vi.fn(() => 'data:image/png;base64,mock'),
    _nodeMap: nodeMap,
    _edgeMap: edgeMap,
  };
}

function makeGraphNode(id: string, label = id, type: GraphNode['type'] = 'function'): GraphNode {
  return { id: NodeId(id), label, type, filePath: `/test/${id}.ts`, properties: {} };
}

function makeGraphEdge(id: string, source: string, target: string, type: GraphEdge['type'] = 'call'): GraphEdge {
  return { id: NodeId(id) as any, source: NodeId(source), target: NodeId(target), type, properties: {} };
}

describe('PathFinder', () => {
  it('findPath returns null when source node does not exist', async () => {
    const { PathFinder } = await import('../../src/client/renderer/PathFinder.ts');
    const target = makeMockNode('b');
    const cy = makeMockCy([target], []);
    const pf = new PathFinder(cy as any);
    expect(pf.findPath(NodeId('nonexistent'), NodeId('b'))).toBeNull();
  });

  it('findPath returns null when target node does not exist', async () => {
    const { PathFinder } = await import('../../src/client/renderer/PathFinder.ts');
    const source = makeMockNode('a');
    const cy = makeMockCy([source], []);
    const pf = new PathFinder(cy as any);
    expect(pf.findPath(NodeId('a'), NodeId('nonexistent'))).toBeNull();
  });

  it('findPath returns null when node count exceeds 10000', async () => {
    const { PathFinder } = await import('../../src/client/renderer/PathFinder.ts');
    const bigList = Array.from({ length: 10001 }, (_, i) => makeMockNode(`n${i}`));
    const cy = makeMockCy(bigList, []);
    const pf = new PathFinder(cy as any);
    expect(pf.findPath(NodeId('n0'), NodeId('n1'))).toBeNull();
  });

  it('findPath returns path result when path exists', async () => {
    const { PathFinder } = await import('../../src/client/renderer/PathFinder.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edge = makeMockEdge('e1', 'a', 'b');
    const cy = makeMockCy([nodeA, nodeB], [edge]);
    const pf = new PathFinder(cy as any);
    const result = pf.findPath(NodeId('a'), NodeId('b'));
    expect(result).not.toBeNull();
    expect(result!.source).toBe(NodeId('a'));
    expect(result!.target).toBe(NodeId('b'));
    expect(result!.path.length).toBeGreaterThanOrEqual(2);
    expect(result!.length).toBe(result!.path.length - 1);
  });

  it('findPath returns null when no path exists', async () => {
    const { PathFinder } = await import('../../src/client/renderer/PathFinder.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const cy = makeMockCy([nodeA, nodeB], []);
    const pf = new PathFinder(cy as any);
    expect(pf.findPath(NodeId('a'), NodeId('b'))).toBeNull();
  });

  it('highlightPath adds path-highlight class to path nodes', async () => {
    const { PathFinder } = await import('../../src/client/renderer/PathFinder.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const nodeC = makeMockNode('c');
    const edgeAB = makeMockEdge('e1', 'a', 'b');
    const edgeBC = makeMockEdge('e2', 'b', 'c');
    const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB, edgeBC]);
    const pf = new PathFinder(cy as any);
    pf.highlightPath([NodeId('a'), NodeId('b'), NodeId('c')]);
    expect(nodeA.addClass).toHaveBeenCalledWith('path-highlight');
    expect(nodeB.addClass).toHaveBeenCalledWith('path-highlight');
    expect(nodeC.addClass).toHaveBeenCalledWith('path-highlight');
  });

  it('highlightPath with null clears all path classes', async () => {
    const { PathFinder } = await import('../../src/client/renderer/PathFinder.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const pf = new PathFinder(cy as any);
    pf.highlightPath(null);
    expect(nodeA.removeClass).toHaveBeenCalledWith('path-highlight path-dim');
  });

  it('highlightPath with empty array clears all path classes', async () => {
    const { PathFinder } = await import('../../src/client/renderer/PathFinder.ts');
    const nodeA = makeMockNode('a');
    const cy = makeMockCy([nodeA], []);
    const pf = new PathFinder(cy as any);
    pf.highlightPath([]);
    expect(nodeA.removeClass).toHaveBeenCalledWith('path-highlight path-dim');
  });

  it('highlightPath dims non-path nodes', async () => {
    const { PathFinder } = await import('../../src/client/renderer/PathFinder.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const nodeC = makeMockNode('c');
    const cy = makeMockCy([nodeA, nodeB, nodeC], []);
    const pf = new PathFinder(cy as any);
    pf.highlightPath([NodeId('a'), NodeId('b')]);
    expect(nodeC.addClass).toHaveBeenCalledWith('path-dim');
    expect(nodeA.addClass).not.toHaveBeenCalledWith('path-dim');
  });

  it('highlightPath highlights edges between consecutive path nodes', async () => {
    const { PathFinder } = await import('../../src/client/renderer/PathFinder.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const nodeC = makeMockNode('c');
    const edgeAB = makeMockEdge('e1', 'a', 'b');
    const edgeBC = makeMockEdge('e2', 'b', 'c');
    const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB, edgeBC]);
    const pf = new PathFinder(cy as any);
    pf.highlightPath([NodeId('a'), NodeId('b'), NodeId('c')]);
    expect(edgeAB.addClass).toHaveBeenCalledWith('path-highlight');
    expect(edgeBC.addClass).toHaveBeenCalledWith('path-highlight');
  });

  it('destroy is a no-op', async () => {
    const { PathFinder } = await import('../../src/client/renderer/PathFinder.ts');
    const cy = makeMockCy([], []);
    const pf = new PathFinder(cy as any);
    pf.destroy();
    expect(pf).toBeDefined();
  });
});