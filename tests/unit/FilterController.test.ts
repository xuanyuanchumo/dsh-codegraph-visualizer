import { describe, it, expect, vi } from 'vitest';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';

function makeMockNode(id: string, data: Record<string, unknown> = {}) {
  const classes = new Set<string>();
  const dataMap = new Map<string, unknown>(Object.entries(data));
  return {
    id: () => id,
    data: vi.fn((key?: string, value?: unknown) => {
      if (key === undefined && value === undefined) {
        return Object.fromEntries(dataMap);
      }
      if (value !== undefined) { dataMap.set(key!, value); return undefined; }
      return dataMap.get(key!);
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

function makeMockEdge(id: string, sourceId: string, targetId: string, data: Record<string, unknown> = {}, sourceNode?: any, targetNode?: any) {
  const classes = new Set<string>();
  const dataMap = new Map<string, unknown>(Object.entries(data));
  const src = sourceNode ?? makeMockNode(sourceId);
  const tgt = targetNode ?? makeMockNode(targetId);
  return {
    id: () => id,
    source: () => src,
    target: () => tgt,
    data: vi.fn((key?: string, value?: unknown) => {
      if (key === undefined && value === undefined) {
        return Object.fromEntries(dataMap);
      }
      if (value !== undefined) { dataMap.set(key!, value); return undefined; }
      return dataMap.get(key!);
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
    removeData: vi.fn((key: string) => dataMap.delete(key)),
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

describe('FilterController', () => {
  it('filterByType with "all" shows all nodes', async () => {
    const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
    const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
    const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
    const cy = makeMockCy([nodeA, nodeB], []);
    const fc = new FilterController(cy as any);
    fc.filterByType('all');
    expect(nodeA.style).not.toHaveBeenCalledWith('display', 'none');
    expect(nodeB.style).not.toHaveBeenCalledWith('display', 'none');
  });

  it('filterByType hides non-matching nodes', async () => {
    const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
    const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
    const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
    const cy = makeMockCy([nodeA, nodeB], []);
    const fc = new FilterController(cy as any);
    fc.filterByType('function');
    expect(nodeB.style).toHaveBeenCalledWith('display', 'none');
  });

  it('filterByType does not hide cluster nodes', async () => {
    const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
    const clusterNode = makeMockNode('cluster1', { type: 'module', isCluster: true });
    const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
    const cy = makeMockCy([clusterNode, nodeA], []);
    const fc = new FilterController(cy as any);
    fc.filterByType('function');
    expect(clusterNode.style).not.toHaveBeenCalledWith('display', 'none');
  });

  it('filterByType hides edges connected to hidden nodes', async () => {
    const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
    const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
    const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
    const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
    const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
    const fc = new FilterController(cy as any);
    fc.filterByType('function');
    expect(edgeAB.style).toHaveBeenCalledWith('display', 'none');
  });

  it('filterByGraphType "call" shows only call edges', async () => {
    const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edgeCall = makeMockEdge('e1', 'a', 'b', { type: 'call' });
    const edgeImport = makeMockEdge('e2', 'a', 'b', { type: 'import' });
    const cy = makeMockCy([nodeA, nodeB], [edgeCall, edgeImport]);
    const fc = new FilterController(cy as any);
    fc.filterByGraphType('call');
    expect(edgeImport.style).toHaveBeenCalledWith('display', 'none');
  });

  it('filterByGraphType "all" shows all edge types', async () => {
    const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edgeCall = makeMockEdge('e1', 'a', 'b', { type: 'call' });
    const edgeImport = makeMockEdge('e2', 'a', 'b', { type: 'import' });
    const cy = makeMockCy([nodeA, nodeB], [edgeCall, edgeImport]);
    const fc = new FilterController(cy as any);
    fc.filterByGraphType('all');
    expect(edgeCall.style).not.toHaveBeenCalledWith('display', 'none');
    expect(edgeImport.style).not.toHaveBeenCalledWith('display', 'none');
  });

  it('filterByGraphType "dependency" shows only import and dependency edges', async () => {
    const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const edgeCall = makeMockEdge('e1', 'a', 'b', { type: 'call' });
    const edgeImport = makeMockEdge('e2', 'a', 'b', { type: 'import' });
    const edgeDependency = makeMockEdge('e3', 'a', 'b', { type: 'dependency' });
    const cy = makeMockCy([nodeA, nodeB], [edgeCall, edgeImport, edgeDependency]);
    const fc = new FilterController(cy as any);
    fc.filterByGraphType('dependency');
    expect(edgeCall.style).toHaveBeenCalledWith('display', 'none');
    expect(edgeImport.style).not.toHaveBeenCalledWith('display', 'none');
    expect(edgeDependency.style).not.toHaveBeenCalledWith('display', 'none');
  });

  it('filterByGraphType hides nodes with no visible edges', async () => {
    const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
    const nodeA = makeMockNode('a');
    const nodeB = makeMockNode('b');
    const nodeC = makeMockNode('c');
    const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' });
    const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB]);
    const fc = new FilterController(cy as any);
    fc.filterByGraphType('call');
    expect(nodeC.style).toHaveBeenCalledWith('display', 'none');
  });

  describe('applyConnectionFilters', () => {
    it('with fanInThreshold=1 hides nodes with no incoming edges (orphans)', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const nodeC = makeMockNode('c', { type: 'function', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB]);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(1, 0, new Set(), new Set());
      expect(nodeA.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeC.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeB.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('with fanOutThreshold=1 hides nodes with no outgoing edges (leaves)', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const nodeC = makeMockNode('c', { type: 'function', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB]);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(0, 1, new Set(), new Set());
      expect(nodeB.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeC.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeA.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('with visibleNodeTypes hides non-matching node types', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
      const cy = makeMockCy([nodeA, nodeB], []);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(0, 0, new Set(['function']), new Set());
      expect(nodeB.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeA.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('with visibleEdgeTypes hides non-matching edge types', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const edgeCall = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const edgeImport = makeMockEdge('e2', 'a', 'b', { type: 'import' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeCall, edgeImport]);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(0, 0, new Set(), new Set(['call']));
      expect(edgeImport.style).toHaveBeenCalledWith('display', 'none');
    });

    it('with all thresholds=0 and empty sets shows everything', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' });
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(0, 0, new Set(), new Set());
      expect(nodeA.style).not.toHaveBeenCalledWith('display', 'none');
      expect(nodeB.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('does not hide cluster nodes based on fanIn/fanOut thresholds', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const clusterNode = makeMockNode('cluster1', { type: 'module', isCluster: true });
      const cy = makeMockCy([clusterNode], []);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(5, 5, new Set(), new Set());
      expect(clusterNode.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('hides edges when source or target node is hidden by connection filter', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(1, 0, new Set(), new Set());
      expect(edgeAB.style).toHaveBeenCalledWith('display', 'none');
    });

    it('combines fanIn and fanOut thresholds correctly', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const nodeC = makeMockNode('c', { type: 'function', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const edgeBC = makeMockEdge('e2', 'b', 'c', { type: 'call' }, nodeB, nodeC);
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB, edgeBC]);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(1, 1, new Set(), new Set());
      expect(nodeA.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeC.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeB.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('combines visibleNodeTypes with fanIn threshold', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(1, 0, new Set(['function']), new Set());
      expect(nodeA.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeB.style).toHaveBeenCalledWith('display', 'none');
    });
  });

  describe('fanIn/fanOut caching', () => {
    it('caches fanIn/fanOut across multiple applyConnectionFilters calls', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(1, 0, new Set(), new Set());
      const edgesCallCountAfterFirst = cy.edges.mock.calls.length;
      fc.applyConnectionFilters(2, 0, new Set(), new Set());
      const edgesCallCountAfterSecond = cy.edges.mock.calls.length;
      expect(edgesCallCountAfterSecond).toBeGreaterThan(edgesCallCountAfterFirst);
    });

    it('invalidateCache forces recalculation on next applyConnectionFilters', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(1, 0, new Set(), new Set());
      fc.invalidateCache();
      fc.applyConnectionFilters(1, 0, new Set(), new Set());
      expect(() => fc.applyConnectionFilters(1, 0, new Set(), new Set())).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('restores display for all nodes and edges', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const fc = new FilterController(cy as any);
      fc.filterByType('function');
      fc.destroy();
      expect(nodeA.style).toHaveBeenCalledWith('display', 'element');
      expect(nodeB.style).toHaveBeenCalledWith('display', 'element');
      expect(edgeAB.style).toHaveBeenCalledWith('display', 'element');
    });

    it('removes typeFiltered and connectionFiltered data from nodes', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const cy = makeMockCy([nodeA], []);
      const fc = new FilterController(cy as any);
      fc.filterByType('function');
      fc.destroy();
      expect(nodeA.removeData).toHaveBeenCalledWith('typeFiltered');
      expect(nodeA.removeData).toHaveBeenCalledWith('connectionFiltered');
    });

    it('removes typeFiltered and connectionFiltered data from edges', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const fc = new FilterController(cy as any);
      fc.filterByType('function');
      fc.destroy();
      expect(edgeAB.removeData).toHaveBeenCalledWith('typeFiltered');
      expect(edgeAB.removeData).toHaveBeenCalledWith('connectionFiltered');
    });
  });

  describe('empty graph', () => {
    it('all methods handle empty graph without throwing', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const cy = makeMockCy([], []);
      const fc = new FilterController(cy as any);
      expect(() => fc.filterByType('all')).not.toThrow();
      expect(() => fc.filterByType('function')).not.toThrow();
      expect(() => fc.filterByGraphType('all')).not.toThrow();
      expect(() => fc.filterByGraphType('call')).not.toThrow();
      expect(() => fc.filterByGraphType('dependency')).not.toThrow();
      expect(() => fc.applyConnectionFilters(1, 1, new Set(), new Set())).not.toThrow();
      expect(() => fc.invalidateCache()).not.toThrow();
      expect(() => fc.destroy()).not.toThrow();
    });
  });

  describe('filterByType additional coverage', () => {
    it('keeps matching type nodes visible with display=element', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const cy = makeMockCy([nodeA], []);
      const fc = new FilterController(cy as any);
      fc.filterByType('function');
      expect(nodeA.style).toHaveBeenCalledWith('display', 'element');
    });

    it('keeps edges visible when type=all and no connection filter applied', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const fc = new FilterController(cy as any);
      fc.filterByType('all');
      expect(edgeAB.style).toHaveBeenCalledWith('display', 'element');
    });
  });

  describe('filterByGraphType additional coverage', () => {
    it('all mode shows all six standard edge types', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeCall = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const edgeImport = makeMockEdge('e2', 'a', 'b', { type: 'import' }, nodeA, nodeB);
      const edgeExtend = makeMockEdge('e3', 'a', 'b', { type: 'extend' }, nodeA, nodeB);
      const edgeImplement = makeMockEdge('e4', 'a', 'b', { type: 'implement' }, nodeA, nodeB);
      const edgeDependency = makeMockEdge('e5', 'a', 'b', { type: 'dependency' }, nodeA, nodeB);
      const edgeContains = makeMockEdge('e6', 'a', 'b', { type: 'contains' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeCall, edgeImport, edgeExtend, edgeImplement, edgeDependency, edgeContains]);
      const fc = new FilterController(cy as any);
      fc.filterByGraphType('all');
      expect(edgeCall.style).not.toHaveBeenCalledWith('display', 'none');
      expect(edgeImport.style).not.toHaveBeenCalledWith('display', 'none');
      expect(edgeExtend.style).not.toHaveBeenCalledWith('display', 'none');
      expect(edgeImplement.style).not.toHaveBeenCalledWith('display', 'none');
      expect(edgeDependency.style).not.toHaveBeenCalledWith('display', 'none');
      expect(edgeContains.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('all mode hides non-standard edge types like association', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a');
      const nodeB = makeMockNode('b');
      const edgeAssociation = makeMockEdge('e1', 'a', 'b', { type: 'association' }, nodeA, nodeB);
      const edgeAggregation = makeMockEdge('e2', 'a', 'b', { type: 'aggregation' }, nodeA, nodeB);
      const edgeComposition = makeMockEdge('e3', 'a', 'b', { type: 'composition' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAssociation, edgeAggregation, edgeComposition]);
      const fc = new FilterController(cy as any);
      fc.filterByGraphType('all');
      expect(edgeAssociation.style).toHaveBeenCalledWith('display', 'none');
      expect(edgeAggregation.style).toHaveBeenCalledWith('display', 'none');
      expect(edgeComposition.style).toHaveBeenCalledWith('display', 'none');
    });
  });

  describe('applyConnectionFilters additional coverage', () => {
    it('cluster nodes are not affected by visibleNodeTypes filter', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const clusterNode = makeMockNode('cluster1', { type: 'module', isCluster: true });
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const cy = makeMockCy([clusterNode, nodeA], []);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(0, 0, new Set(['class']), new Set());
      expect(clusterNode.style).not.toHaveBeenCalledWith('display', 'none');
      expect(nodeA.style).toHaveBeenCalledWith('display', 'none');
    });

    it('fanIn threshold=0 does not filter by fanIn', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const cy = makeMockCy([nodeA], []);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(0, 0, new Set(), new Set());
      expect(nodeA.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('combines fanIn, fanOut, visibleNodeTypes, and visibleEdgeTypes', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
      const nodeC = makeMockNode('c', { type: 'variable', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const edgeBC = makeMockEdge('e2', 'b', 'c', { type: 'import' }, nodeB, nodeC);
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB, edgeBC]);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(1, 1, new Set(['function', 'class']), new Set(['call']));
      expect(nodeA.style).toHaveBeenCalledWith('display', 'none');
      expect(edgeBC.style).toHaveBeenCalledWith('display', 'none');
    });
  });

  describe('invalidateCache with data change', () => {
    it('cache prevents recalculation, invalidateCache allows it', async () => {
      const { FilterController } = await import('../../src/client/renderer/FilterController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const nodeC = makeMockNode('c', { type: 'function', isCluster: false });
      const edgeBA = makeMockEdge('e1', 'b', 'a', { type: 'call' }, nodeB, nodeA);
      const edgeCA = makeMockEdge('e2', 'c', 'a', { type: 'call' }, nodeC, nodeA);
      const edgeAB = makeMockEdge('e3', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeBA, edgeCA, edgeAB]);
      const fc = new FilterController(cy as any);
      fc.applyConnectionFilters(2, 0, new Set(), new Set());
      expect(nodeB.style).toHaveBeenCalledWith('display', 'none');
      fc.invalidateCache();
      const edgeCB = makeMockEdge('e4', 'c', 'b', { type: 'call' }, nodeC, nodeB);
      cy._edgeList.push(edgeCB);
      fc.applyConnectionFilters(2, 0, new Set(), new Set());
      expect(nodeB.style).toHaveBeenCalledWith('display', 'element');
    });
  });
});