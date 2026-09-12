import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeId, EdgeId } from '../../src/types/index.ts';
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
    _classes: classes,
    _dataMap: dataMap,
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

  const buildCollection = (items: any[]) => ({
    forEach: vi.fn((cb: (el: any) => void) => items.forEach(cb)),
    length: items.length,
    filter: vi.fn((pred: (el: any) => boolean) => items.filter(pred)),
    addClass: vi.fn((cls: string) => items.forEach(el => el.addClass(cls))),
    removeClass: vi.fn((cls: string) => items.forEach(el => el.removeClass(cls))),
    remove: vi.fn(() => { items.length = 0; }),
    boundingBox: vi.fn(() => ({ x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 })),
  });

  let elementsList = [...nodeList, ...edgeList];

  const cy: any = {
    nodes: vi.fn(() => buildCollection(nodeList)),
    edges: vi.fn(() => buildCollection(edgeList)),
    elements: vi.fn(() => buildCollection(elementsList)),
    batch: vi.fn((cb: () => void) => cb()),
    getElementById: vi.fn((id: string) => {
      const node = nodeMap.get(id);
      if (node) return node;
      const edge = edgeMap.get(id);
      if (edge) return edge;
      return {
        nonempty: vi.fn(() => false),
        empty: vi.fn(() => true),
        length: 0,
        addClass: vi.fn(),
        removeClass: vi.fn(),
        data: vi.fn(),
        remove: vi.fn(),
      };
    }),
    add: vi.fn((spec: any) => {
      if (spec.group === 'nodes') {
        const node = makeMockNode(spec.data.id, spec.data);
        nodeMap.set(spec.data.id, node);
        nodeList.push(node);
        elementsList.push(node);
      } else if (spec.group === 'edges') {
        const srcExists = nodeMap.has(spec.data.source);
        const tgtExists = nodeMap.has(spec.data.target);
        if (srcExists && tgtExists) {
          const edge = makeMockEdge(spec.data.id, spec.data.source, spec.data.target, spec.data);
          edgeMap.set(spec.data.id, edge);
          edgeList.push(edge);
          elementsList.push(edge);
        }
      }
    }),
    remove: vi.fn((els: any) => {
      if (els && els.forEach) {
        els.forEach((el: any) => {
          nodeMap.delete(el.id());
          edgeMap.delete(el.id());
          const ni = nodeList.findIndex(n => n.id() === el.id());
          if (ni >= 0) nodeList.splice(ni, 1);
          const ei = edgeList.findIndex(e => e.id() === el.id());
          if (ei >= 0) edgeList.splice(ei, 1);
        });
      } else if (els && els.id) {
        nodeMap.delete(els.id());
        edgeMap.delete(els.id());
      }
    }),
    json: vi.fn(() => ({ nodes: [], edges: [] })),
    png: vi.fn(() => 'data:image/png;base64,mock'),
    _nodeMap: nodeMap,
    _edgeMap: edgeMap,
    _nodeList: nodeList,
    _edgeList: edgeList,
  };
  return cy;
}

function makeGraphNode(id: string, label = id, type: GraphNode['type'] = 'function'): GraphNode {
  return { id: NodeId(id), label, type, filePath: `/test/${id}.ts`, properties: {} };
}

function makeGraphEdge(id: string, source: string, target: string, type: GraphEdge['type'] = 'call'): GraphEdge {
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type, properties: {} };
}

describe('DataController', () => {
  it('updateData with new nodes triggers full reset and adds nodes', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    const nodes = [makeGraphNode('a'), makeGraphNode('b')];
    const edges: GraphEdge[] = [];
    dc.updateData(nodes, edges);
    expect(cy.add).toHaveBeenCalled();
  });

  it('updateData with same data does not throw', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    const nodes = [makeGraphNode('a'), makeGraphNode('b')];
    dc.updateData(nodes, []);
    expect(() => dc.updateData(nodes, [])).not.toThrow();
  });

  it('updateData detects property changes and applies incremental updates', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    const nodes = [makeGraphNode('a')];
    dc.updateData(nodes, []);
    const updatedNodes = [{ ...makeGraphNode('a'), label: 'updated-a' }];
    dc.updateData(updatedNodes, []);
    expect(cy.batch).toHaveBeenCalled();
  });

  it('updateData handles stale node removal without throwing', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    dc.updateData([makeGraphNode('a'), makeGraphNode('b')], []);
    expect(() => dc.updateData([makeGraphNode('a')], [])).not.toThrow();
  });

  it('addEdge skips when source node does not exist (dangling edge protection)', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    const nodes = [makeGraphNode('a')];
    const edges = [makeGraphEdge('e1', 'a', 'nonexistent')];
    dc.updateData(nodes, edges);
    expect(cy.edges().length).toBe(0);
  });

  it('getLastAddedNodeIds returns ids after full reset', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    dc.updateData([makeGraphNode('a'), makeGraphNode('b')], []);
    const ids = dc.getLastAddedNodeIds();
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
  });

  it('clearLastAddedNodeIds clears the set', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    dc.updateData([makeGraphNode('a')], []);
    dc.clearLastAddedNodeIds();
    expect(dc.getLastAddedNodeIds().size).toBe(0);
  });

  it('setRawNodes stores raw nodes for search', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    dc.setRawNodes([makeGraphNode('a', 'myFunc')]);
    const matches = dc.search('myFunc');
    expect(matches).toBeGreaterThan(0);
  });

  it('search with empty query returns 0 and clears search-match', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    dc.setRawNodes([makeGraphNode('a', 'myFunc')]);
    dc.search('myFunc');
    const result = dc.search('');
    expect(result).toBe(0);
  });

  it('search with no matches returns 0', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    dc.setRawNodes([makeGraphNode('a', 'foo')]);
    expect(dc.search('xyz')).toBe(0);
  });

  it('getNodeData returns null for unknown id', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    expect(dc.getNodeData('nonexistent')).toBeNull();
  });

  it('getEdgeData returns null for unknown id', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    expect(dc.getEdgeData('nonexistent')).toBeNull();
  });

  it('filterByType with "all" shows all nodes', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
    const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
    const cy = makeMockCy([nodeA, nodeB], []);
    const dc = new DataController(cy as any);
    dc.filterByType('all');
    expect(nodeA.style).not.toHaveBeenCalledWith('display', 'none');
    expect(nodeB.style).not.toHaveBeenCalledWith('display', 'none');
  });

  it('filterByType hides non-matching nodes', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
    const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
    const cy = makeMockCy([nodeA, nodeB], []);
    const dc = new DataController(cy as any);
    dc.filterByType('function');
    expect(nodeB.style).toHaveBeenCalledWith('display', 'none');
  });

  it('filterByGraphType "call" shows only call edges', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edgeCall = makeMockEdge('e1', 'a', 'b', { type: 'call' });
    const edgeImport = makeMockEdge('e2', 'a', 'b', { type: 'import' });
    const cy = makeMockCy([nodeA, nodeB], [edgeCall, edgeImport]);
    const dc = new DataController(cy as any);
    dc.filterByGraphType('call');
    expect(edgeImport.style).toHaveBeenCalledWith('display', 'none');
  });

  it('filterByGraphType "all" shows all edge types', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edgeCall = makeMockEdge('e1', 'a', 'b', { type: 'call' });
    const edgeImport = makeMockEdge('e2', 'a', 'b', { type: 'import' });
    const cy = makeMockCy([nodeA, nodeB], [edgeCall, edgeImport]);
    const dc = new DataController(cy as any);
    dc.filterByGraphType('all');
    expect(edgeCall.style).not.toHaveBeenCalledWith('display', 'none');
    expect(edgeImport.style).not.toHaveBeenCalledWith('display', 'none');
  });

  it('exportJSON returns JSON string', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    const result = dc.exportJSON();
    expect(typeof result).toBe('string');
    expect(JSON.parse(result)).toBeDefined();
  });

  it('exportPNG returns data URL', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    expect(dc.exportPNG()).toBe('data:image/png;base64,mock');
  });

  it('destroy cleans up internal state', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    dc.updateData([makeGraphNode('a')], []);
    expect(() => dc.destroy()).not.toThrow();
    expect(dc.getNodeData('a')).toBeNull();
  });
});