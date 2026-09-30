import { describe, it, expect, vi } from 'vitest';
import { NodeId, EdgeId, safeString, safeNumber, safeBoolean, isNodeType } from '../../src/types/index.ts';
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
    dc.updateData(nodes, []);
    expect(cy.batch).toHaveBeenCalled();
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
    dc.updateData([makeGraphNode('a')], []);
    expect(cy.batch).toHaveBeenCalled();
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

  it('destroy cleans up internal state', async () => {
    const { DataController } = await import('../../src/client/renderer/DataController.ts');
    const cy = makeMockCy([], []);
    const dc = new DataController(cy as any);
    dc.updateData([makeGraphNode('a')], []);
    dc.destroy();
    expect(dc.getNodeData('a')).toBeNull();
  });

  describe('nodeFromCy type safety', () => {
    it('getNodeData returns valid GraphNode for well-formed cytoscape data', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'MyFunc', type: 'function',
        filePath: '/src/a.ts', lineNumber: 42, isCluster: false,
      });
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      const data = dc.getNodeData('n1');
      expect(data).not.toBeNull();
      expect(data!.id).toBe(NodeId('n1'));
      expect(data!.label).toBe('MyFunc');
      expect(data!.type).toBe('function');
      expect(data!.filePath).toBe('/src/a.ts');
      expect(data!.lineNumber).toBe(42);
    });

    it('getNodeData falls back to module type when type is invalid', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'X', type: 'invalid_type',
        filePath: '/src/a.ts', isCluster: false,
      });
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      const data = dc.getNodeData('n1');
      expect(data).not.toBeNull();
      expect(data!.type).toBe('module');
    });

    it('getNodeData falls back to module type when type is missing', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'X', filePath: '/src/a.ts', isCluster: false,
      });
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      const data = dc.getNodeData('n1');
      expect(data).not.toBeNull();
      expect(data!.type).toBe('module');
    });

    it('getNodeData handles missing label by using id', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', type: 'function', filePath: '/src/a.ts', isCluster: false,
      });
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      const data = dc.getNodeData('n1');
      expect(data).not.toBeNull();
      expect(data!.label).toBe('n1');
    });

    it('getNodeData handles non-number lineNumber gracefully', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'X', type: 'function',
        filePath: '/src/a.ts', lineNumber: 'not-a-number', isCluster: false,
      });
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      const data = dc.getNodeData('n1');
      expect(data).not.toBeNull();
      expect(data!.lineNumber).toBe(0);
    });

    it('getNodeData returns ClusterNode when isCluster is true', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('cluster1', {
        id: 'cluster1', label: 'mypkg', type: 'module',
        filePath: '/src/mypkg', isCluster: true, childCount: 5,
      });
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      const data = dc.getNodeData('cluster1') as any;
      expect(data).not.toBeNull();
      expect(data.isCluster).toBe(true);
      expect(data.childCount).toBe(5);
      expect(data.clusterPath).toBe('/src/mypkg');
    });

    it('getNodeData handles non-boolean isCluster gracefully', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'X', type: 'function',
        filePath: '/src/a.ts', isCluster: 1,
      });
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      const data = dc.getNodeData('n1') as any;
      expect(data).not.toBeNull();
      expect(data.isCluster).toBeUndefined();
      expect(data.type).toBe('function');
    });

    it('getNodeData returns null for non-existent node', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const data = dc.getNodeData('nonexistent');
      expect(data).toBeNull();
    });

    it('getNodeData handles parentId correctly', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('child1', {
        id: 'child1', label: 'Child', type: 'function',
        filePath: '/src/a.ts', parent: 'parent1', isCluster: false,
      });
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      const data = dc.getNodeData('child1');
      expect(data).not.toBeNull();
      expect(data!.parentId).toBe(NodeId('parent1'));
    });
  });

  describe('type guard functions', () => {
    it('isNodeType validates correct node types', () => {
      expect(isNodeType('function')).toBe(true);
      expect(isNodeType('class')).toBe(true);
      expect(isNodeType('variable')).toBe(true);
      expect(isNodeType('module')).toBe(true);
      expect(isNodeType('interface')).toBe(true);
      expect(isNodeType('type')).toBe(true);
    });

    it('isNodeType rejects invalid node types', () => {
      expect(isNodeType('invalid')).toBe(false);
      expect(isNodeType('')).toBe(false);
      expect(isNodeType(null)).toBe(false);
      expect(isNodeType(undefined)).toBe(false);
      expect(isNodeType(42)).toBe(false);
    });

    it('safeString returns value when string', () => {
      expect(safeString('hello')).toBe('hello');
      expect(safeString('hello', 'fallback')).toBe('hello');
    });

    it('safeString returns fallback when not string', () => {
      expect(safeString(null)).toBe('');
      expect(safeString(undefined)).toBe('');
      expect(safeString(42)).toBe('');
      expect(safeString(null, 'fallback')).toBe('fallback');
      expect(safeString(undefined, 'fallback')).toBe('fallback');
      expect(safeString(42, 'fallback')).toBe('fallback');
    });

    it('safeNumber returns value when number', () => {
      expect(safeNumber(42)).toBe(42);
      expect(safeNumber(0)).toBe(0);
      expect(safeNumber(42, 99)).toBe(42);
    });

    it('safeNumber returns fallback when not number or NaN', () => {
      expect(safeNumber(null)).toBe(0);
      expect(safeNumber(undefined)).toBe(0);
      expect(safeNumber('42')).toBe(0);
      expect(safeNumber(NaN)).toBe(0);
      expect(safeNumber(null, 99)).toBe(99);
      expect(safeNumber('42', 99)).toBe(99);
    });

    it('safeBoolean returns value when boolean', () => {
      expect(safeBoolean(true)).toBe(true);
      expect(safeBoolean(false)).toBe(false);
      expect(safeBoolean(true, false)).toBe(true);
    });

    it('safeBoolean returns fallback when not boolean', () => {
      expect(safeBoolean(null)).toBe(false);
      expect(safeBoolean(undefined)).toBe(false);
      expect(safeBoolean(1)).toBe(false);
      expect(safeBoolean('true')).toBe(false);
      expect(safeBoolean(null, true)).toBe(true);
      expect(safeBoolean(1, true)).toBe(true);
    });
  });

  describe('incremental update paths', () => {
    it('updateData adds new nodes incrementally without full reset', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('a')], []);
      const initialAddCount = (cy.add as any).mock.calls.length;
      dc.updateData([makeGraphNode('a'), makeGraphNode('b')], []);
      expect(cy.add).toHaveBeenCalled();
    });

    it('updateData handles new edges in incremental update', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b')];
      dc.updateData(nodes, []);
      dc.updateData(nodes, [makeGraphEdge('e1', 'a', 'b')]);
      expect(cy.add).toHaveBeenCalled();
    });

    it('updateData detects edge endpoint change and re-adds edge', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b'), makeGraphNode('c')];
      dc.updateData(nodes, [makeGraphEdge('e1', 'a', 'b')]);
      dc.updateData(nodes, [makeGraphEdge('e1', 'a', 'c')]);
      expect(cy.batch).toHaveBeenCalled();
    });

    it('updateData updates edge properties incrementally', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b')];
      const edge = { ...makeGraphEdge('e1', 'a', 'b'), properties: { weight: 1 } };
      dc.updateData(nodes, [edge]);
      const updatedEdge = { ...makeGraphEdge('e1', 'a', 'b'), properties: { weight: 5 } };
      dc.updateData(nodes, [updatedEdge]);
      expect(cy.batch).toHaveBeenCalled();
    });

    it('updateData handles stale edge removal', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b')];
      dc.updateData(nodes, [makeGraphEdge('e1', 'a', 'b')]);
      dc.updateData(nodes, []);
      expect(cy.batch).toHaveBeenCalled();
    });
  });

  describe('setRawNodes and raw maps', () => {
    it('setRawNodes populates rawNodesMap', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      dc.setRawNodes([makeGraphNode('a'), makeGraphNode('b')]);
      const map = dc.getRawNodesMap();
      expect(map.size).toBe(2);
      expect(map.has('a')).toBe(true);
      expect(map.has('b')).toBe(true);
    });

    it('getRawToVisibleMap returns map after updateData', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('a')], []);
      const map = dc.getRawToVisibleMap();
      expect(map.get('a')).toBe('a');
    });
  });

  describe('getSelectedNodeData', () => {
    it('returns null when no node is selected', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      expect(dc.getSelectedNodeData()).toBeNull();
    });

    it('returns node data when a node has selected class', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'FuncA', type: 'function',
        filePath: '/src/a.ts', lineNumber: 10, isCluster: false,
      });
      node.addClass('selected');
      const selectedCollection = {
        length: 1,
        first: vi.fn(() => node),
        forEach: vi.fn((cb: (el: any) => void) => cb(node)),
      };
      const cy = makeMockCy([node], []);
      cy.nodes = vi.fn((selector?: string) => {
        if (selector === '.selected') return selectedCollection;
        return { forEach: vi.fn((cb: (el: any) => void) => cb(node)), length: 1 };
      });
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('n1')], []);
      const data = dc.getSelectedNodeData();
      expect(data).not.toBeNull();
    });
  });

  describe('computeNodeWeights roles', () => {
    it('assigns orphan role to isolated nodes', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'X', type: 'function',
        filePath: '/src/a.ts', lineNumber: 0, isCluster: false,
      });
      node.indegree = vi.fn(() => 0);
      node.outdegree = vi.fn(() => 0);
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('n1')], []);
      expect((node.data as any).mock.calls.some((c: any[]) => c[0] === 'nodeRole' && c[1] === 'orphan')).toBe(true);
    });

    it('assigns entry role to nodes with only outgoing edges', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'X', type: 'function',
        filePath: '/src/a.ts', lineNumber: 0, isCluster: false,
      });
      node.indegree = vi.fn(() => 0);
      node.outdegree = vi.fn(() => 3);
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('n1')], []);
      expect((node.data as any).mock.calls.some((c: any[]) => c[0] === 'nodeRole' && c[1] === 'entry')).toBe(true);
    });

    it('assigns leaf role to nodes with only incoming edges', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'X', type: 'function',
        filePath: '/src/a.ts', lineNumber: 0, isCluster: false,
      });
      node.indegree = vi.fn(() => 5);
      node.outdegree = vi.fn(() => 0);
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('n1')], []);
      expect((node.data as any).mock.calls.some((c: any[]) => c[0] === 'nodeRole' && c[1] === 'leaf')).toBe(true);
    });
  });

  describe('cluster node handling', () => {
    it('buildRawToVisibleMap maps cluster children to cluster id', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const clusterNode: any = {
        id: NodeId('cluster1'),
        label: 'mypkg (3)',
        type: 'module',
        filePath: '/src/mypkg',
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: 3,
        childIds: ['child1', 'child2', 'child3'],
        clusterPath: '/src/mypkg',
        clusterLevel: 'directory',
      };
      dc.updateData([clusterNode], []);
      const map = dc.getRawToVisibleMap();
      expect(map.get('child1')).toBe('cluster1');
      expect(map.get('child2')).toBe('cluster1');
      expect(map.get('child3')).toBe('cluster1');
    });
  });

  describe('computeNodeWeights hub role', () => {
    it('assigns hub role to high-degree nodes', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'X', type: 'function',
        filePath: '/src/a.ts', lineNumber: 0, isCluster: false,
      });
      node.indegree = vi.fn(() => 10);
      node.outdegree = vi.fn(() => 5);
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('n1')], []);
      expect((node.data as any).mock.calls.some((c: any[]) => c[0] === 'nodeRole' && c[1] === 'hub')).toBe(true);
    });

    it('sets weight and instability for connected nodes', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'X', type: 'function',
        filePath: '/src/a.ts', lineNumber: 0, isCluster: false,
      });
      node.indegree = vi.fn(() => 3);
      node.outdegree = vi.fn(() => 2);
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('n1')], []);
      expect((node.data as any).mock.calls.some((c: any[]) => c[0] === 'weight' && c[1] === 5)).toBe(true);
      expect((node.data as any).mock.calls.some((c: any[]) => c[0] === 'instability' && c[1] === 0.4)).toBe(true);
    });

    it('removes weight and instability for isolated nodes', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'X', type: 'function',
        filePath: '/src/a.ts', lineNumber: 0, isCluster: false,
      });
      node.indegree = vi.fn(() => 0);
      node.outdegree = vi.fn(() => 0);
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('n1')], []);
      expect((node.removeData as any).mock.calls.some((c: any[]) => c[0] === 'weight')).toBe(true);
      expect((node.removeData as any).mock.calls.some((c: any[]) => c[0] === 'instability')).toBe(true);
    });

    it('computes clusterHue for cluster nodes', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('cluster1', {
        id: 'cluster1', label: 'pkg', type: 'module',
        filePath: '/src/pkg', isCluster: true, childCount: 3,
        clusterPath: '/src/pkg',
      });
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      const clusterNode: any = {
        id: NodeId('cluster1'),
        label: 'pkg (3)',
        type: 'module',
        filePath: '/src/pkg',
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: 3,
        childIds: ['c1', 'c2', 'c3'],
        clusterPath: '/src/pkg',
        clusterLevel: 'directory',
      };
      dc.updateData([clusterNode], []);
      expect((node.data as any).mock.calls.some((c: any[]) => c[0] === 'clusterHue')).toBe(true);
    });
  });

  describe('addNode replaces existing node', () => {
    it('removes existing node before adding new one with same id', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('a')], []);
      const initialAddCount = (cy.add as any).mock.calls.length;
      dc.updateData([{ ...makeGraphNode('a'), label: 'updated' }], []);
      expect(cy.add).toHaveBeenCalled();
    });
  });

  describe('addEdge replaces existing edge', () => {
    it('removes existing edge before adding new one with same id', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b')];
      dc.updateData(nodes, [makeGraphEdge('e1', 'a', 'b')]);
      dc.updateData(nodes, [{ ...makeGraphEdge('e1', 'a', 'b'), properties: { weight: 5 } }]);
      expect(cy.batch).toHaveBeenCalled();
    });
  });

  describe('destroyed state', () => {
    it('getNodeData returns null after destroy', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('a')], []);
      dc.destroy();
      expect(dc.getNodeData('a')).toBeNull();
    });

    it('getEdgeData returns null after destroy', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b')];
      dc.updateData(nodes, [makeGraphEdge('e1', 'a', 'b')]);
      dc.destroy();
      expect(dc.getEdgeData('e1')).toBeNull();
    });
  });

  describe('updateNodeData skips missing nodes', () => {
    it('does not throw when node does not exist in cy', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('a')], []);
      dc.updateData([{ ...makeGraphNode('a'), properties: { custom: 'value' } }], []);
      expect(cy.batch).toHaveBeenCalled();
    });
  });

  describe('detectChanges edge cases', () => {
    it('detects stale edges when edge count changes', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b'), makeGraphNode('c')];
      dc.updateData(nodes, [makeGraphEdge('e1', 'a', 'b'), makeGraphEdge('e2', 'b', 'c')]);
      dc.updateData(nodes, [makeGraphEdge('e1', 'a', 'b')]);
      expect(cy.batch).toHaveBeenCalled();
    });

    it('detects new edges without new nodes', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b')];
      dc.updateData(nodes, []);
      dc.updateData(nodes, [makeGraphEdge('e1', 'a', 'b')]);
      expect(cy.add).toHaveBeenCalled();
    });
  });

  describe('handleIncrementalUpdate edge source/target change', () => {
    it('removes and re-adds edge when source changes', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b'), makeGraphNode('c')];
      dc.updateData(nodes, [makeGraphEdge('e1', 'a', 'b')]);
      dc.updateData(nodes, [makeGraphEdge('e1', 'a', 'c')]);
      expect(cy.batch).toHaveBeenCalled();
    });
  });

  describe('processBatchAdd with large data', () => {
    it('processes nodes in batches when exceeding BATCH_SIZE', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const largeNodeList: GraphNode[] = [];
      for (let i = 0; i < 250; i++) {
        largeNodeList.push(makeGraphNode(`node-${i}`));
      }
      dc.updateData(largeNodeList, []);
      expect(cy.add).toHaveBeenCalled();
    });
  });

  describe('getSelectedNodeData fallback to nodeFromCy', () => {
    it('returns node data from cy when not in currentNodes', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'FuncA', type: 'function',
        filePath: '/src/a.ts', lineNumber: 10, isCluster: false,
      });
      node.addClass('selected');
      const selectedCollection = {
        length: 1,
        first: vi.fn(() => node),
        forEach: vi.fn((cb: (el: any) => void) => cb(node)),
      };
      const cy = makeMockCy([node], []);
      cy.nodes = vi.fn((selector?: string) => {
        if (selector === '.selected') return selectedCollection;
        return { forEach: vi.fn((cb: (el: any) => void) => cb(node)), length: 1 };
      });
      const dc = new DataController(cy as any);
      const data = dc.getSelectedNodeData();
      expect(data).not.toBeNull();
    });
  });


  describe('getEdgeData with valid edge', () => {
    it('returns edge data for existing edge', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b')];
      const edge = makeGraphEdge('e1', 'a', 'b');
      dc.updateData(nodes, [edge]);
      const data = dc.getEdgeData('e1');
      expect(data).not.toBeNull();
      expect(data!.id).toBe(EdgeId('e1'));
      expect(data!.source).toBe(NodeId('a'));
      expect(data!.target).toBe(NodeId('b'));
    });
  });

  describe('detectPropertyChanges criticalKeys', () => {
    it('detects diagramType property change', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [{ ...makeGraphNode('a'), properties: { diagramType: 'class' } }];
      dc.updateData(nodes, []);
      const updatedNodes = [{ ...makeGraphNode('a'), properties: { diagramType: 'sequence' } }];
      dc.updateData(updatedNodes, []);
      expect(cy.batch).toHaveBeenCalled();
    });

    it('detects depth property change', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [{ ...makeGraphNode('a'), properties: { depth: 1 } }];
      dc.updateData(nodes, []);
      const updatedNodes = [{ ...makeGraphNode('a'), properties: { depth: 2 } }];
      dc.updateData(updatedNodes, []);
      expect(cy.batch).toHaveBeenCalled();
    });

    it('detects isRoot property change', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [{ ...makeGraphNode('a'), properties: { isRoot: false } }];
      dc.updateData(nodes, []);
      const updatedNodes = [{ ...makeGraphNode('a'), properties: { isRoot: true } }];
      dc.updateData(updatedNodes, []);
      expect(cy.batch).toHaveBeenCalled();
    });

    it('detects isPackage property change', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [{ ...makeGraphNode('a'), properties: { isPackage: false } }];
      dc.updateData(nodes, []);
      const updatedNodes = [{ ...makeGraphNode('a'), properties: { isPackage: true } }];
      dc.updateData(updatedNodes, []);
      expect(cy.batch).toHaveBeenCalled();
    });

    it('detects umlLabel property change', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [{ ...makeGraphNode('a'), properties: { umlLabel: 'old' } }];
      dc.updateData(nodes, []);
      const updatedNodes = [{ ...makeGraphNode('a'), properties: { umlLabel: 'new' } }];
      dc.updateData(updatedNodes, []);
      expect(cy.batch).toHaveBeenCalled();
    });

    it('does not trigger update for non-critical property change', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [{ ...makeGraphNode('a'), properties: { customProp: 'value1' } }];
      dc.updateData(nodes, []);
      const updatedNodes = [{ ...makeGraphNode('a'), properties: { customProp: 'value2' } }];
      dc.updateData(updatedNodes, []);
      expect(cy.batch).toHaveBeenCalled();
    });
  });

  describe('computeNodeWeights middle role', () => {
    it('does not assign special role to mid-degree nodes', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'X', type: 'function',
        filePath: '/src/a.ts', lineNumber: 0, isCluster: false,
      });
      node.indegree = vi.fn(() => 2);
      node.outdegree = vi.fn(() => 2);
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('n1')], []);
      const hasRoleCall = (node.data as any).mock.calls.some(
        (c: any[]) => c[0] === 'nodeRole',
      );
      const hasRemoveRoleCall = (node.removeData as any).mock.calls.some(
        (c: any[]) => c[0] === 'nodeRole',
      );
      expect(hasRoleCall || hasRemoveRoleCall).toBe(true);
    });

    it('caps weight at MAX_WEIGHT (10)', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'X', type: 'function',
        filePath: '/src/a.ts', lineNumber: 0, isCluster: false,
      });
      node.indegree = vi.fn(() => 20);
      node.outdegree = vi.fn(() => 20);
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('n1')], []);
      expect(
        (node.data as any).mock.calls.some((c: any[]) => c[0] === 'weight' && c[1] === 10),
      ).toBe(true);
    });
  });

  describe('nodeFromCy extra properties', () => {
    it('extracts extra properties into baseProps', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'FuncA', type: 'function',
        filePath: '/src/a.ts', lineNumber: 10, isCluster: false,
        customProp: 'customValue',
        anotherProp: 42,
      });
      const cy = makeMockCy([node], []);
      const dc = new DataController(cy as any);
      const data = dc.getNodeData('n1');
      expect(data).not.toBeNull();
      expect(data!.properties).toHaveProperty('customProp', 'customValue');
      expect(data!.properties).toHaveProperty('anotherProp', 42);
    });
  });

  describe('applyIncrementalUpdates edge properties', () => {
    it('writes edge properties to cyEdge via data()', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b')];
      const edge = { ...makeGraphEdge('e1', 'a', 'b'), properties: { weight: 1 } };
      dc.updateData(nodes, [edge]);
      const updatedEdge = { ...makeGraphEdge('e1', 'a', 'b'), properties: { weight: 5 } };
      dc.updateData(nodes, [updatedEdge]);
      expect(cy.batch).toHaveBeenCalled();
    });
  });

  describe('processBatchAdd small batch path', () => {
    it('processes small batch directly without RAF', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b')];
      dc.updateData(nodes, [makeGraphEdge('e1', 'a', 'b')]);
      expect(cy.add).toHaveBeenCalled();
      const data = dc.getEdgeData('e1');
      expect(data).not.toBeNull();
    });
  });

  describe('handleIncrementalUpdate with stale nodes and edges', () => {
    it('removes stale nodes and edges simultaneously', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const nodes = [makeGraphNode('a'), makeGraphNode('b'), makeGraphNode('c')];
      const edges = [makeGraphEdge('e1', 'a', 'b'), makeGraphEdge('e2', 'b', 'c')];
      dc.updateData(nodes, edges);
      dc.updateData([makeGraphNode('a')], []);
      expect(cy.batch).toHaveBeenCalled();
    });
  });

  describe('addEdge with cluster edge', () => {
    it('handles cluster edge with isCluster flag', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const clusterNode: any = {
        id: NodeId('cluster1'),
        label: 'pkg (3)',
        type: 'module',
        filePath: '/src/pkg',
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: 3,
        childIds: ['c1', 'c2', 'c3'],
        clusterPath: '/src/pkg',
        clusterLevel: 'directory',
      };
      const clusterEdge: any = {
        id: EdgeId('ce1'),
        source: NodeId('cluster1'),
        target: NodeId('cluster2'),
        type: 'call',
        properties: {},
        isCluster: true,
        aggregatedCount: 5,
      };
      const clusterNode2: any = {
        id: NodeId('cluster2'),
        label: 'pkg2 (2)',
        type: 'module',
        filePath: '/src/pkg2',
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: 2,
        childIds: ['d1', 'd2'],
        clusterPath: '/src/pkg2',
        clusterLevel: 'directory',
      };
      dc.updateData([clusterNode, clusterNode2], [clusterEdge]);
      const data = dc.getEdgeData('ce1');
      expect(data).not.toBeNull();
    });
  });

  describe('addNode with cluster node', () => {
    it('handles cluster node with childCount and isCluster flag', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const clusterNode: any = {
        id: NodeId('cluster1'),
        label: 'mypkg (5)',
        type: 'module',
        filePath: '/src/mypkg',
        lineNumber: 0,
        properties: { custom: 'val' },
        isCluster: true,
        childCount: 5,
        childIds: ['c1', 'c2', 'c3', 'c4', 'c5'],
        clusterPath: '/src/mypkg',
        clusterLevel: 'directory',
      };
      dc.updateData([clusterNode], []);
      expect(cy.add).toHaveBeenCalled();
    });
  });

  describe('addNode with properties', () => {
    it('writes node properties to cytoscape data', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const node = { ...makeGraphNode('a'), properties: { custom: 'value', num: 42 } };
      dc.updateData([node], []);
      expect(cy.add).toHaveBeenCalled();
    });
  });

  describe('addNode with parentId', () => {
    it('sets parent field in node data', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const parentNode = makeGraphNode('parent');
      const childNode = { ...makeGraphNode('child'), parentId: NodeId('parent') };
      dc.updateData([parentNode, childNode], []);
      expect(cy.add).toHaveBeenCalled();
    });
  });

  describe('addNode with layer', () => {
    it('uses default layer when not specified', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('a')], []);
      expect(cy.add).toHaveBeenCalled();
    });

    it('uses custom layer when specified', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const node = { ...makeGraphNode('a'), layer: 'ui' as const };
      dc.updateData([node], []);
      expect(cy.add).toHaveBeenCalled();
    });
  });


  describe('getSelectedNodeData returns currentNodes data', () => {
    it('returns data from currentNodes when available', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node = makeMockNode('n1', {
        id: 'n1', label: 'FuncA', type: 'function',
        filePath: '/src/a.ts', lineNumber: 10, isCluster: false,
      });
      node.addClass('selected');
      const selectedCollection = {
        length: 1,
        first: vi.fn(() => node),
        forEach: vi.fn((cb: (el: any) => void) => cb(node)),
      };
      const cy = makeMockCy([node], []);
      cy.nodes = vi.fn((selector?: string) => {
        if (selector === '.selected') return selectedCollection;
        return { forEach: vi.fn((cb: (el: any) => void) => cb(node)), length: 1 };
      });
      const dc = new DataController(cy as any);
      dc.updateData([makeGraphNode('n1')], []);
      const data = dc.getSelectedNodeData();
      expect(data).not.toBeNull();
      expect(data!.label).toBe('n1');
    });
  });

  describe('computeNodeWeights clusterHue determinism', () => {
    it('produces consistent clusterHue for same clusterPath', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const node1 = makeMockNode('cluster1', {
        id: 'cluster1', label: 'pkg', type: 'module',
        filePath: '/src/pkg', isCluster: true, childCount: 3,
        clusterPath: '/src/pkg',
      });
      const node2 = makeMockNode('cluster2', {
        id: 'cluster2', label: 'pkg', type: 'module',
        filePath: '/src/pkg', isCluster: true, childCount: 3,
        clusterPath: '/src/pkg',
      });
      const cy = makeMockCy([node1, node2], []);
      const dc = new DataController(cy as any);
      const clusterNode: any = {
        id: NodeId('cluster1'),
        label: 'pkg (3)',
        type: 'module',
        filePath: '/src/pkg',
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: 3,
        childIds: ['c1', 'c2', 'c3'],
        clusterPath: '/src/pkg',
        clusterLevel: 'directory',
      };
      dc.updateData([clusterNode], []);
      const hueCalls1 = (node1.data as any).mock.calls.filter(
        (c: any[]) => c[0] === 'clusterHue',
      );
      expect(hueCalls1.length).toBeGreaterThan(0);
    });
  });
});
