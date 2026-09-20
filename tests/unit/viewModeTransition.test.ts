import { describe, it, expect, vi } from 'vitest';
import { DiagramCache } from '../../src/client/cache/DiagramCache.ts';
import { makeNode, makeEdge } from '../helpers.ts';
import type { GraphNode, GraphEdge, ViewMode } from '../../src/types/index.ts';

// Mock assembleDiagram so we can control when it returns null (fallback paths).
// Default: delegate to the real implementation.
vi.mock('../../src/client/diagram/index.ts', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    assembleDiagram: vi.fn(original.assembleDiagram as (...args: unknown[]) => unknown),
  };
});

// Import after mock so the mocked module is used.
const { computeViewModeTransition, VIEW_MODE_LAYOUT } = await import('../../src/client/store/viewModeTransition.ts');
const { assembleDiagram } = await import('../../src/client/diagram/index.ts');

function makeState(overrides: Partial<{
  rawNodes: GraphNode[];
  rawEdges: GraphEdge[];
  savedRawNodes: GraphNode[];
  savedRawEdges: GraphEdge[];
  clusterDepth: number;
  expandedNodeIds: Set<string>;
  expandedNodeIdsByViewMode: Record<string, Set<string>>;
  selectedFunction: { nodeId: string; filePath: string; functionName: string } | null;
  viewMode: ViewMode;
}> = {}) {
  return {
    rawNodes: [],
    rawEdges: [],
    savedRawNodes: [],
    savedRawEdges: [],
    clusterDepth: 0,
    expandedNodeIds: new Set<string>(),
    expandedNodeIdsByViewMode: {},
    selectedFunction: null,
    viewMode: 'code' as ViewMode,
    ...overrides,
  };
}

describe('viewModeTransition', () => {
  const diagramCache = new DiagramCache(10);

  describe('VIEW_MODE_LAYOUT', () => {
    it('should map each view mode to a layout type', () => {
      expect(VIEW_MODE_LAYOUT.code).toBe('cose');
      expect(VIEW_MODE_LAYOUT.dependencies).toBe('cose');
      expect(VIEW_MODE_LAYOUT.inheritance).toBe('tree');
      expect(VIEW_MODE_LAYOUT.callgraph).toBe('dagre');
      expect(VIEW_MODE_LAYOUT.package).toBe('tree');
      expect(VIEW_MODE_LAYOUT.class).toBe('dagre');
      expect(VIEW_MODE_LAYOUT.cfg).toBe('dagre');
      expect(VIEW_MODE_LAYOUT.flowchart).toBe('dagre');
      expect(VIEW_MODE_LAYOUT.sequence).toBe('cose');
    });
  });

  describe('computeViewModeTransition — code mode', () => {
    it('should restore raw nodes from saved when switching to code', () => {
      const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
      const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
      const result = computeViewModeTransition(
        'code',
        makeState({
          rawNodes: nodes,
          rawEdges: edges,
          savedRawNodes: nodes,
          savedRawEdges: edges,
          viewMode: 'dependencies',
        }),
        diagramCache,
      );
      expect(result.viewMode).toBe('code');
      expect(result.diagramData).toBeNull();
      expect(result.layout).toBe('cose');
      expect(result.savedRawNodes).toEqual(nodes);
      expect(result.savedRawEdges).toEqual(edges);
    });

    it('should use rawNodes when savedRawNodes is empty', () => {
      const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
      const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
      const result = computeViewModeTransition(
        'code',
        makeState({
          rawNodes: nodes,
          rawEdges: edges,
          viewMode: 'dependencies',
        }),
        diagramCache,
      );
      expect(result.nodes.length).toBeGreaterThan(0);
    });
  });

  describe('computeViewModeTransition — cfg/flowchart/sequence modes', () => {
    it('should set needsMicroAssembly when selectedFunction exists', () => {
      const result = computeViewModeTransition(
        'cfg',
        makeState({
          selectedFunction: { nodeId: 'n1', filePath: 'a.ts', functionName: 'foo' },
          viewMode: 'code' as ViewMode,
        }),
        diagramCache,
      );
      expect(result.viewMode).toBe('cfg');
      expect(result.needsMicroAssembly).toBe(true);
      expect(result.nodes).toEqual([]);
    });

    it('should not set needsMicroAssembly when no selectedFunction', () => {
      const result = computeViewModeTransition(
        'cfg',
        makeState({ viewMode: 'code' }),
        diagramCache,
      );
      expect(result.viewMode).toBe('cfg');
      expect(result.needsMicroAssembly).toBeUndefined();
      expect(result.nodes).toEqual([]);
    });
  });

  describe('computeViewModeTransition — expandedNodeIdsByViewMode', () => {
    it('should preserve previous view mode expanded state', () => {
      const prevExpanded = new Set(['n1', 'n2']);
      const result = computeViewModeTransition(
        'code',
        makeState({
          expandedNodeIds: prevExpanded,
          expandedNodeIdsByViewMode: {},
          viewMode: 'dependencies',
        }),
        diagramCache,
      );
      expect(result.expandedNodeIdsByViewMode['dependencies']).toEqual(prevExpanded);
    });

    it('should restore saved expanded state for new view mode', () => {
      const savedExpanded = new Set(['n3']);
      const result = computeViewModeTransition(
        'code',
        makeState({
          expandedNodeIds: new Set(['n1']),
          expandedNodeIdsByViewMode: { code: savedExpanded },
          viewMode: 'dependencies',
        }),
        diagramCache,
      );
      expect(result.expandedNodeIds).toEqual(savedExpanded);
    });
  });

  describe('computeViewModeTransition — fallback', () => {
    it('should fallback to clustered graph for unknown view modes', () => {
      const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
      const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
      const result = computeViewModeTransition(
        'code',
        makeState({
          rawNodes: nodes,
          rawEdges: edges,
          viewMode: 'code' as ViewMode,
        }),
        diagramCache,
      );
      expect(result.viewMode).toBe('code');
      expect(result.diagramData).toBeNull();
      expect(result.nodes.length).toBeGreaterThan(0);
    });
  });

  describe('computeViewModeTransition — dependencies mode', () => {
    it('should return diagram data when dependencies diagram exists', () => {
      const nodes = [
        makeNode('n1', 'FuncA', 'function', 'src/a.ts', 1),
        makeNode('n2', 'FuncB', 'function', 'lib/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'n1', 'n2', 'import')];
      const result = computeViewModeTransition(
        'dependencies',
        makeState({
          rawNodes: nodes,
          rawEdges: edges,
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.viewMode).toBe('dependencies');
      expect(result.diagramData).not.toBeNull();
      expect(result.layout).toBe('cose');
      expect(result.currentLayer).toBe(0);
      expect(result.savedRawNodes).toEqual(nodes);
      expect(result.savedRawEdges).toEqual(edges);
    });

    it('should use savedRawNodes as source when available', () => {
      const rawNodes = [makeNode('n1', 'FuncA', 'function', 'src/a.ts', 1)];
      const rawEdges = [makeEdge('e1', 'n1', 'n2', 'import')];
      const savedNodes = [
        makeNode('n1', 'FuncA', 'function', 'src/a.ts', 1),
        makeNode('n2', 'FuncB', 'function', 'lib/b.ts', 1),
      ];
      const savedEdges = [
        makeEdge('e1', 'n1', 'n2', 'import'),
        makeEdge('e2', 'n2', 'n3', 'dependency'),
      ];
      const result = computeViewModeTransition(
        'dependencies',
        makeState({
          rawNodes,
          rawEdges,
          savedRawNodes: savedNodes,
          savedRawEdges: savedEdges,
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.diagramData).not.toBeNull();
      expect(result.savedRawNodes).toEqual(rawNodes);
      expect(result.savedRawEdges).toEqual(rawEdges);
    });

    it('should fallback to raw nodes/edges when diagram is null', () => {
      vi.mocked(assembleDiagram).mockReturnValueOnce(null);
      const nodes = [makeNode('n1', 'FuncA', 'function', 'a.ts', 1)];
      const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
      const result = computeViewModeTransition(
        'dependencies',
        makeState({
          rawNodes: nodes,
          rawEdges: edges,
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.viewMode).toBe('dependencies');
      expect(result.diagramData).toBeNull();
      expect(result.nodes).toEqual(nodes);
      expect(result.edges).toEqual(edges);
      expect(result.savedRawNodes).toEqual(nodes);
      expect(result.savedRawEdges).toEqual(edges);
    });

    it('should preserve expandedNodeIdsByViewMode when switching to dependencies', () => {
      const prevExpanded = new Set(['n1']);
      const depExpanded = new Set(['n2', 'n3']);
      const result = computeViewModeTransition(
        'dependencies',
        makeState({
          expandedNodeIds: prevExpanded,
          expandedNodeIdsByViewMode: { dependencies: depExpanded },
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.expandedNodeIdsByViewMode['code']).toEqual(prevExpanded);
      expect(result.expandedNodeIds).toEqual(depExpanded);
    });
  });

  describe('computeViewModeTransition — inheritance mode', () => {
    it('should return diagram data when inheritance diagram exists', () => {
      const nodes = [
        makeNode('n1', 'Animal', 'class', 'src/a.ts', 1),
        makeNode('n2', 'Dog', 'class', 'src/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'n2', 'n1', 'extend')];
      const result = computeViewModeTransition(
        'inheritance',
        makeState({
          rawNodes: nodes,
          rawEdges: edges,
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.viewMode).toBe('inheritance');
      expect(result.diagramData).not.toBeNull();
      expect(result.layout).toBe('tree');
      expect(result.savedRawNodes).toEqual(nodes);
      expect(result.savedRawEdges).toEqual(edges);
    });

    it('should fallback to clustered graph when inheritance diagram is null', () => {
      vi.mocked(assembleDiagram).mockReturnValueOnce(null);
      const nodes = [makeNode('n1', 'FuncA', 'function', 'a.ts', 1)];
      const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
      const result = computeViewModeTransition(
        'inheritance',
        makeState({
          rawNodes: nodes,
          rawEdges: edges,
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.viewMode).toBe('inheritance');
      expect(result.diagramData).toBeNull();
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    it('should use savedRawNodes in fallback when available', () => {
      vi.mocked(assembleDiagram).mockReturnValueOnce(null);
      const rawNodes = [makeNode('n1', 'FuncA', 'function', 'a.ts', 1)];
      const rawEdges = [makeEdge('e1', 'n1', 'n2', 'call')];
      const savedNodes = [
        makeNode('n1', 'Animal', 'class', 'src/a.ts', 1),
        makeNode('n2', 'Dog', 'class', 'src/b.ts', 1),
      ];
      const savedEdges = [makeEdge('e1', 'n2', 'n1', 'extend')];
      const result = computeViewModeTransition(
        'inheritance',
        makeState({
          rawNodes,
          rawEdges,
          savedRawNodes: savedNodes,
          savedRawEdges: savedEdges,
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.viewMode).toBe('inheritance');
      expect(result.diagramData).toBeNull();
      expect(result.savedRawNodes).toEqual(savedNodes);
      expect(result.savedRawEdges).toEqual(savedEdges);
    });
  });

  describe('computeViewModeTransition — callgraph mode', () => {
    it('should return diagram data when callgraph diagram exists', () => {
      const nodes = [
        makeNode('n1', 'main', 'function', 'src/a.ts', 1),
        makeNode('n2', 'helper', 'function', 'src/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
      const result = computeViewModeTransition(
        'callgraph',
        makeState({
          rawNodes: nodes,
          rawEdges: edges,
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.viewMode).toBe('callgraph');
      expect(result.diagramData).not.toBeNull();
      expect(result.layout).toBe('dagre');
    });
  });

  describe('computeViewModeTransition — package mode', () => {
    it('should return diagram data when package diagram exists', () => {
      const nodes = [
        makeNode('n1', 'mod1', 'module', 'src/a.ts', 1),
        makeNode('n2', 'mod2', 'module', 'lib/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'n1', 'n2', 'import')];
      const result = computeViewModeTransition(
        'package',
        makeState({
          rawNodes: nodes,
          rawEdges: edges,
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.viewMode).toBe('package');
      expect(result.diagramData).not.toBeNull();
      expect(result.layout).toBe('tree');
    });
  });

  describe('computeViewModeTransition — class mode', () => {
    it('should return diagram data when class diagram exists', () => {
      const nodes = [
        makeNode('n1', 'Animal', 'class', 'src/a.ts', 1),
        makeNode('n2', 'Dog', 'class', 'src/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'n2', 'n1', 'extend')];
      const result = computeViewModeTransition(
        'class',
        makeState({
          rawNodes: nodes,
          rawEdges: edges,
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.viewMode).toBe('class');
      expect(result.diagramData).not.toBeNull();
      expect(result.layout).toBe('dagre');
    });
  });

  describe('computeViewModeTransition — flowchart mode', () => {
    it('should set needsMicroAssembly when selectedFunction exists', () => {
      const result = computeViewModeTransition(
        'flowchart',
        makeState({
          selectedFunction: { nodeId: 'n1', filePath: 'a.ts', functionName: 'foo' },
          viewMode: 'code',
        }),
        diagramCache,
      );
      expect(result.viewMode).toBe('flowchart');
      expect(result.needsMicroAssembly).toBe(true);
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it('should not set needsMicroAssembly when no selectedFunction', () => {
      const result = computeViewModeTransition(
        'flowchart',
        makeState({ viewMode: 'code' }),
        diagramCache,
      );
      expect(result.viewMode).toBe('flowchart');
      expect(result.needsMicroAssembly).toBeUndefined();
      expect(result.nodes).toEqual([]);
    });
  });

  describe('computeViewModeTransition — sequence mode', () => {
    it('should set needsMicroAssembly when selectedFunction exists', () => {
      const result = computeViewModeTransition(
        'sequence',
        makeState({
          selectedFunction: { nodeId: 'n1', filePath: 'a.ts', functionName: 'bar' },
          viewMode: 'code',
        }),
        diagramCache,
      );
      expect(result.viewMode).toBe('sequence');
      expect(result.needsMicroAssembly).toBe(true);
      expect(result.nodes).toEqual([]);
    });

    it('should not set needsMicroAssembly when no selectedFunction', () => {
      const result = computeViewModeTransition(
        'sequence',
        makeState({ viewMode: 'code' }),
        diagramCache,
      );
      expect(result.viewMode).toBe('sequence');
      expect(result.needsMicroAssembly).toBeUndefined();
      expect(result.nodes).toEqual([]);
    });
  });

  describe('computeViewModeTransition — cache behavior', () => {
    it('should return cached diagram on second call with same data', () => {
      const cache = new DiagramCache(10);
      const nodes = [
        makeNode('n1', 'FuncA', 'function', 'src/a.ts', 1),
        makeNode('n2', 'FuncB', 'function', 'lib/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'n1', 'n2', 'import')];
      const state = makeState({ rawNodes: nodes, rawEdges: edges, viewMode: 'code' });

      const result1 = computeViewModeTransition('dependencies', state, cache);
      expect(result1.diagramData).not.toBeNull();

      const result2 = computeViewModeTransition('dependencies', state, cache);
      expect(result2.diagramData).not.toBeNull();
      expect(result2.diagramData).toBe(result1.diagramData);
    });
  });

  describe('computeViewModeTransition — savedRawNodes/savedRawEdges restore', () => {
    it('should restore from savedRawNodes when switching to code from dependencies', () => {
      const savedNodes = [
        makeNode('n1', 'FuncA', 'function', 'src/a.ts', 1),
        makeNode('n2', 'FuncB', 'function', 'lib/b.ts', 1),
      ];
      const savedEdges = [makeEdge('e1', 'n1', 'n2', 'import')];
      const depNodes = [makeNode('d1', 'DepDir', 'module', '/', 0)];
      const depEdges: GraphEdge[] = [];
      const result = computeViewModeTransition(
        'code',
        makeState({
          rawNodes: depNodes,
          rawEdges: depEdges,
          savedRawNodes: savedNodes,
          savedRawEdges: savedEdges,
          viewMode: 'dependencies',
        }),
        diagramCache,
      );
      expect(result.savedRawNodes).toEqual(savedNodes);
      expect(result.savedRawEdges).toEqual(savedEdges);
      expect(result.rawNodes).toEqual(savedNodes);
      expect(result.rawEdges).toEqual(savedEdges);
    });

    it('should save rawNodes/rawEdges into savedRawNodes when switching to dependencies', () => {
      const nodes = [
        makeNode('n1', 'FuncA', 'function', 'src/a.ts', 1),
        makeNode('n2', 'FuncB', 'function', 'lib/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'n1', 'n2', 'import')];
      const result = computeViewModeTransition(
        'dependencies',
        makeState({
          rawNodes: nodes,
          rawEdges: edges,
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.savedRawNodes).toEqual(nodes);
      expect(result.savedRawEdges).toEqual(edges);
    });

    it('should save sourceNodes into savedRawNodes for layered view modes', () => {
      const nodes = [
        makeNode('n1', 'Animal', 'class', 'src/a.ts', 1),
        makeNode('n2', 'Dog', 'class', 'src/b.ts', 1),
      ];
      const edges = [makeEdge('e1', 'n2', 'n1', 'extend')];
      const result = computeViewModeTransition(
        'inheritance',
        makeState({
          rawNodes: nodes,
          rawEdges: edges,
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.diagramData).not.toBeNull();
      expect(result.savedRawNodes).toEqual(nodes);
      expect(result.savedRawEdges).toEqual(edges);
    });

    it('should use savedRawNodes as source for layered view when available', () => {
      const rawNodes = [makeNode('n1', 'FuncA', 'function', 'a.ts', 1)];
      const rawEdges = [makeEdge('e1', 'n1', 'n2', 'call')];
      const savedNodes = [
        makeNode('n1', 'Animal', 'class', 'src/a.ts', 1),
        makeNode('n2', 'Dog', 'class', 'src/b.ts', 1),
      ];
      const savedEdges = [makeEdge('e1', 'n2', 'n1', 'extend')];
      const result = computeViewModeTransition(
        'inheritance',
        makeState({
          rawNodes,
          rawEdges,
          savedRawNodes: savedNodes,
          savedRawEdges: savedEdges,
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.diagramData).not.toBeNull();
    });
  });

  describe('computeViewModeTransition — expandedNodeIdsByViewMode across views', () => {
    it('should save current expanded state and restore target expanded state for dependencies', () => {
      const codeExpanded = new Set(['n1', 'n2']);
      const depExpanded = new Set(['n3']);
      const result = computeViewModeTransition(
        'dependencies',
        makeState({
          expandedNodeIds: codeExpanded,
          expandedNodeIdsByViewMode: { dependencies: depExpanded },
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.expandedNodeIdsByViewMode['code']).toEqual(codeExpanded);
      expect(result.expandedNodeIds).toEqual(depExpanded);
    });

    it('should save current expanded state and restore target expanded state for inheritance', () => {
      const codeExpanded = new Set(['n1']);
      const inhExpanded = new Set(['n2', 'n3']);
      const result = computeViewModeTransition(
        'inheritance',
        makeState({
          expandedNodeIds: codeExpanded,
          expandedNodeIdsByViewMode: { inheritance: inhExpanded },
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.expandedNodeIdsByViewMode['code']).toEqual(codeExpanded);
      expect(result.expandedNodeIds).toEqual(inhExpanded);
    });

    it('should use empty set when no saved expanded state for new view mode', () => {
      const result = computeViewModeTransition(
        'dependencies',
        makeState({
          expandedNodeIds: new Set(['n1']),
          expandedNodeIdsByViewMode: {},
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.expandedNodeIds).toEqual(new Set());
    });

    it('should preserve expanded state for cfg/flowchart/sequence modes', () => {
      const codeExpanded = new Set(['n1', 'n2']);
      const cfgExpanded = new Set(['n3']);
      const result = computeViewModeTransition(
        'cfg',
        makeState({
          expandedNodeIds: codeExpanded,
          expandedNodeIdsByViewMode: { cfg: cfgExpanded },
          viewMode: 'code',
        }),
        diagramCache,
      );
      expect(result.expandedNodeIdsByViewMode['code']).toEqual(codeExpanded);
      expect(result.expandedNodeIds).toEqual(cfgExpanded);
    });
  });

  describe('computeViewModeTransition — getFirstLayerNodes fallback', () => {
    it('should use allNodes/allEdges when diagram has no layers', () => {
      const mockDiagram = {
        viewMode: 'dependencies' as ViewMode,
        layers: [],
        currentLayer: 0,
        expandedNodes: new Set<string>(),
        allNodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
        allEdges: [makeEdge('e1', 'n1', 'n2', 'call')],
        metadata: { rootIds: [], maxDepth: 0, nodeCount: 1, edgeCount: 1 },
      };
      vi.mocked(assembleDiagram).mockReturnValueOnce(mockDiagram);
      const result = computeViewModeTransition(
        'dependencies',
        makeState({
          rawNodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
          rawEdges: [makeEdge('e1', 'n1', 'n2', 'call')],
          viewMode: 'code',
        }),
        new DiagramCache(10),
      );
      expect(result.diagramData).not.toBeNull();
      expect(result.nodes.length).toBe(1);
      expect(result.edges.length).toBe(1);
    });
  });

  describe('computeViewModeTransition — selectedFunction handling', () => {
    it('should handle selectedFunction for cfg mode', () => {
      const result = computeViewModeTransition(
        'cfg',
        makeState({
          selectedFunction: { nodeId: 'fn1', filePath: 'src/main.ts', functionName: 'main' },
          viewMode: 'code',
        }),
        diagramCache,
      );
      expect(result.needsMicroAssembly).toBe(true);
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it('should handle selectedFunction for flowchart mode', () => {
      const result = computeViewModeTransition(
        'flowchart',
        makeState({
          selectedFunction: { nodeId: 'fn1', filePath: 'src/main.ts', functionName: 'process' },
          viewMode: 'code',
        }),
        diagramCache,
      );
      expect(result.needsMicroAssembly).toBe(true);
    });

    it('should handle selectedFunction for sequence mode', () => {
      const result = computeViewModeTransition(
        'sequence',
        makeState({
          selectedFunction: { nodeId: 'fn1', filePath: 'src/main.ts', functionName: 'interact' },
          viewMode: 'code',
        }),
        diagramCache,
      );
      expect(result.needsMicroAssembly).toBe(true);
    });
  });
});
