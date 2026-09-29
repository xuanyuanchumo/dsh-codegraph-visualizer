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
    data: vi.fn((key?: string) => { if (key === 'rankDir') return undefined; return undefined; }),
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

describe('ExportController', () => {
  it('exportJSON returns JSON string', async () => {
    const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
    const cy = makeMockCy([], []);
    const ec = new ExportController(cy as any);
    const result = ec.exportJSON();
    expect(typeof result).toBe('string');
    expect(JSON.parse(result)).toBeDefined();
  });

  it('exportPNG returns data URL', async () => {
    const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
    const cy = makeMockCy([], []);
    const ec = new ExportController(cy as any);
    expect(ec.exportPNG()).toBe('data:image/png;base64,mock');
  });

  describe('exportMermaid', () => {
    it('returns "graph TD" header when no nodes', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const cy = makeMockCy([], []);
      const ec = new ExportController(cy as any);
      const result = ec.exportMermaid();
      expect(result).toBe('graph TD\n');
    });

    it('returns graph TD header with node definitions', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const nodeA = makeMockNode('a', { label: 'FuncA', type: 'function' });
      const nodeB = makeMockNode('b', { label: 'ClassB', type: 'class' });
      const cy = makeMockCy([nodeA, nodeB], []);
      const ec = new ExportController(cy as any);
      const result = ec.exportMermaid();
      expect(result).toContain('graph TD');
      expect(result).toContain('na["FuncA"]');
      expect(result).toContain('nb["ClassB"]');
      expect(result).toContain('"FuncA"');
      expect(result).toContain('"ClassB"');
    });

    it('uses correct shape for each node type', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const funcNode = makeMockNode('n1', { label: 'fn', type: 'function' });
      const classNode = makeMockNode('n2', { label: 'cls', type: 'class' });
      const varNode = makeMockNode('n3', { label: 'var', type: 'variable' });
      const modNode = makeMockNode('n4', { label: 'mod', type: 'module' });
      const ifaceNode = makeMockNode('n5', { label: 'iface', type: 'interface' });
      const cy = makeMockCy([funcNode, classNode, varNode, modNode, ifaceNode], []);
      const ec = new ExportController(cy as any);
      const result = ec.exportMermaid();
      expect(result).toContain('nn1["fn"]@{ shape: process }');
      expect(result).toContain('nn2["cls"]@{ shape: rect }');
      expect(result).toContain('nn3["var"]@{ shape: process }');
      expect(result).toContain('nn4["mod"]@{ shape: folder }');
      expect(result).toContain('nn5["iface"]@{ shape: document }');
    });

    it('uses default shape for unknown node type', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const unknownNode = makeMockNode('n1', { label: 'unknown', type: 'weird' });
      const cy = makeMockCy([unknownNode], []);
      const ec = new ExportController(cy as any);
      const result = ec.exportMermaid();
      expect(result).toContain('nn1["unknown"]@{ shape: rect }');
    });

    it('exports edges with type labels', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const nodeA = makeMockNode('a', { label: 'A', type: 'function' });
      const nodeB = makeMockNode('b', { label: 'B', type: 'function' });
      const edge = makeMockEdge('e1', 'a', 'b', { type: 'call' });
      const cy = makeMockCy([nodeA, nodeB], [edge]);
      const ec = new ExportController(cy as any);
      const result = ec.exportMermaid();
      expect(result).toContain('na -->|call| nb');
    });

    it('exports edges without label for unknown edge type', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const nodeA = makeMockNode('a', { label: 'A', type: 'function' });
      const nodeB = makeMockNode('b', { label: 'B', type: 'function' });
      const edge = makeMockEdge('e1', 'a', 'b', { type: 'unknown_type' });
      const cy = makeMockCy([nodeA, nodeB], [edge]);
      const ec = new ExportController(cy as any);
      const result = ec.exportMermaid();
      expect(result).toContain('na --> nb');
    });

    it('sanitizes node IDs with special characters', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const nodeA = makeMockNode('src/file.ts', { label: 'A', type: 'function' });
      const cy = makeMockCy([nodeA], []);
      const ec = new ExportController(cy as any);
      const result = ec.exportMermaid();
      expect(result).toContain('nsrc_file_ts');
    });

    it('escapes double quotes in labels', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const nodeA = makeMockNode('a', { label: 'say "hello"', type: 'function' });
      const cy = makeMockCy([nodeA], []);
      const ec = new ExportController(cy as any);
      const result = ec.exportMermaid();
      expect(result).toContain("'hello'");
      expect(result).not.toContain('"hello"');
    });

    it('exports all 6 edge type labels', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const nodeA = makeMockNode('a', { label: 'A', type: 'function' });
      const nodeB = makeMockNode('b', { label: 'B', type: 'class' });
      const edgeCall = makeMockEdge('e1', 'a', 'b', { type: 'call' });
      const edgeExtend = makeMockEdge('e2', 'a', 'b', { type: 'extend' });
      const edgeImplement = makeMockEdge('e3', 'a', 'b', { type: 'implement' });
      const edgeImport = makeMockEdge('e4', 'a', 'b', { type: 'import' });
      const edgeDependency = makeMockEdge('e5', 'a', 'b', { type: 'dependency' });
      const edgeContains = makeMockEdge('e6', 'a', 'b', { type: 'contains' });
      const cy = makeMockCy([nodeA, nodeB], [edgeCall, edgeExtend, edgeImplement, edgeImport, edgeDependency, edgeContains]);
      const ec = new ExportController(cy as any);
      const result = ec.exportMermaid();
      expect(result).toContain('-->|call|');
      expect(result).toContain('-.->|extend|');
      expect(result).toContain('-.->|implement|');
      expect(result).toContain('-->|import|');
      expect(result).toContain('-->|dependency|');
      expect(result).toContain('-->|contains|');
    });
  });

  describe('exportSVG', () => {
    it('returns null when no nodes', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const cy = makeMockCy([], []);
      const ec = new ExportController(cy as any);
      expect(ec.exportSVG('dark')).toBeNull();
    });

    it('returns SVG string with nodes and edges', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const nodeA = makeMockNode('a', { label: 'FuncA', type: 'function' });
      const nodeB = makeMockNode('b', { label: 'ClassB', type: 'class' });
      const edge = makeMockEdge('e1', 'a', 'b', { type: 'call' });
      const cy = makeMockCy([nodeA, nodeB], [edge]);
      const ec = new ExportController(cy as any);
      const result = ec.exportSVG('dark');
      expect(result).not.toBeNull();
      expect(result).toContain('<svg');
      expect(result).toContain('</svg>');
      expect(result).toContain('<circle');
      expect(result).toContain('<line');
      expect(result).toContain('FuncA');
      expect(result).toContain('ClassB');
    });

    it('escapes XML special characters in labels', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const nodeA = makeMockNode('a', { label: '<script>alert("x")</script>', type: 'function' });
      const cy = makeMockCy([nodeA], []);
      const ec = new ExportController(cy as any);
      const result = ec.exportSVG('dark');
      expect(result).not.toBeNull();
      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>');
    });

    it('uses dark theme by default', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const nodeA = makeMockNode('a', { label: 'A', type: 'function' });
      const cy = makeMockCy([nodeA], []);
      const ec = new ExportController(cy as any);
      const result = ec.exportSVG('dark');
      expect(result).not.toBeNull();
      expect(result).toContain('<svg');
    });

    it('accepts light theme parameter', async () => {
      const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
      const nodeA = makeMockNode('a', { label: 'A', type: 'function' });
      const cy = makeMockCy([nodeA], []);
      const ec = new ExportController(cy as any);
      const result = ec.exportSVG('light');
      expect(result).not.toBeNull();
      expect(result).toContain('<svg');
    });
  });

  it('destroy cleans up without throwing', async () => {
    const { ExportController } = await import('../../src/client/renderer/ExportController.ts');
    const cy = makeMockCy([], []);
    const ec = new ExportController(cy as any);
    ec.destroy();
    const result = ec.exportJSON();
    expect(typeof result).toBe('string');
    const parsed = JSON.parse(result);
    expect(parsed).toEqual(expect.objectContaining({ nodes: expect.any(Array), edges: expect.any(Array) }));
  });
});