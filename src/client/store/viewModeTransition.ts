import type { GraphNode, GraphEdge, ViewMode } from '../../types/index.ts';
import type { LayeredDiagram } from '../diagram/index.ts';
import { assembleDiagram } from '../diagram/index.ts';
import { computeClusteredGraph } from './cluster/index.ts';
import { DiagramCache, computeDataHash } from '../cache/DiagramCache.ts';
import { type LayoutType, VIEW_MODE_LAYOUT, isLayeredViewMode } from '../../shared/viewModeUtils.ts';

export { VIEW_MODE_LAYOUT };

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
      savedRawNodes: restoreNodes, savedRawEdges: restoreEdges,
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

  /**
   * 运行时层（cycle-88，P2-1 三层独立面板）。
   *
   * 必须显式返回空 `nodes`/`edges`，**不能**落到下面的 `computeClusteredGraph`
   * 兜底分支：兜底会按 clusterDepth 生成聚类节点，于是切到运行时层时用户会看到
   * 一张与结构层几乎一样的图——这违反验收原文 `docs/图谱按需加载.md:202`
   * 「三层不要同时叠加到一张图。切换层时替换子图，而不是追加节点。」
   *
   * 运行时层的数据面是 `RuntimePanel` 里的进程内日志与性能指标，不是图节点，
   * 因此「替换子图」在这一层的正确形态就是**空子图**（`diagramData: null`，
   * 图谱容器由 `GraphPanel` 的 `isRuntimeView` 隐藏）。
   *
   * `savedRawNodes` / `savedRawEdges` 刻意**不**在这里覆盖：它们保存的是结构层
   * 的原始图，切回 `code` 时 `computeViewModeTransition` 的 `'code'` 分支要靠
   * 它们还原（`:72-73`）。若在这里清空，用户从运行时层切回代码图谱会得到空图。
   */
  if (newViewMode === 'runtime') {
    return {
      viewMode: newViewMode, diagramData: null, currentLayer: 0, layout: recommendedLayout,
      expandedNodeIdsByViewMode: newExpandedByViewMode,
      expandedNodeIds: savedExpanded,
      nodes: [], edges: [],
    };
  }

  const result = computeClusteredGraph(savedRawNodes.length > 0 ? savedRawNodes : rawNodes, savedRawEdges.length > 0 ? savedRawEdges : rawEdges, 'progressive', savedExpanded, clusterDepth);
  return {
    viewMode: newViewMode, diagramData: null, currentLayer: 0, layout: recommendedLayout,
    savedRawNodes: savedRawNodes.length > 0 ? savedRawNodes : rawNodes,
    savedRawEdges: savedRawEdges.length > 0 ? savedRawEdges : rawEdges,
    expandedNodeIds: savedExpanded,
    expandedNodeIdsByViewMode: newExpandedByViewMode,
    nodes: result.nodes, edges: result.edges,
  };
}
