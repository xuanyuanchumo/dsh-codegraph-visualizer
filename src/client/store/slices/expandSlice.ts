import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { GraphState } from '../types.ts';
import { CLUSTER, PREFETCH, FUNCTION_BODY, SYMBOL_AST } from '../../../shared/constants.ts';
import { isLayeredViewMode } from '../../../shared/viewModeUtils.ts';
import { fetchNodeChildren, fetchBootstrap, fetchFileOutline, fetchSymbolAST } from '../../api/index.ts';
import { readUrlExpand, restoreExpandedNodeIds } from '../../utils/urlState.ts';
import { measureAsync } from '../../../shared/PerformanceMonitor.ts';
import {
  internals, log, clusterCache,
  computeMaxVisible, enforceFunctionBodyBudget, collapseExcessClusters,
  mergeAndRecluster, applyClusterUpdate,
  estimateExpandCost, tryIncrementalOrFull, updateIncrementalClusterCtx,
  computeDataHash, measureSync,
} from '../internals.ts';
import { computeClusteredGraph } from '../cluster/index.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

export function createExpandSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    expandedNodeIds: new Set(),
    expandedNodeIdsByViewMode: {},
    loadedChildrenByNodeId: new Set(),
    prefetchedNodeIds: new Set(),
    loadErrorsByNodeId: new Map(),
    pendingRequests: new Map(),
    pinnedIds: new Set(),
    expandNode: (nodeId: string) => {
      const { rawNodes, rawEdges, clusterDepth, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer, nodes, panelWidth } = _get();
      const gen = ++internals.expandGeneration;
      const cost = estimateExpandCost(nodeId, rawNodes);
      const maxVisible = computeMaxVisible(panelWidth);
      const effectiveExpanded = new Set(expandedNodeIds);
      const expandingFunctionBody = rawNodes.some((n) => n.id === nodeId && n.type === 'function');
      if (expandingFunctionBody) {
        enforceFunctionBodyBudget(effectiveExpanded, rawNodes, FUNCTION_BODY.MAX_EXPANDED - 1);
      }
      effectiveExpanded.add(nodeId);
      collapseExcessClusters(nodes, effectiveExpanded, maxVisible, cost, _get().pinnedIds);
      if (cost > CLUSTER.EXPAND_BUDGET_SINGLE) {
        log.warn('expand budget exceeded', { nodeId, cost, budget: CLUSTER.EXPAND_BUDGET_SINGLE });
      }
      const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: effectiveExpanded };
      applyClusterUpdate(effectiveExpanded, newExpandedByViewMode, viewMode, diagramData, currentLayer, rawNodes, rawEdges, clusterDepth, clusterCache, _set);

      const node = rawNodes.find((n) => n.id === nodeId);
      if (node) {
        const prevExpandController = internals.expandAbortControllers.get(nodeId);
        if (prevExpandController) prevExpandController.abort();
        const expandController = new AbortController();
        internals.expandAbortControllers.set(nodeId, expandController);
        _get().loadNodeChildren(nodeId, { signal: expandController.signal }).catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          log.warn('expandNode: loadNodeChildren failed', { nodeId, err });
        }).finally(() => {
          internals.expandAbortControllers.delete(nodeId);
        });
        if (node.type === 'module') {
          (async () => {
            if (internals.persistentCache) {
              const cached = await internals.persistentCache.getOutline(nodeId);
              if (cached && gen === internals.expandGeneration) {
                const data = cached as { symbols: GraphNode[]; edges: GraphEdge[] };
                if (data.symbols.length > 0) {
                  mergeAndRecluster(data.symbols, data.edges, _set, 'file outline loaded (cache)', { nodeId });
                  return;
                }
              }
            }
            fetchFileOutline(nodeId, expandController.signal, _get().currentWorkspace).then(async (data) => {
              if (gen !== internals.expandGeneration) return;
              if (data && data.symbols.length > 0) {
                mergeAndRecluster(data.symbols, data.edges, _set, 'file outline loaded', { nodeId });
                if (internals.persistentCache) {
                  await internals.persistentCache.setOutline(nodeId, data);
                }
              }
            }).catch((err) => {
              log.warn('expandNode: fetchFileOutline failed', { nodeId, err });
            });
          })();
        }
        if (node.type === 'function') {
          (async () => {
            if (internals.persistentCache) {
              const cached = await internals.persistentCache.getAST(nodeId);
              if (cached && gen === internals.expandGeneration) {
                const data = cached as { astNodes: GraphNode[]; astEdges: GraphEdge[]; sourceLines: string[] };
                if (data.astNodes.length > 0) {
                  const truncatedAstNodes = data.astNodes.length > SYMBOL_AST.MAX_NODES
                    ? data.astNodes.slice(0, SYMBOL_AST.MAX_NODES)
                    : data.astNodes;
                  const truncatedSourceLines = data.sourceLines.length > SYMBOL_AST.MAX_SOURCE_LINES
                    ? data.sourceLines.slice(0, SYMBOL_AST.MAX_SOURCE_LINES)
                    : data.sourceLines;
                  const astNodeIds = new Set(truncatedAstNodes.map(n => n.id));
                  const truncatedAstEdges = data.astEdges.filter(e => astNodeIds.has(e.source) && astNodeIds.has(e.target));
                  mergeAndRecluster(truncatedAstNodes, truncatedAstEdges, _set, 'symbol AST loaded (cache)', { nodeId, sourceLines: truncatedSourceLines.length });
                  return;
                }
              }
            }
            measureAsync('ast-fetch', () => fetchSymbolAST(nodeId, expandController.signal, _get().currentWorkspace)).then(async (data) => {
              if (gen !== internals.expandGeneration) return;
              if (data && data.astNodes.length > 0) {
                const truncatedAstNodes = data.astNodes.length > SYMBOL_AST.MAX_NODES
                  ? data.astNodes.slice(0, SYMBOL_AST.MAX_NODES)
                  : data.astNodes;
                const truncatedSourceLines = data.sourceLines.length > SYMBOL_AST.MAX_SOURCE_LINES
                  ? data.sourceLines.slice(0, SYMBOL_AST.MAX_SOURCE_LINES)
                  : data.sourceLines;
                const astNodeIds = new Set(truncatedAstNodes.map(n => n.id));
                const truncatedAstEdges = data.astEdges.filter(e => astNodeIds.has(e.source) && astNodeIds.has(e.target));
                if (truncatedAstNodes.length < data.astNodes.length) {
                  log.warn('symbol AST truncated', { nodeId, original: data.astNodes.length, truncated: truncatedAstNodes.length });
                }
                mergeAndRecluster(truncatedAstNodes, truncatedAstEdges, _set, 'symbol AST loaded', { nodeId, sourceLines: truncatedSourceLines.length });
                if (internals.persistentCache) {
                  await internals.persistentCache.setAST(nodeId, data);
                }
              }
            }).catch((err) => {
              log.warn('expandNode: fetchSymbolAST failed', { nodeId, err });
            });
          })();
        }
      }
    },
    loadNodeChildren: async (nodeId: string, options?: { signal?: AbortSignal }) => {
      const state = _get();
      if (state.loadedChildrenByNodeId.has(nodeId)) return;
      const hasChildren = state.rawNodes.some((n) => n.parentId === nodeId || n.id.startsWith(nodeId + '/'));
      if (hasChildren) {
        const newLoaded = new Set(state.loadedChildrenByNodeId);
        newLoaded.add(nodeId);
        _set({ loadedChildrenByNodeId: newLoaded });
        return;
      }
      const controller = new AbortController();
      const newPending = new Map(state.pendingRequests);
      newPending.set(nodeId, controller);
      _set({ pendingRequests: newPending });
      try {
        const signal = options?.signal ?? controller.signal;
        const data = await fetchNodeChildren(nodeId, undefined, undefined, signal, _get().currentWorkspace);
        if (!data || data.nodes.length === 0) {
          const newLoaded = new Set(_get().loadedChildrenByNodeId);
          newLoaded.add(nodeId);
          const clearedPending = new Map(_get().pendingRequests);
          clearedPending.delete(nodeId);
          _set({ loadedChildrenByNodeId: newLoaded, pendingRequests: clearedPending });
          return;
        }
        const s2 = _get();
        const existingNodeIds = new Set(s2.rawNodes.map((n) => n.id));
        const newNodes = data.nodes.filter((n) => !existingNodeIds.has(n.id));
        const existingEdgeIds = new Set(s2.rawEdges.map((e) => e.id));
        const newEdges = data.edges.filter((e) => !existingEdgeIds.has(e.id));
        if (newNodes.length === 0 && newEdges.length === 0) {
          const newLoaded = new Set(s2.loadedChildrenByNodeId);
          newLoaded.add(nodeId);
          const clearedPending = new Map(s2.pendingRequests);
          clearedPending.delete(nodeId);
          _set({ loadedChildrenByNodeId: newLoaded, pendingRequests: clearedPending });
          return;
        }
        const mergedRawNodes = [...s2.rawNodes, ...newNodes];
        const mergedRawEdges = [...s2.rawEdges, ...newEdges];
        const newLoaded = new Set(s2.loadedChildrenByNodeId);
        newLoaded.add(nodeId);
        const clearedPending = new Map(s2.pendingRequests);
        clearedPending.delete(nodeId);
        const { clusterDepth, expandedNodeIds, panelWidth } = s2;
        const result = tryIncrementalOrFull(
          internals.incrementalClusterCtx,
          mergedRawNodes, mergedRawEdges,
          expandedNodeIds, clusterDepth,
          panelWidth ?? undefined,
        );
        updateIncrementalClusterCtx(result, mergedRawNodes, mergedRawEdges);
        _set({
          rawNodes: mergedRawNodes,
          rawEdges: mergedRawEdges,
          nodes: result.nodes,
          edges: result.edges,
          loadedChildrenByNodeId: newLoaded,
          pendingRequests: clearedPending,
        });
        log.info('node children loaded', { nodeId, newNodes: newNodes.length, newEdges: newEdges.length });
      } catch (err) {
        const clearedPending = new Map(_get().pendingRequests);
        clearedPending.delete(nodeId);
        if (err instanceof DOMException && err.name === 'AbortError') {
          _set({ pendingRequests: clearedPending });
          return;
        }
        const newErrors = new Map(_get().loadErrorsByNodeId);
        newErrors.set(nodeId, err instanceof Error ? err.message : String(err));
        _set({ pendingRequests: clearedPending, loadErrorsByNodeId: newErrors });
        log.warn('loadNodeChildren failed', { nodeId, err });
      }
    },
    loadBootstrap: async () => {
      try {
        const ws = _get().currentWorkspace;
        const data = await fetchBootstrap(undefined, ws);
        if (!data || data.topLevelNodes.length === 0) {
          log.info('bootstrap returned empty, falling back to full load');
          return false;
        }
        const state = _get();
        state.setBootstrapData(
          data.topLevelNodes,
          data.edges,
          data.metadata.repoId,
          { totalNodeCount: data.metadata.totalNodeCount, totalEdgeCount: data.metadata.totalEdgeCount, timestamp: data.metadata.timestamp },
        );
        log.info('bootstrap loaded', {
          rootNodes: data.topLevelNodes.length,
          totalNodeCount: data.metadata.totalNodeCount,
          indexStatus: data.indexStatus,
        });
        return true;
      } catch (err) {
        log.warn('loadBootstrap failed, falling back to full load', { err });
        return false;
      }
    },
    batchExpandNodes: (nodeIds: string[]) => {
      const { rawNodes, rawEdges, clusterDepth, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer, nodes, panelWidth } = _get();
      if (nodeIds.length === 0) return;
      const maxVisible = computeMaxVisible(panelWidth);
      const effectiveExpanded = new Set(expandedNodeIds);
      for (const nodeId of nodeIds) {
        effectiveExpanded.add(nodeId);
      }
      enforceFunctionBodyBudget(effectiveExpanded, rawNodes, FUNCTION_BODY.MAX_EXPANDED);
      collapseExcessClusters(nodes, effectiveExpanded, maxVisible, 0, _get().pinnedIds);
      const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: effectiveExpanded };
      applyClusterUpdate(effectiveExpanded, newExpandedByViewMode, viewMode, diagramData, currentLayer, rawNodes, rawEdges, clusterDepth, clusterCache, _set);
    },
    prefetchExpand: (nodeId: string) => {
      if (internals.prefetchInFlightCount >= PREFETCH.CONCURRENCY_LIMIT) return;
      const { rawNodes, rawEdges, clusterDepth, expandedNodeIds, viewMode, diagramData, currentLayer, loadedChildrenByNodeId, prefetchedNodeIds } = _get();
      if (isLayeredViewMode(viewMode)) return;
      if (expandedNodeIds.has(nodeId)) return;
      if (prefetchedNodeIds.has(nodeId)) return;
      const rawNode = rawNodes.find((n) => n.id === nodeId);
      if (rawNode?.type === 'function') return;
      const cost = estimateExpandCost(nodeId, rawNodes);
      if (cost > PREFETCH.COST_THRESHOLD) return;

      const prevController = internals.prefetchAbortControllers.get(nodeId);
      if (prevController) prevController.abort();
      const controller = new AbortController();
      internals.prefetchAbortControllers.set(nodeId, controller);

      const newPrefetched = new Set(prefetchedNodeIds);
      newPrefetched.add(nodeId);
      _set({ prefetchedNodeIds: newPrefetched });

      if (!loadedChildrenByNodeId.has(nodeId)) {
        internals.prefetchInFlightCount++;
        _get().loadNodeChildren(nodeId, { signal: controller.signal }).catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          const s = _get();
          const newErrors = new Map(s.loadErrorsByNodeId);
          newErrors.set(nodeId, err instanceof Error ? err.message : String(err));
          _set({ loadErrorsByNodeId: newErrors });
        }).finally(() => {
          internals.prefetchInFlightCount--;
          internals.prefetchAbortControllers.delete(nodeId);
        });
      }

      const newExpanded = new Set(expandedNodeIds);
      newExpanded.add(nodeId);
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
      if (clusterCache.get(dataHash, cacheLevel, expandedKey)) return;
      internals.prefetchInFlightCount++;
      const runPrefetch = () => {
        try {
          if (controller.signal.aborted) return;
          const result = measureSync('cluster', () => computeClusteredGraph(sourceNodes, sourceEdges, 'progressive', newExpanded, clusterDepth, _get().panelWidth ?? undefined));
          clusterCache.set(dataHash, cacheLevel, expandedKey, result);
        } finally {
          internals.prefetchInFlightCount--;
        }
      };
      if (internals.prefetchIdleHandle !== null) {
        if (typeof cancelIdleCallback === 'function' && typeof internals.prefetchIdleHandle === 'number') {
          cancelIdleCallback(internals.prefetchIdleHandle);
        } else {
          clearTimeout(internals.prefetchIdleHandle as ReturnType<typeof setTimeout>);
        }
        internals.prefetchIdleHandle = null;
        internals.prefetchInFlightCount--;
      }
      if (typeof requestIdleCallback === 'function') {
        internals.prefetchIdleHandle = requestIdleCallback(runPrefetch, { timeout: 2000 });
      } else {
        internals.prefetchIdleHandle = setTimeout(runPrefetch, 0);
      }
    },
    collapseNode: (nodeId: string) => {
      const { rawNodes, rawEdges, clusterDepth, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer, pinnedIds } = _get();
      if (pinnedIds.has(nodeId)) return;
      const newExpanded = new Set(expandedNodeIds);
      newExpanded.delete(nodeId);
      const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: newExpanded };
      applyClusterUpdate(newExpanded, newExpandedByViewMode, viewMode, diagramData, currentLayer, rawNodes, rawEdges, clusterDepth, clusterCache, _set);
    },
    collapseAll: () => {
      const { rawNodes, rawEdges, clusterDepth, expandedNodeIdsByViewMode, viewMode, diagramData, currentLayer, pinnedIds } = _get();
      const newExpanded = new Set(pinnedIds);
      const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: newExpanded };
      applyClusterUpdate(newExpanded, newExpandedByViewMode, viewMode, diagramData, currentLayer, rawNodes, rawEdges, clusterDepth, clusterCache, _set);
    },
    pinNode: (nodeId: string) => {
      const { pinnedIds } = _get();
      const newPinned = new Set(pinnedIds);
      newPinned.add(nodeId);
      _set({ pinnedIds: newPinned });
    },
    unpinNode: (nodeId: string) => {
      const { pinnedIds } = _get();
      const newPinned = new Set(pinnedIds);
      newPinned.delete(nodeId);
      _set({ pinnedIds: newPinned });
    },
    cancelPendingRequest: (nodeId: string) => {
      const { pendingRequests } = _get();
      const controller = pendingRequests.get(nodeId);
      if (controller) {
        controller.abort();
        const newPending = new Map(pendingRequests);
        newPending.delete(nodeId);
        _set({ pendingRequests: newPending });
      }
    },
    restoreFromUrl: async () => {
      if (typeof window === 'undefined') return;
      const parsed = readUrlExpand();
      if (parsed.expandedDirs.length === 0 && parsed.expandedFiles.length === 0 && parsed.expandedSymbols.length === 0) return;
      const allIds = restoreExpandedNodeIds(parsed);
      const sortedIds = [...allIds].sort((a, b) => {
        const depthA = a.split('/').length;
        const depthB = b.split('/').length;
        return depthA - depthB;
      });
      const gen = ++internals.restoreGeneration;
      if (internals.restoreAbortController) internals.restoreAbortController.abort();
      const restoreController = internals.restoreAbortController = new AbortController();
      for (const nodeId of sortedIds) {
        if (gen !== internals.restoreGeneration) { restoreController.abort(); return; }
        const state = _get();
        const exists = state.rawNodes.some((n) => n.id === nodeId);
        if (!exists) {
          const parentId = nodeId.includes('/') ? nodeId.substring(0, nodeId.lastIndexOf('/')) : null;
          if (parentId && !state.loadedChildrenByNodeId.has(parentId)) {
            await state.loadNodeChildren(parentId, { signal: restoreController.signal }).catch((err) => {
              if (!(err instanceof DOMException && err.name === 'AbortError')) {
                log.warn('restoreFromUrl: loadNodeChildren failed', { parentId, err });
              }
            });
          }
        }
        if (gen !== internals.restoreGeneration) { restoreController.abort(); return; }
        state.expandNode(nodeId);
        await new Promise<void>((r) => { internals.restoreTimeoutHandle = setTimeout(r, 50); });
        if (gen !== internals.restoreGeneration) {
          restoreController.abort();
          if (internals.restoreTimeoutHandle !== null) { clearTimeout(internals.restoreTimeoutHandle); internals.restoreTimeoutHandle = null; }
          return;
        }
      }
      internals.restoreTimeoutHandle = null;
      _set({ urlRestored: true });
      log.info('URL restore completed', { restoredCount: sortedIds.length });
    },
  };
}