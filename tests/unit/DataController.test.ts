import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  describe('exportMermaid', () => {
    it('returns "graph TD" header when no nodes', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const cy = makeMockCy([], []);
      const dc = new DataController(cy as any);
      const result = dc.exportMermaid();
      expect(result).toBe('graph TD\n');
    });

    it('returns graph TD header with node definitions', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { label: 'FuncA', type: 'function' });
      const nodeB = makeMockNode('b', { label: 'ClassB', type: 'class' });
      const cy = makeMockCy([nodeA, nodeB], []);
      const dc = new DataController(cy as any);
      const result = dc.exportMermaid();
      expect(result).toContain('graph TD');
      expect(result).toContain('a(');
      expect(result).toContain('b[');
      expect(result).toContain('"FuncA"');
      expect(result).toContain('"ClassB"');
    });

    it('uses correct shape for each node type', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const funcNode = makeMockNode('n1', { label: 'fn', type: 'function' });
      const classNode = makeMockNode('n2', { label: 'cls', type: 'class' });
      const varNode = makeMockNode('n3', { label: 'var', type: 'variable' });
      const modNode = makeMockNode('n4', { label: 'mod', type: 'module' });
      const ifaceNode = makeMockNode('n5', { label: 'iface', type: 'interface' });
      const cy = makeMockCy([funcNode, classNode, varNode, modNode, ifaceNode], []);
      const dc = new DataController(cy as any);
      const result = dc.exportMermaid();
      expect(result).toContain('n1("fn")');
      expect(result).toContain('n2["cls"]');
      expect(result).toContain('n3(("var"))');
      expect(result).toContain('n4{"mod"}');
      expect(result).toContain('n5/"iface"/');
    });

    it('uses default shape for unknown node type', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const unknownNode = makeMockNode('n1', { label: 'unknown', type: 'weird' });
      const cy = makeMockCy([unknownNode], []);
      const dc = new DataController(cy as any);
      const result = dc.exportMermaid();
      expect(result).toContain('n1["unknown"]');
    });

    it('exports edges with type labels', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { label: 'A', type: 'function' });
      const nodeB = makeMockNode('b', { label: 'B', type: 'function' });
      const edge = makeMockEdge('e1', 'a', 'b', { type: 'call' });
      const cy = makeMockCy([nodeA, nodeB], [edge]);
      const dc = new DataController(cy as any);
      const result = dc.exportMermaid();
      expect(result).toContain('a -->|call| b');
    });

    it('exports edges without label for unknown edge type', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { label: 'A', type: 'function' });
      const nodeB = makeMockNode('b', { label: 'B', type: 'function' });
      const edge = makeMockEdge('e1', 'a', 'b', { type: 'unknown_type' });
      const cy = makeMockCy([nodeA, nodeB], [edge]);
      const dc = new DataController(cy as any);
      const result = dc.exportMermaid();
      expect(result).toContain('a --> b');
    });

    it('sanitizes node IDs with special characters', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('src/file.ts', { label: 'A', type: 'function' });
      const cy = makeMockCy([nodeA], []);
      const dc = new DataController(cy as any);
      const result = dc.exportMermaid();
      expect(result).toContain('src_file_ts');
    });

    it('escapes double quotes in labels', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { label: 'say "hello"', type: 'function' });
      const cy = makeMockCy([nodeA], []);
      const dc = new DataController(cy as any);
      const result = dc.exportMermaid();
      expect(result).toContain("'hello'");
      expect(result).not.toContain('"hello"');
    });

    it('exports all 6 edge type labels', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { label: 'A', type: 'function' });
      const nodeB = makeMockNode('b', { label: 'B', type: 'class' });
      const edgeCall = makeMockEdge('e1', 'a', 'b', { type: 'call' });
      const edgeExtend = makeMockEdge('e2', 'a', 'b', { type: 'extend' });
      const edgeImplement = makeMockEdge('e3', 'a', 'b', { type: 'implement' });
      const edgeImport = makeMockEdge('e4', 'a', 'b', { type: 'import' });
      const edgeDependency = makeMockEdge('e5', 'a', 'b', { type: 'dependency' });
      const edgeContains = makeMockEdge('e6', 'a', 'b', { type: 'contains' });
      const cy = makeMockCy([nodeA, nodeB], [edgeCall, edgeExtend, edgeImplement, edgeImport, edgeDependency, edgeContains]);
      const dc = new DataController(cy as any);
      const result = dc.exportMermaid();
      expect(result).toContain('-->|call|');
      expect(result).toContain('-->|extend|');
      expect(result).toContain('-->|implement|');
      expect(result).toContain('-->|import|');
      expect(result).toContain('-->|dependency|');
      expect(result).toContain('-->|contains|');
    });
  });

  describe('applyConnectionFilters', () => {
    it('with fanInThreshold=1 hides nodes with no incoming edges (orphans)', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const nodeC = makeMockNode('c', { type: 'function', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB]);
      const dc = new DataController(cy as any);
      dc.applyConnectionFilters(1, 0, new Set(), new Set());
      expect(nodeA.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeC.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeB.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('with fanOutThreshold=1 hides nodes with no outgoing edges (leaves)', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const nodeC = makeMockNode('c', { type: 'function', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB]);
      const dc = new DataController(cy as any);
      dc.applyConnectionFilters(0, 1, new Set(), new Set());
      expect(nodeB.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeC.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeA.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('with visibleNodeTypes hides non-matching node types', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
      const cy = makeMockCy([nodeA, nodeB], []);
      const dc = new DataController(cy as any);
      dc.applyConnectionFilters(0, 0, new Set(['function']), new Set());
      expect(nodeB.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeA.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('with visibleEdgeTypes hides non-matching edge types', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const edgeCall = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const edgeImport = makeMockEdge('e2', 'a', 'b', { type: 'import' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeCall, edgeImport]);
      const dc = new DataController(cy as any);
      dc.applyConnectionFilters(0, 0, new Set(), new Set(['call']));
      expect(edgeImport.style).toHaveBeenCalledWith('display', 'none');
    });

    it('with all thresholds=0 and empty sets shows everything', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' });
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const dc = new DataController(cy as any);
      dc.applyConnectionFilters(0, 0, new Set(), new Set());
      expect(nodeA.style).not.toHaveBeenCalledWith('display', 'none');
      expect(nodeB.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('does not hide cluster nodes based on fanIn/fanOut thresholds', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const clusterNode = makeMockNode('cluster1', { type: 'module', isCluster: true });
      const cy = makeMockCy([clusterNode], []);
      const dc = new DataController(cy as any);
      dc.applyConnectionFilters(5, 5, new Set(), new Set());
      expect(clusterNode.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('hides edges when source or target node is hidden by connection filter', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const dc = new DataController(cy as any);
      dc.applyConnectionFilters(1, 0, new Set(), new Set());
      expect(edgeAB.style).toHaveBeenCalledWith('display', 'none');
    });

    it('combines fanIn and fanOut thresholds correctly', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'function', isCluster: false });
      const nodeC = makeMockNode('c', { type: 'function', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const edgeBC = makeMockEdge('e2', 'b', 'c', { type: 'call' }, nodeB, nodeC);
      const cy = makeMockCy([nodeA, nodeB, nodeC], [edgeAB, edgeBC]);
      const dc = new DataController(cy as any);
      dc.applyConnectionFilters(1, 1, new Set(), new Set());
      expect(nodeA.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeC.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeB.style).not.toHaveBeenCalledWith('display', 'none');
    });

    it('combines visibleNodeTypes with fanIn threshold', async () => {
      const { DataController } = await import('../../src/client/renderer/DataController.ts');
      const nodeA = makeMockNode('a', { type: 'function', isCluster: false });
      const nodeB = makeMockNode('b', { type: 'class', isCluster: false });
      const edgeAB = makeMockEdge('e1', 'a', 'b', { type: 'call' }, nodeA, nodeB);
      const cy = makeMockCy([nodeA, nodeB], [edgeAB]);
      const dc = new DataController(cy as any);
      dc.applyConnectionFilters(1, 0, new Set(['function']), new Set());
      expect(nodeA.style).toHaveBeenCalledWith('display', 'none');
      expect(nodeB.style).toHaveBeenCalledWith('display', 'none');
    });
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
});