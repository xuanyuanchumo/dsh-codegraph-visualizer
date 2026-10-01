import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { computeClusteredGraph } from './cluster/index.ts';
import type { ClusterNode, ClusterResult } from './cluster/index.ts';
import { estimateExpandCost, invalidateExpandCostCache } from './cluster/progressiveCluster.ts';
import { tryIncrementalOrFull, type IncrementalClusterContext } from './cluster/incrementalCluster.ts';
import { DiagramCache, ClusterCache, computeDataHash } from '../cache/DiagramCache.ts';
import { IndexedDBCache } from '../cache/IndexedDBCache.ts';
import { invalidateCssVarCache } from '../renderer/styles/ThemeStylesheet.ts';
import { scoped } from '../../shared/Logger.ts';
import { type ThemeType, isLayeredViewMode } from '../../shared/viewModeUtils.ts';
import type { LayeredDiagram } from '../diagram/index.ts';
import { CallChainAggregator } from '../diagram/CallChainAggregator.ts';
import { CLUSTER, PREFETCH, FUNCTION_BODY, POLLING, getDynamicMaxVisibleNodes } from '../../shared/constants.ts';
import { measureSync } from '../../shared/PerformanceMonitor.ts';
import type { GraphState } from './types.ts';

export const log = scoped('store');

export const diagramCache = new DiagramCache(10);
export const clusterCache = new ClusterCache(20);
export const callChainAggregator = new CallChainAggregator();

export const internals = {
  persistentCache: null as IndexedDBCache | null,
  persistentCacheRepoId: null as string | null,
  microAssemblyGeneration: 0,
  multiAssemblyGeneration: 0,
  incrementalClusterCtx: null as IncrementalClusterContext | null,
  prefetchInFlightCount: 0,
  prefetchAbortControllers: new Map<string, AbortController>(),
  expandAbortControllers: new Map<string, AbortController>(),
  expandGeneration: 0,
  restoreGeneration: 0,
  restoreTimeoutHandle: null as ReturnType<typeof setTimeout> | null,
  restoreAbortController: null as AbortController | null,
  prefetchIdleHandle: null as ReturnType<typeof requestIdleCallback> | ReturnType<typeof setTimeout> | null,
  loadingFailsafe: null as ReturnType<typeof setTimeout> | null,
};

let _getState: (() => GraphState) | null = null;
export function registerStoreGetter(getter: () => GraphState): void { _getState = getter; }
function getState(): GraphState { return _getState!(); }

export function detectInitialTheme(): ThemeType {
  if (typeof document === 'undefined') return 'dark';
  return document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light';
}

export function computeMaxVisible(panelWidth: number | null | undefined): number {
  return panelWidth !== null && panelWidth !== undefined
    ? getDynamicMaxVisibleNodes(panelWidth)
    : CLUSTER.MAX_VISIBLE_NODES;
}

export function enforceFunctionBodyBudget(
  expanded: Set<string>,
  rawNodes: GraphNode[],
  maxExpanded: number,
): void {
  const functionIdSet = new Set(rawNodes.filter(n => n.type === 'function').map(n => n.id as string));
  const expandedFunctionBodies = [...expanded].filter(id => functionIdSet.has(id));
  while (expandedFunctionBodies.length > maxExpanded) {
    const oldest = expandedFunctionBodies.shift()!;
    expanded.delete(oldest);
  }
}

export function collapseExcessClusters(
  nodes: (GraphNode | ClusterNode)[],
  effectiveExpanded: Set<string>,
  maxVisible: number,
  costOffset: number,
  pinnedIds?: Set<string>,
): void {
  if (nodes.length + costOffset <= maxVisible) return;
  const clusterNodes = nodes.filter((n): n is ClusterNode => 'isCluster' in n && n.isCluster === true);
  const sorted = [...clusterNodes].sort((a, b) => b.childCount - a.childCount);
  for (const cn of sorted) {
    if (pinnedIds?.has(cn.id)) continue;
    if (nodes.length + costOffset - cn.childCount <= maxVisible) {
      effectiveExpanded.delete(cn.id);
      break;
    }
    effectiveExpanded.delete(cn.id);
  }
}

export function updateIncrementalClusterCtx(
  result: ClusterResult,
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
): void {
  const nodeIdToVisibleId = new Map<string, string>();
  for (const n of result.nodes) {
    if ('isCluster' in n && n.isCluster) {
      for (const childId of n.childIds) {
        nodeIdToVisibleId.set(childId, n.id);
      }
    } else {
      nodeIdToVisibleId.set(n.id, n.id);
    }
  }
  internals.incrementalClusterCtx = {
    prevResult: result,
    prevNodeIdToVisibleId: nodeIdToVisibleId,
    prevRawNodes: rawNodes,
    prevRawEdges: rawEdges,
  };
}

type SetFn = (partial: Partial<GraphState>) => void;

export function mergeAndRecluster(
  newNodes: GraphNode[],
  newEdges: GraphEdge[],
  set: SetFn,
  logLabel: string,
  logDetail: Record<string, unknown>,
): void {
  const s = getState();
  const existingIds = new Set(s.rawNodes.map((n) => n.id));
  const filteredNodes = newNodes.filter((n) => !existingIds.has(n.id));
  const existingEdgeIds = new Set(s.rawEdges.map((e) => e.id));
  const filteredEdges = newEdges.filter((e) => !existingEdgeIds.has(e.id));
  if (filteredNodes.length === 0 && filteredEdges.length === 0) return;
  const mergedRawNodes = [...s.rawNodes, ...filteredNodes];
  const mergedRawEdges = [...s.rawEdges, ...filteredEdges];
  const { clusterDepth: cd, expandedNodeIds: ei, panelWidth: pw } = s;
  const result = tryIncrementalOrFull(
    internals.incrementalClusterCtx,
    mergedRawNodes, mergedRawEdges,
    ei, cd, pw ?? undefined,
  );
  updateIncrementalClusterCtx(result, mergedRawNodes, mergedRawEdges);
  set({ rawNodes: mergedRawNodes, rawEdges: mergedRawEdges, nodes: result.nodes, edges: result.edges });
  log.info(logLabel, { ...logDetail, newNodes: filteredNodes.length, newEdges: filteredEdges.length });
}

export function computeLayeredExpandedView(
  diagramData: LayeredDiagram,
  currentLayer: number,
  expandedNodeIds: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const layer = diagramData.layers[currentLayer];
  if (!layer) return { nodes: [], edges: [] };

  const inEdgesMap = new Map<string, string[]>();
  for (const e of diagramData.allEdges) {
    const list = inEdgesMap.get(e.target) ?? [];
    list.push(e.source);
    inEdgesMap.set(e.target, list);
  }

  const visibleIds = new Set<string>(layer.nodeIds);
  const queue: string[] = [];
  for (const id of expandedNodeIds) {
    if (visibleIds.has(id)) queue.push(id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const children = inEdgesMap.get(id) ?? [];
    for (const childId of children) {
      if (!visibleIds.has(childId)) {
        visibleIds.add(childId);
        if (expandedNodeIds.has(childId)) queue.push(childId);
      }
    }
  }

  const visibleNodes = diagramData.allNodes.filter((n) => visibleIds.has(n.id));
  const visibleEdges = diagramData.allEdges.filter(
    (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
  );

  return { nodes: visibleNodes, edges: visibleEdges };
}

export function clearLoadingFailsafe(): void {
  if (internals.loadingFailsafe !== null) {
    clearTimeout(internals.loadingFailsafe);
    internals.loadingFailsafe = null;
  }
}

export function applyClusterUpdate(
  newExpanded: Set<string>,
  newExpandedByViewMode: Record<string, Set<string>>,
  viewMode: GraphState['viewMode'],
  diagramData: LayeredDiagram | null,
  currentLayer: number,
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  clusterDepth: number,
  cache: ClusterCache,
  set: SetFn,
): void {
  if (isLayeredViewMode(viewMode)) {
    if (diagramData) {
      const { nodes: visNodes, edges: visEdges } = computeLayeredExpandedView(diagramData, currentLayer, newExpanded);
      set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: visNodes, edges: visEdges });
    } else {
      set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode });
    }
    return;
  }
  let sourceNodes = rawNodes;
  let sourceEdges = rawEdges;
  if (diagramData) {
    const layer = diagramData.layers[currentLayer] ?? diagramData.layers[0];
    if (layer) {
      sourceNodes = layer.nodes;
      sourceEdges = layer.edges;
    }
  }
  const dataHash = computeDataHash(sourceNodes, sourceEdges);
  const expandedKey = [...newExpanded].sort().join(',');
  const cacheLevel = `progressive:${clusterDepth}`;
  const cached = cache.get(dataHash, cacheLevel, expandedKey);
  if (cached) {
    set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: cached.nodes, edges: cached.edges });
    return;
  }
  const result = measureSync('cluster', () => computeClusteredGraph(sourceNodes, sourceEdges, 'progressive', newExpanded, clusterDepth, getState().panelWidth ?? undefined));
  cache.set(dataHash, cacheLevel, expandedKey, result);
  set({ expandedNodeIds: newExpanded, expandedNodeIdsByViewMode: newExpandedByViewMode, nodes: result.nodes, edges: result.edges });
}

export { invalidateCssVarCache };
export { POLLING };
export { PREFETCH };
export { FUNCTION_BODY };
export { estimateExpandCost };
export { invalidateExpandCostCache };
export { tryIncrementalOrFull };
export { computeDataHash };
export { isLayeredViewMode };
export { measureSync };
export { ClusterCache };
export { DiagramCache };
export { IndexedDBCache };
export type { IncrementalClusterContext };
export type { LayeredDiagram };
export type { ClusterResult };
export type { GraphState };