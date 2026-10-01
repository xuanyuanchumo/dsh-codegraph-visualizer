import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { GraphState } from '../types.ts';
import type { LayeredDiagram } from '../../diagram/index.ts';
import { CYCLE_DETECTION, CLUSTER, RENDERER } from '../../../shared/constants.ts';
import { sanitizeTypedGraph } from '../../../shared/GraphValidator.ts';
import { isLayeredViewMode } from '../../../shared/viewModeUtils.ts';
import { assembleDiagram } from '../../diagram/index.ts';
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
    setGraphData: (nodes: GraphNode[], edges: GraphEdge[], repoId: string, metadata?: { truncated?: boolean; totalNodeCount?: number; totalEdgeCount?: number }) => {
      try {
        clearLoadingFailsafe();
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
            repoId, error: null, isLoading: false, lastUpdated: Date.now(),
            truncated: !!metadata?.truncated,
            totalNodeCount: metadata?.totalNodeCount ?? sanitized.nodes.length,
            totalEdgeCount: metadata?.totalEdgeCount ?? sanitized.edges.length,
            healthScore: null,
            ruleViolations: [],
            performanceDegradations: newDegradations,
            pendingRequests: new Map(),
            loadErrorsByNodeId: new Map(),
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
          repoId, error: null, isLoading: false, lastUpdated: Date.now(),
          truncated: !!metadata?.truncated,
          totalNodeCount: metadata?.totalNodeCount ?? sanitized.nodes.length,
          totalEdgeCount: metadata?.totalEdgeCount ?? sanitized.edges.length,
          healthScore: null,
          ruleViolations: [],
          performanceDegradations: newDegradations,
          pendingRequests: new Map(),
          loadErrorsByNodeId: new Map(),
        });
      } catch (err) {
        log.error('setGraphData failed', { err });
        _set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
      }
    },
    setBootstrapData: (rootNodes: GraphNode[], edges: GraphEdge[], repoId: string, metadata: { totalNodeCount: number; totalEdgeCount: number; timestamp: number }) => {
      try {
        clearLoadingFailsafe();
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
          truncated: false,
          totalNodeCount: metadata.totalNodeCount,
          totalEdgeCount: metadata.totalEdgeCount,
          healthScore: null,
          ruleViolations: [],
          performanceDegradations: [],
          expandedNodeIds: new Set(),
          expandedNodeIdsByViewMode: {},
          pendingRequests: new Map(),
          loadErrorsByNodeId: new Map(),
        });
        log.info('bootstrap data set', { rootNodes: sanitized.nodes.length, totalNodeCount: metadata.totalNodeCount });
      } catch (err) {
        log.error('setBootstrapData failed', { err });
        _set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
      }
    },
    clearGraph: () => {
      clearLoadingFailsafe();
      internals.expandGeneration++;
      const prevPending = _get().pendingRequests;
      abortAllControllers(prevPending);
      internals.incrementalClusterCtx = null;
      _set({ nodes: [], edges: [], rawNodes: [], rawEdges: [], savedRawNodes: [], savedRawEdges: [], repoId: null, error: null, isLoading: false, lastUpdated: 0, truncated: false, totalNodeCount: 0, totalEdgeCount: 0, pendingRequests: new Map(), loadErrorsByNodeId: new Map() });
    },
  };
}