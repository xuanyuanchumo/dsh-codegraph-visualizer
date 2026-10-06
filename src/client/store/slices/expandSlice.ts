import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { GraphState, AstPageInfo } from '../types.ts';
import { CLUSTER, PREFETCH, RESTORE, FUNCTION_BODY, SYMBOL_AST } from '../../../shared/constants.ts';
import { isLayeredViewMode } from '../../../shared/viewModeUtils.ts';
import { fetchNodeChildren, fetchBootstrap, fetchFileOutline, fetchSymbolAST } from '../../api/index.ts';
import { readUrlExpand, restoreExpandedNodeIds } from '../../utils/urlState.ts';
import { measureAsync } from '../../../shared/PerformanceMonitor.ts';
import {
  internals, log, clusterCache,
  computeMaxVisible, enforceFunctionBodyBudget, collapseExcessClusters,
  mergeAndRecluster,
  estimateExpandCost, tryIncrementalOrFull, updateIncrementalClusterCtx,
  computeDataHash, measureSync, replaceController, reclusterWith,
} from '../internals.ts';
import { computeClusteredGraph } from '../cluster/index.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

function truncateAstData(data: { astNodes: GraphNode[]; astEdges: GraphEdge[]; sourceLines: string[] }): {
  astNodes: GraphNode[];
  astEdges: GraphEdge[];
  sourceLines: string[];
} {
  const astNodes = data.astNodes.length > SYMBOL_AST.MAX_NODES
    ? data.astNodes.slice(0, SYMBOL_AST.MAX_NODES)
    : data.astNodes;
  const sourceLines = data.sourceLines.length > SYMBOL_AST.MAX_SOURCE_LINES
    ? data.sourceLines.slice(0, SYMBOL_AST.MAX_SOURCE_LINES)
    : data.sourceLines;
  const astNodeIds = new Set(astNodes.map(n => n.id));
  const astEdges = data.astEdges.filter(e => astNodeIds.has(e.source) && astNodeIds.has(e.target));
  return { astNodes, astEdges, sourceLines };
}

/**
 * 记录单个符号 AST 的分段加载进度。
 *
 * 服务端按 `SYMBOL_AST.MAX_NODES` 切页并回传 `total` / `cursor` / `hasMore`；
 * 这里把进度落到 store，面板才能披露「已折叠」并提供「分段加载」。
 * 缺字段（旧缓存或旧服务端）时退化为「本页即全部」，不误报 hasMore。
 */
function recordAstPage(
  _set: SetFn,
  _get: GetFn,
  nodeId: string,
  page: AstPageInfo,
): void {
  const astPageByNodeId = new Map(_get().astPageByNodeId);
  astPageByNodeId.set(nodeId, page);
  _set({ astPageByNodeId });
}

/**
 * 加载单个函数体的 AST 并合并进图谱（缓存优先）。
 *
 * 从 `expandNode` 中抽出，供「展开全部」这类批量入口复用：
 * 批量场景下必须共用同一个 `gen`，否则每次调用 `expandNode` 都会
 * `++expandGeneration` 而把前一次仍在飞行中的 AST 结果判为过期丢弃。
 *
 * @param gen 调用方持有的展开代际；回调执行时若已过期则整体放弃写入。
 * @param cursor 分段加载起点；首页传 0。
 */
async function loadFunctionBodyAst(
  nodeId: string,
  signal: AbortSignal,
  gen: number,
  _set: SetFn,
  _get: GetFn,
  cursor = 0,
): Promise<void> {
  // 本节点自己的请求令牌：`expandGeneration` 在普通 expand/collapse 时也会前进，
  // 不能用来判断「这个节点最新一页」的归属；否则快速连点「分段加载」时，
  // 先返回的旧页会把新页的进度覆盖掉。
  const seq = (internals.astRequestSeq.get(nodeId) ?? 0) + 1;
  internals.astRequestSeq.set(nodeId, seq);
  const isCurrent = () => internals.astRequestSeq.get(nodeId) === seq;

  // 只有首页才读缓存：缓存里存的是一页，后续页必须回源，
  // 否则「分段加载」会反复命中同一页而永远前进不了。
  if (cursor === 0 && internals.persistentCache) {
    const cached = await internals.persistentCache.getAST(nodeId);
    if (cached && gen === internals.expandGeneration && isCurrent()) {
      const data = cached as { astNodes: GraphNode[]; astEdges: GraphEdge[]; sourceLines: string[] };
      if (data.astNodes.length > 0) {
        const { astNodes: truncatedAstNodes, astEdges: truncatedAstEdges, sourceLines: truncatedSourceLines } = truncateAstData(data);
        mergeAndRecluster(truncatedAstNodes, truncatedAstEdges, _set, 'symbol AST loaded (cache)', { nodeId, sourceLines: truncatedSourceLines.length });
        return;
      }
    }
  }

  try {
    const data = await measureAsync('ast-fetch', () => fetchSymbolAST(nodeId, signal, _get().currentWorkspace, cursor));
    if (gen !== internals.expandGeneration || !isCurrent()) return;
    if (!data) return;
    const { astNodes: truncatedAstNodes, astEdges: truncatedAstEdges, sourceLines: truncatedSourceLines } = truncateAstData(data);
    if (truncatedAstNodes.length < data.astNodes.length) {
      log.warn('symbol AST truncated', { nodeId, original: data.astNodes.length, truncated: truncatedAstNodes.length });
    }
    if (truncatedAstNodes.length > 0) {
      mergeAndRecluster(truncatedAstNodes, truncatedAstEdges, _set, 'symbol AST loaded', { nodeId, sourceLines: truncatedSourceLines.length });
    }
    // 即使本页为空也要落进度：服务端可能只是 `cursor` 越界，
    // 记下 total/hasMore 才能让面板如实显示「已加载 x / y」而不是永远停在旧值。
    // 缺字段（旧服务端或测试替身）退化为「本页即全部」，绝不虚报 hasMore。
    const previouslyLoaded = cursor === 0 ? 0 : (_get().astPageByNodeId.get(nodeId)?.loaded ?? 0);
    const loaded = previouslyLoaded + truncatedAstNodes.length;
    recordAstPage(_set, _get, nodeId, {
      loaded,
      total: typeof data.total === 'number' ? data.total : loaded,
      hasMore: data.hasMore === true,
      cursor: typeof data.cursor === 'number' ? data.cursor : cursor + truncatedAstNodes.length,
    });
    // 分页结果不得写缓存：缓存只存完整的一页，否则下次首页命中缓存后
    // 会把 hasMore 状态毒化，用户再也点不出「分段加载」。
    if (internals.persistentCache && !data.hasMore && cursor === 0) {
      await internals.persistentCache.setAST(nodeId, data);
    }
  } catch (err) {
    log.warn('expandNode: fetchSymbolAST failed', { nodeId, err });
  }
}

export function createExpandSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    expandedNodeIds: new Set(),
    expandedNodeIdsByViewMode: {},
    loadedChildrenByNodeId: new Set(),
    prefetchedNodeIds: new Set(),
    loadErrorsByNodeId: new Map(),
    pendingRequests: new Map(),
    pinnedIds: new Set(),
    astPageByNodeId: new Map(),
    expandNode: (nodeId: string) => {
      const { rawNodes, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, nodes, panelWidth } = _get();
      const gen = ++internals.expandGeneration;
      const cost = estimateExpandCost(nodeId, rawNodes);
      const maxVisible = computeMaxVisible(panelWidth);
      const effectiveExpanded = new Set(expandedNodeIds);
      const expandingFunctionBody = rawNodes.some((n) => n.id === nodeId && n.type === 'function');
      // 单点展开同样必须认 pinned：否则「展开全部」固定住的那批函数体会被
      // 随后任意一次单点展开按插入序驱逐，pin 的语义就被破坏了。
      const pinnedIds = _get().pinnedIds;
      if (expandingFunctionBody) {
        enforceFunctionBodyBudget(effectiveExpanded, rawNodes, FUNCTION_BODY.MAX_EXPANDED - 1, pinnedIds);
      }
      effectiveExpanded.add(nodeId);
      collapseExcessClusters(nodes, effectiveExpanded, maxVisible, cost, pinnedIds);
      if (cost > CLUSTER.EXPAND_BUDGET_SINGLE) {
        log.warn('expand budget exceeded', { nodeId, cost, budget: CLUSTER.EXPAND_BUDGET_SINGLE });
      }
      const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: effectiveExpanded };
      reclusterWith(_get, _set, effectiveExpanded, newExpandedByViewMode);

      const node = rawNodes.find((n) => n.id === nodeId);
      if (node) {
        const expandController = replaceController(internals.expandAbortControllers, nodeId);
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
          loadFunctionBodyAst(nodeId, expandController.signal, gen, _set, _get);
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
      const gen = internals.expandGeneration;
      try {
        const signal = options?.signal ?? controller.signal;
        const data = await fetchNodeChildren(nodeId, undefined, undefined, signal, _get().currentWorkspace);
        if (gen !== internals.expandGeneration) return;
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
        if (!data) {
          log.info('bootstrap returned no payload, falling back to full load');
          return false;
        }
        _get().setIndexStatus(data.indexStatus);
        if (data.indexStatus === 'building') {
          // The server side index for this workspace is still being built. Install the
          // empty skeleton for the new repoId (so a workspace switch never keeps showing
          // the previous repository) and wait for the `graph-updated` SSE event instead of
          // escalating to an error / full-scan fallback, which would break the first-paint
          // contract of one bootstrap request per workspace.
          _get().setBootstrapData(
            data.topLevelNodes,
            data.edges,
            data.metadata.repoId,
            { totalNodeCount: data.metadata.totalNodeCount, totalEdgeCount: data.metadata.totalEdgeCount, timestamp: data.metadata.timestamp },
          );
          log.info('bootstrap: index building, empty skeleton installed', { repoId: data.metadata.repoId });
          return true;
        }
        if (data.topLevelNodes.length === 0) {
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
      const { rawNodes, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, nodes, panelWidth } = _get();
      if (nodeIds.length === 0) return;
      const maxVisible = computeMaxVisible(panelWidth);
      const effectiveExpanded = new Set(expandedNodeIds);
      for (const nodeId of nodeIds) {
        effectiveExpanded.add(nodeId);
      }
      // 批量展开必须认 pinned：NodeDetail 的「展开全部」先把目标函数 pinNode 固定，
      // 再调本动作；若这里不把 pinnedIds 传给预算，用户刚刚显式确认过的批量展开
      // 会被预算立刻折回 MAX_EXPANDED 个，形成「确认了却又被自动撤销」的矛盾。
      const pinnedIds = _get().pinnedIds;
      enforceFunctionBodyBudget(effectiveExpanded, rawNodes, FUNCTION_BODY.MAX_EXPANDED, pinnedIds);
      collapseExcessClusters(nodes, effectiveExpanded, maxVisible, 0, pinnedIds);
      const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: effectiveExpanded };
      reclusterWith(_get, _set, effectiveExpanded, newExpandedByViewMode);
    },
    /**
     * 分段加载：继续取回被单符号预算折叠掉的 AST 部分。
     *
     * 服务端按 `SYMBOL_AST.MAX_NODES` 切页并回报 `cursor`/`hasMore`，
     * 这里用上一页的 `cursor` 续取下一页并合并进图谱。
     * 返回是否取得了新内容（`false` = 已到末尾或当前没有可续取的页）。
     */
    loadMoreAst: async (nodeId: string): Promise<boolean> => {
      const page = _get().astPageByNodeId.get(nodeId);
      if (!page || !page.hasMore) return false;
      const node = _get().rawNodes.find((n) => n.id === nodeId);
      if (!node || node.type !== 'function') return false;
      const gen = internals.expandGeneration;
      const controller = replaceController(internals.expandAbortControllers, `ast:${nodeId}`);
      try {
        await loadFunctionBodyAst(nodeId, controller.signal, gen, _set, _get, page.cursor);
      } finally {
        internals.expandAbortControllers.delete(`ast:${nodeId}`);
      }
      const next = _get().astPageByNodeId.get(nodeId);
      return next !== undefined && next.loaded > page.loaded;
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

      const controller = replaceController(internals.prefetchAbortControllers, nodeId);

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
        internals.prefetchIdleHandle = requestIdleCallback(runPrefetch, { timeout: PREFETCH.IDLE_TIMEOUT_MS });
      } else {
        internals.prefetchIdleHandle = setTimeout(runPrefetch, 0);
      }
    },
    collapseNode: (nodeId: string) => {
      const { expandedNodeIds, expandedNodeIdsByViewMode, viewMode, pinnedIds } = _get();
      if (pinnedIds.has(nodeId)) return;
      const newExpanded = new Set(expandedNodeIds);
      newExpanded.delete(nodeId);
      const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: newExpanded };
      reclusterWith(_get, _set, newExpanded, newExpandedByViewMode);
    },
    collapseAll: () => {
      const { expandedNodeIdsByViewMode, viewMode, pinnedIds } = _get();
      const newExpanded = new Set(pinnedIds);
      const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: newExpanded };
      reclusterWith(_get, _set, newExpanded, newExpandedByViewMode);
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
        await new Promise<void>((r) => { internals.restoreTimeoutHandle = setTimeout(r, RESTORE.STEP_DELAY_MS); });
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