import type { GraphNode, GraphEdge, GraphDelta } from '../../../types/index.ts';
import type { GraphState } from '../types.ts';
import type { LayeredDiagram } from '../../diagram/index.ts';
import { CYCLE_DETECTION, CLUSTER, RENDERER } from '../../../shared/constants.ts';
import { sanitizeTypedGraph } from '../../../shared/GraphValidator.ts';
import { isLayeredViewMode } from '../../../shared/viewModeUtils.ts';
import {
  applyGraphDelta as applyDeltaToSkeleton, canApplyGraphDelta, graphDeltaSize, GRAPH_DELTA_SHRINK,
} from '../../../shared/graphDelta.ts';
import { assembleDiagram } from '../../diagram/index.ts';
import { clearEtagCache } from '../../api/index.ts';
import { emptyEdgeState, emptyDiffState } from './edgeSlice.ts';
import {
  diagramCache, clusterCache, internals, clearLoadingFailsafe, log,
  IndexedDBCache, tryIncrementalOrFull, updateIncrementalClusterCtx, computeDataHash,
  abortAllControllers,
} from '../internals.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

export function createGraphDataSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    nodes: [],
    edges: [],
    rawNodes: [],
    rawEdges: [],
    savedRawNodes: [],
    savedRawEdges: [],
    repoId: null,
    truncated: false,
    totalNodeCount: 0,
    totalEdgeCount: 0,
    // 璇玑图增量引擎健康信号（cycle-122）：null = 本轮没走增量（StatusBar 不显示）。
    xuanjiSignal: null,
    setXuanjiSignal: (signal) => _set({ xuanjiSignal: signal }),
    setGraphData: (nodes: GraphNode[], edges: GraphEdge[], repoId: string, metadata?: { truncated?: boolean; totalNodeCount?: number; totalEdgeCount?: number; timestamp?: number; etag?: string | null; xuanji?: { applied: boolean; addedPaths?: number; degradedRules?: readonly string[]; invariantViolations?: readonly string[] } }) => {
      try {
        clearLoadingFailsafe();
        // 整图替换会把 rawNodes 重置为"仅服务端来源"的节点，并把派生容器清空（`emptyEdgeState()`）——
        // 于是合并进来的 outline / AST / 子节点全部消失。此时按需路由的校验值缓存**必须**一起失效：
        // 否则同版本下重新展开会带着旧校验值拿到 304，而客户端已经没有那份数据，节点永远加载不出来。
        // 这是"真 304 仍然是错的"：校验器只保证服务端没变，不保证客户端还留着那份载荷。
        clearEtagCache();
        internals.expandGeneration++;
        const prevPending = _get().pendingRequests;
        abortAllControllers(prevPending);
        if (internals.persistentCacheRepoId !== repoId) {
          if (internals.persistentCache) internals.persistentCache.close();
          internals.persistentCache = new IndexedDBCache(repoId);
          internals.persistentCacheRepoId = repoId;
          diagramCache.setPersistentBackend(internals.persistentCache);
          clusterCache.setPersistentBackend(internals.persistentCache);
        }
        const { clusterDepth, expandedNodeIds, viewMode, currentLayer } = _get();
        const sanitized = sanitizeTypedGraph(nodes, edges);
        const newDegradations: string[] = [];
        if (sanitized.nodes.length > CYCLE_DETECTION.MAX_NODES_FOR_DETECTION) {
          newDegradations.push('cycle-detection-skipped');
        }
        if (sanitized.nodes.length > CLUSTER.MAX_NODES_FOR_LABEL_PROP) {
          newDegradations.push('community-detection-sampled');
        }
        if (sanitized.nodes.length > RENDERER.LARGE_GRAPH_NODE_THRESHOLD) {
          newDegradations.push('large-graph-mode');
        }
        let displayNodes = sanitized.nodes;
        let displayEdges = sanitized.edges;
        let diagramData: LayeredDiagram | null = null;
        const isLayeredView = isLayeredViewMode(viewMode);
        if (isLayeredView) {
          const dataHash = computeDataHash(sanitized.nodes, sanitized.edges);
          const cached = diagramCache.get(viewMode, dataHash);
          if (cached) {
            diagramData = cached;
          } else {
            diagramData = assembleDiagram(viewMode, sanitized.nodes, sanitized.edges);
            if (diagramData) diagramCache.set(viewMode, dataHash, diagramData);
          }
          if (diagramData) {
            const layer = diagramData.layers[currentLayer] ?? diagramData.layers[0];
            if (layer) {
              displayNodes = layer.nodes;
              displayEdges = layer.edges;
            }
          }
          _set({
            rawNodes: sanitized.nodes, rawEdges: sanitized.edges,
            nodes: displayNodes, edges: displayEdges,
            diagramData,
            repoId, error: null, isLoading: false,
            // 服务端给了时间戳就用服务端时钟，否则退回本地时钟（仅供 StatusBar 展示）。
            lastUpdated: metadata?.timestamp ?? Date.now(),
            graphEtag: metadata?.etag ?? null,
            truncated: !!metadata?.truncated,
            totalNodeCount: metadata?.totalNodeCount ?? sanitized.nodes.length,
            totalEdgeCount: metadata?.totalEdgeCount ?? sanitized.edges.length,
            healthScore: null,
            ruleViolations: [],
            performanceDegradations: newDegradations,
            // 璇玑图增量信号：载荷带了就存（含降级清单），没带 = 本轮非增量路径 ⇒ 显式清 null
            // （旧信号残留在状态条上会比没有信号更糟——它描述的是上一轮的引擎状态）。
            xuanjiSignal: metadata?.xuanji ?? null,
            pendingRequests: new Map(),
            loadErrorsByNodeId: new Map(),
            ...emptyEdgeState(),
            ...emptyDiffState(),
          });
          return;
        }
        const result = tryIncrementalOrFull(
          internals.incrementalClusterCtx,
          displayNodes, displayEdges,
          expandedNodeIds, clusterDepth,
          _get().panelWidth ?? undefined,
        );
        updateIncrementalClusterCtx(result, sanitized.nodes, sanitized.edges);
        _set({
          rawNodes: sanitized.nodes, rawEdges: sanitized.edges,
          nodes: result.nodes, edges: result.edges,
          diagramData,
          repoId, error: null, isLoading: false,
          lastUpdated: metadata?.timestamp ?? Date.now(),
          graphEtag: metadata?.etag ?? null,
          truncated: !!metadata?.truncated,
          totalNodeCount: metadata?.totalNodeCount ?? sanitized.nodes.length,
          totalEdgeCount: metadata?.totalEdgeCount ?? sanitized.edges.length,
          healthScore: null,
          ruleViolations: [],
          performanceDegradations: newDegradations,
          // 同上：增量信号与载荷同一次落库（没带 = 显式清 null，防旧信号残留）。
          xuanjiSignal: metadata?.xuanji ?? null,
          pendingRequests: new Map(),
          loadErrorsByNodeId: new Map(),
          ...emptyEdgeState(),
          ...emptyDiffState(),
        });
      } catch (err) {
        log.error('setGraphData failed', { err });
        _set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
      }
    },
    setBootstrapData: (rootNodes: GraphNode[], edges: GraphEdge[], repoId: string, metadata: { totalNodeCount: number; totalEdgeCount: number; timestamp: number }) => {
      try {
        clearLoadingFailsafe();
        // 与 setGraphData 同理：首屏 bootstrap 会重置 rawNodes 与派生容器，
        // 但服务端 revision 可能没变，旧的按需校验值一旦回传就会得到 304 而客户端手里已无数据。
        clearEtagCache();
        internals.expandGeneration++;
        const prevPending = _get().pendingRequests;
        abortAllControllers(prevPending);
        internals.incrementalClusterCtx = null;
        const sanitized = sanitizeTypedGraph(rootNodes, edges);
        const { clusterDepth, expandedNodeIds, viewMode, panelWidth } = _get();
        const isLayeredView = isLayeredViewMode(viewMode);
        let displayNodes = sanitized.nodes;
        let displayEdges = sanitized.edges;
        let diagramData: LayeredDiagram | null = null;
        if (isLayeredView) {
          const dataHash = computeDataHash(sanitized.nodes, sanitized.edges);
          const cached = diagramCache.get(viewMode, dataHash);
          if (cached) {
            diagramData = cached;
          } else {
            diagramData = assembleDiagram(viewMode, sanitized.nodes, sanitized.edges);
            if (diagramData) diagramCache.set(viewMode, dataHash, diagramData);
          }
          if (diagramData) {
            const layer = diagramData.layers[0];
            if (layer) {
              displayNodes = layer.nodes;
              displayEdges = layer.edges;
            }
          }
        } else {
          const result = tryIncrementalOrFull(
            internals.incrementalClusterCtx,
            sanitized.nodes, sanitized.edges,
            expandedNodeIds, clusterDepth,
            panelWidth ?? undefined,
          );
          updateIncrementalClusterCtx(result, sanitized.nodes, sanitized.edges);
          displayNodes = result.nodes;
          displayEdges = result.edges;
        }
        _set({
          rawNodes: sanitized.nodes,
          rawEdges: sanitized.edges,
          nodes: displayNodes,
          edges: displayEdges,
          diagramData,
          repoId,
          error: null,
          isLoading: false,
          lastUpdated: metadata.timestamp,
          // bootstrap 走的是另一个端点（`/api/v1/codegraph/bootstrap`），不带 `/data` 的 etag：
          // 沿用旧校验值会让下一次 `/data` 请求带上一个与当前画布不对应的校验值，可能假 304。
          graphEtag: null,
          truncated: false,
          totalNodeCount: metadata.totalNodeCount,
          totalEdgeCount: metadata.totalEdgeCount,
          healthScore: null,
          ruleViolations: [],
          performanceDegradations: [],
          expandedNodeIds: new Set(),
          expandedNodeIdsByViewMode: {},
          loadedChildrenByNodeId: new Set(),
          prefetchedNodeIds: new Set(),
          pendingRequests: new Map(),
          loadErrorsByNodeId: new Map(),
          ...emptyEdgeState(),
          ...emptyDiffState(),
        });
        log.info('bootstrap data set', { rootNodes: sanitized.nodes.length, totalNodeCount: metadata.totalNodeCount });
      } catch (err) {
        log.error('setBootstrapData failed', { err });
        _set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
      }
    },
    clearGraph: () => {
      clearLoadingFailsafe();
      // 图被清空，派生容器同时清空；校验值缓存描述的是"服务端某版本对应的那份载荷"，
      // 客户端已不持有任何载荷，留着只会让下次展开拿到 304。
      clearEtagCache();
      internals.expandGeneration++;
      const prevPending = _get().pendingRequests;
      abortAllControllers(prevPending);
      internals.incrementalClusterCtx = null;
      _set({ nodes: [], edges: [], rawNodes: [], rawEdges: [], savedRawNodes: [], savedRawEdges: [], repoId: null, error: null, isLoading: false, lastUpdated: 0, graphEtag: null, truncated: false, totalNodeCount: 0, totalEdgeCount: 0, loadedChildrenByNodeId: new Set(), prefetchedNodeIds: new Set(), pendingRequests: new Map(), loadErrorsByNodeId: new Map(), ...emptyEdgeState(), ...emptyDiffState() });
    },
    applyGraphDelta: (delta: GraphDelta): boolean => {
      // The delta describes a specific revision. If the store has drifted (a full `graph/data`
      // landed mid-flight, a reconnect skipped events, the graph was cleared) applying it would
      // silently drop or resurrect entries, so refuse and let the caller re-bootstrap instead.
      const { rawNodes, rawEdges } = _get();
      // 防缩水阈值与 host 侧共用 `GRAPH_DELTA_SHRINK.MIN_RETAIN_RATIO`：一处拦一处放，问题只会
      // 被推迟到另一条路径上。拒绝的代价是回落到一次全量重取，接受错误缩水的代价是静默丢图。
      if (!canApplyGraphDelta({ nodes: rawNodes, edges: rawEdges }, delta, {
        minRetainRatio: GRAPH_DELTA_SHRINK.MIN_RETAIN_RATIO,
      })) {
        log.info('applyGraphDelta refused: delta does not match the current revision or would shrink the graph', {
          storedNodes: rawNodes.length, storedEdges: rawEdges.length, ...graphDeltaSize(delta),
        });
        return false;
      }
      try {
        clearLoadingFailsafe();
        // 与 :286 把 `graphEtag` 置 null 同一条推理，只是对象换成按需路由的校验值缓存：
        // 增量补丁落地后派生容器已被 `emptyEdgeState()` 清空，而"新版本"只是由时间戳推进。
        // 若两次更新落在同一毫秒（时间戳即 revision，粒度不足），旧校验值就会匹配上新版本并回 304，
        // 而客户端手里已无数据 ⇒ 静默失效。清空使下一次取数必然 200，代价只是一次传输。
        clearEtagCache();
        // Bump the generation like a full set does: in-flight expand/prefetch requests were computed
        // against the pre-delta revision and must not write their stale children into the new one.
        internals.expandGeneration++;
        const prevPending = _get().pendingRequests;
        abortAllControllers(prevPending);
        internals.incrementalClusterCtx = null;

        const folded = applyDeltaToSkeleton({ nodes: rawNodes, edges: rawEdges }, delta);
        const sanitized = sanitizeTypedGraph(folded.nodes, folded.edges);
        const { clusterDepth, expandedNodeIds, viewMode, currentLayer, panelWidth } = _get();
        const isLayeredView = isLayeredViewMode(viewMode);

        let displayNodes = sanitized.nodes;
        let displayEdges = sanitized.edges;
        let diagramData: LayeredDiagram | null = null;
        if (isLayeredView) {
          const dataHash = computeDataHash(sanitized.nodes, sanitized.edges);
          const cached = diagramCache.get(viewMode, dataHash);
          if (cached) {
            diagramData = cached;
          } else {
            diagramData = assembleDiagram(viewMode, sanitized.nodes, sanitized.edges);
            if (diagramData) diagramCache.set(viewMode, dataHash, diagramData);
          }
          if (diagramData) {
            const layer = diagramData.layers[currentLayer] ?? diagramData.layers[0];
            if (layer) {
              displayNodes = layer.nodes;
              displayEdges = layer.edges;
            }
          }
        } else {
          const result = tryIncrementalOrFull(
            internals.incrementalClusterCtx,
            sanitized.nodes, sanitized.edges,
            expandedNodeIds, clusterDepth,
            panelWidth ?? undefined,
          );
          updateIncrementalClusterCtx(result, sanitized.nodes, sanitized.edges);
          displayNodes = result.nodes;
          displayEdges = result.edges;
        }

        _set({
          rawNodes: sanitized.nodes,
          rawEdges: sanitized.edges,
          nodes: displayNodes,
          edges: displayEdges,
          diagramData,
          error: null,
          isLoading: false,
          lastUpdated: Date.now(),
          // 增量补丁只描述"相对上一版的差异"，不带 `/data` 的新 etag：补丁应用后画布已前进到
          // 一个新版本，而手上仍是旧版本的校验值。留着它下次请求就可能被服务端判成 304，
          // 于是真实更新被静默吞掉；置 null 让下一次取数必然回 200，代价只是少省一次传输。
          graphEtag: null,
          totalNodeCount: sanitized.nodes.length,
          totalEdgeCount: sanitized.edges.length,
          pendingRequests: new Map(),
          loadErrorsByNodeId: new Map(),
          ...emptyEdgeState(),
          ...emptyDiffState(),
        });
        log.info('applied graph delta', {
          addedNodes: delta.addedNodes.length,
          removedNodes: delta.removedNodes.length,
          modifiedNodes: delta.modifiedNodes.length,
          addedEdges: delta.addedEdges.length,
          removedEdges: delta.removedEdges.length,
          modifiedEdges: delta.modifiedEdges.length,
        });
        return true;
      } catch (err) {
        log.error('applyGraphDelta failed', { err });
        _set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
        return false;
      }
    },
  };
}