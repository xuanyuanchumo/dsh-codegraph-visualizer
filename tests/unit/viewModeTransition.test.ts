import { describe, it, expect } from 'vitest';
import { computeViewModeTransition, VIEW_MODE_LAYOUT } from '../../src/client/store/viewModeTransition.ts';
import { DiagramCache } from '../../src/client/cache/DiagramCache.ts';
import { makeNode, makeEdge } from '../helpers.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';

function makeState(overrides: Partial<{
  rawNodes: GraphNode[];
  rawEdges: GraphEdge[];
  savedRawNodes: GraphNode[];
  savedRawEdges: GraphEdge[];
  clusterDepth: number;
  expandedNodeIds: Set<string>;
  expandedNodeIdsByViewMode: Record<string, Set<string>>;
  selectedFunction: { nodeId: string; filePath: string; functionName: string } | null;
  viewMode: string;
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
    viewMode: 'code',
    ...overrides,
  };
}

describe('viewModeTransition', () => {
  const diagramCache = new DiagramCache(10);

  describe('VIEW_MODE_LAYOUT', () => {
    it('should map each view mode to a layout type', () => {
      expect(VIEW_MODE_LAYOUT.code).toBe('cose');
      expect(VIEW_MODE_LAYOUT.dependencies).toBe('dagre');
      expect(VIEW_MODE_LAYOUT.inheritance).toBe('tree');
      expect(VIEW_MODE_LAYOUT.callgraph).toBe('dagre');
      expect(VIEW_MODE_LAYOUT.package).toBe('tree');
      expect(VIEW_MODE_LAYOUT.class).toBe('dagre');
      expect(VIEW_MODE_LAYOUT.cfg).toBe('dagre');
      expect(VIEW_MODE_LAYOUT.flowchart).toBe('dagre');
      expect(VIEW_MODE_LAYOUT.sequence).toBe('grid');
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
      expect(result.savedRawNodes).toEqual([]);
      expect(result.savedRawEdges).toEqual([]);
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
          viewMode: 'code',
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
          viewMode: 'code',
        }),
        diagramCache,
      );
      expect(result.viewMode).toBe('code');
      expect(result.diagramData).toBeNull();
      expect(result.nodes.length).toBeGreaterThan(0);
    });
  });
});