import type { GraphNode, GraphEdge, ViewMode } from '../../types/index.ts';
import type { LayeredDiagram } from '../diagram/index.ts';
import { assembleDiagram } from '../diagram/index.ts';
import { computeClusteredGraph } from './cluster/index.ts';
import { DiagramCache, computeDataHash } from '../cache/DiagramCache.ts';


export type LayoutType = 'cose' | 'dagre' | 'circle' | 'grid' | 'radial' | 'tree';

export const VIEW_MODE_LAYOUT: Record<ViewMode, LayoutType> = {
  code: 'cose',
  dependencies: 'dagre',
  inheritance: 'tree',
  callgraph: 'dagre',
  package: 'tree',
  class: 'dagre',
  cfg: 'dagre',
  flowchart: 'dagre',
  sequence: 'grid',
};

function isLayeredViewMode(mode: ViewMode): boolean {
  return mode === 'inheritance' || mode === 'callgraph' || mode === 'package' || mode === 'class' || mode === 'dependencies';
}

interface ViewModeTransitionState {
  rawNodes: GraphNode[];
  rawEdges: GraphEdge[];
  savedRawNodes: GraphNode[];
  savedRawEdges: GraphEdge[];
  clusterDepth: number;
  expandedNodeIds: Set<string>;
  expandedNodeIdsByViewMode: Record<string, Set<string>>;
  selectedFunction: { nodeId: string; filePath: string; functionName: string } | null;
  viewMode: ViewMode;
}

interface ViewModeTransitionResult {
  viewMode: ViewMode;
  diagramData: LayeredDiagram | null;
  currentLayer: number;
  layout: LayoutType;
  rawNodes?: GraphNode[];
  rawEdges?: GraphEdge[];
  savedRawNodes?: GraphNode[];
  savedRawEdges?: GraphEdge[];
  expandedNodeIds: Set<string>;
  expandedNodeIdsByViewMode: Record<string, Set<string>>;
  nodes: (GraphNode | import('./cluster/index.ts').ClusterNode)[];
  edges: (GraphEdge | import('./cluster/index.ts').ClusterEdge)[];
}

function getLayeredDiagram(
  viewMode: ViewMode,
  sourceNodes: GraphNode[],
  sourceEdges: GraphEdge[],
  diagramCache: DiagramCache,
): LayeredDiagram | null {
  const dataHash = computeDataHash(sourceNodes, sourceEdges);
  const cached = diagramCache.get(viewMode, dataHash);
  if (cached) return cached;
  const diagram = assembleDiagram(viewMode, sourceNodes, sourceEdges);
  if (diagram) diagramCache.set(viewMode, dataHash, diagram);
  return diagram;
}

function getFirstLayerNodes(diagram: LayeredDiagram): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const layer = diagram.layers[0];
  return layer
    ? { nodes: layer.nodes, edges: layer.edges }
    : { nodes: diagram.allNodes, edges: diagram.allEdges };
}

export function computeViewModeTransition(
  newViewMode: ViewMode,
  state: ViewModeTransitionState,
  diagramCache: DiagramCache,

): ViewModeTransitionResult & { needsMicroAssembly?: boolean } {
  const { rawNodes, rawEdges, clusterDepth, expandedNodeIds, expandedNodeIdsByViewMode, selectedFunction, savedRawNodes, savedRawEdges, viewMode: prevViewMode } = state;
  const recommendedLayout = VIEW_MODE_LAYOUT[newViewMode];

  const savedExpanded = expandedNodeIdsByViewMode[newViewMode] ?? new Set<string>();
  const prevExpanded = new Set(expandedNodeIds);
  const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [prevViewMode]: prevExpanded };

  if (newViewMode === 'code') {
    const restoreNodes = savedRawNodes.length > 0 ? savedRawNodes : rawNodes;
    const restoreEdges = savedRawEdges.length > 0 ? savedRawEdges : rawEdges;
    const result = computeClusteredGraph(restoreNodes, restoreEdges, 'progressive', savedExpanded, clusterDepth);
    return {
      viewMode: newViewMode, diagramData: null, currentLayer: 0, layout: recommendedLayout,
      rawNodes: restoreNodes, rawEdges: restoreEdges,
      savedRawNodes: [], savedRawEdges: [],
      expandedNodeIds: savedExpanded,
      expandedNodeIdsByViewMode: newExpandedByViewMode,
      nodes: result.nodes, edges: result.edges,
    };
  }

  if (newViewMode === 'dependencies') {
    const sourceNodes = savedRawNodes.length > 0 ? savedRawNodes : rawNodes;
    const sourceEdges = savedRawEdges.length > 0 ? savedRawEdges : rawEdges;
    const diagram = getLayeredDiagram(newViewMode, sourceNodes, sourceEdges, diagramCache);
    if (diagram) {
      const { nodes, edges } = getFirstLayerNodes(diagram);
      return {
        viewMode: newViewMode, diagramData: diagram, currentLayer: 0, layout: recommendedLayout,
        savedRawNodes: rawNodes, savedRawEdges: rawEdges,
        expandedNodeIds: savedExpanded,
        expandedNodeIdsByViewMode: newExpandedByViewMode,
        nodes, edges,
      };
    }
    return {
      viewMode: newViewMode, diagramData: null, currentLayer: 0, layout: recommendedLayout,
      savedRawNodes: rawNodes, savedRawEdges: rawEdges,
      expandedNodeIds: savedExpanded,
      expandedNodeIdsByViewMode: newExpandedByViewMode,
      nodes: rawNodes, edges: rawEdges,
    };
  }

  if (isLayeredViewMode(newViewMode)) {
    const sourceNodes = savedRawNodes.length > 0 ? savedRawNodes : rawNodes;
    const sourceEdges = savedRawEdges.length > 0 ? savedRawEdges : rawEdges;
    const diagram = getLayeredDiagram(newViewMode, sourceNodes, sourceEdges, diagramCache);
    if (diagram) {
      const { nodes, edges } = getFirstLayerNodes(diagram);
      return {
        viewMode: newViewMode, diagramData: diagram, currentLayer: 0, layout: recommendedLayout,
        savedRawNodes: sourceNodes, savedRawEdges: sourceEdges,
        expandedNodeIds: savedExpanded,
        expandedNodeIdsByViewMode: newExpandedByViewMode,
        nodes, edges,
      };
    }
  }

  if (newViewMode === 'cfg' || newViewMode === 'flowchart' || newViewMode === 'sequence') {
    if (selectedFunction) {
      return {
        viewMode: newViewMode, diagramData: null, currentLayer: 0, layout: recommendedLayout,
        expandedNodeIdsByViewMode: newExpandedByViewMode,
        expandedNodeIds: savedExpanded,
        nodes: [], edges: [],
        needsMicroAssembly: true,
      };
    }
    return {
      viewMode: newViewMode, diagramData: null, currentLayer: 0, layout: recommendedLayout,
      expandedNodeIdsByViewMode: newExpandedByViewMode,
      expandedNodeIds: savedExpanded,
      nodes: [], edges: [],
    };
  }

  const result = computeClusteredGraph(rawNodes, rawEdges, 'progressive', savedExpanded, clusterDepth);
  return {
    viewMode: newViewMode, diagramData: null, currentLayer: 0, layout: recommendedLayout,
    expandedNodeIds: savedExpanded,
    expandedNodeIdsByViewMode: newExpandedByViewMode,
    nodes: result.nodes, edges: result.edges,
  };
}
