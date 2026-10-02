import { useEffect, useRef, useCallback } from 'react';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import { NodeId } from '../../types/index.ts';
import type { TooltipData, EdgeTooltipData } from '../components/GraphTooltip.tsx';
import { useGraphStore } from '../store/graphStore.ts';
import { PREFETCH } from '../../shared/constants.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('panel');

interface GetDataApi {
  getSelectedNodeData: () => GraphNode | ClusterNode | null;
  getNodeData: (id: string) => GraphNode | ClusterNode | null;
  getEdgeData: (id: string) => GraphEdge | null;
}

interface UseNodeInteractionOpts {
  setSelectedNode: (id: NodeId | null) => void;
  setSelectedNodeData: (data: GraphNode | ClusterNode | null) => void;
  getDataRef: React.RefObject<GetDataApi | null>;
  adjacencyMap: Map<string, { in: number; out: number }>;
  setTooltip: (tooltip: TooltipData | EdgeTooltipData | null) => void;

  expandedNodeIds: Set<string>;
  collapseNode: (id: string) => void;
  expandNode: (id: string) => void;
  handleSelectFunction: (nodeId: string, filePath: string, functionName: string, mode: 'cfg' | 'flowchart' | 'sequence') => void;
  setFocusNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  handleNodeDoubleTapRef: React.MutableRefObject<(nodeId: string) => void>;
}

interface UseNodeInteractionReturn {
  handleNodeTap: (id: NodeId) => void;
  handleNodeDoubleTap: (nodeId: string) => void;
  handleNodeHover: (nodeId: string, pos: { x: number; y: number }) => void;
  handleNodeHoverOut: () => void;
  handleNodeHoverPrefetch: (nodeId: string) => void;
  handleEdgeHover: (edgeId: string, pos: { x: number; y: number }) => void;
  handleEdgeHoverOut: () => void;
  handleEdgeTap: (edgeId: string, pos: { x: number; y: number }) => void;
}

export function useNodeInteraction(opts: UseNodeInteractionOpts): UseNodeInteractionReturn {
  const {
    setSelectedNode, setSelectedNodeData, getDataRef, adjacencyMap,
    setTooltip, expandedNodeIds, collapseNode, expandNode,
    handleSelectFunction, setFocusNodeId, handleNodeDoubleTapRef,
  } = opts;

  const handleNodeTap = useCallback((id: NodeId) => {
    try {
      setSelectedNode(id);
      const data = getDataRef.current?.getNodeData(id) ?? null;
      setSelectedNodeData(data);
    } catch (err) {
      log.error('handleNodeTap failed', { id, err });
    }
  }, [setSelectedNode, setSelectedNodeData, getDataRef]);

  const handleNodeDoubleTap = useCallback((nodeId: string) => {
    handleNodeDoubleTapRef.current(nodeId);
  }, [handleNodeDoubleTapRef]);

  const handleNodeHover = useCallback((nodeId: string, pos: { x: number; y: number }) => {
    try {
      const data = getDataRef.current?.getNodeData(nodeId);
      if (data) {
        const counts = adjacencyMap.get(nodeId) ?? { in: 0, out: 0 };
        setTooltip({ x: pos.x, y: pos.y, name: data.label, path: `${data.filePath}:${data.lineNumber}`, type: data.type, linksIn: counts.in, linksOut: counts.out });
      }
    } catch (err) {
      log.error('handleNodeHover failed', { nodeId, err });
    }
  }, [adjacencyMap, getDataRef, setTooltip]);

  const handleNodeHoverOut = useCallback(() => setTooltip(null), [setTooltip]);

  const hoverPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNodeHoverPrefetch = useCallback((nodeId: string) => {
    if (hoverPrefetchTimerRef.current) clearTimeout(hoverPrefetchTimerRef.current);
    hoverPrefetchTimerRef.current = setTimeout(() => {
      useGraphStore.getState().prefetchExpand(nodeId);
    }, PREFETCH.HOVER_DEBOUNCE_MS);
  }, []);
  useEffect(() => () => { if (hoverPrefetchTimerRef.current) clearTimeout(hoverPrefetchTimerRef.current); }, []);

  const handleEdgeHover = useCallback((edgeId: string, pos: { x: number; y: number }) => {
    const edgeData = getDataRef.current?.getEdgeData(edgeId);
    if (edgeData) {
      const sourceNode = getDataRef.current?.getNodeData(edgeData.source);
      const targetNode = getDataRef.current?.getNodeData(edgeData.target);
      setTooltip({
        x: pos.x, y: pos.y,
        sourceLabel: sourceNode?.label ?? edgeData.source,
        targetLabel: targetNode?.label ?? edgeData.target,
        edgeType: edgeData.type,
      });
    }
  }, [getDataRef, setTooltip]);

  const handleEdgeHoverOut = useCallback(() => setTooltip(null), [setTooltip]);

  const handleEdgeTap = useCallback((edgeId: string, pos: { x: number; y: number }) => {
    try {
      const edgeData = getDataRef.current?.getEdgeData(edgeId);
      if (edgeData) {
        const sourceNode = getDataRef.current?.getNodeData(edgeData.source);
        const targetNode = getDataRef.current?.getNodeData(edgeData.target);
        setTooltip({
          x: pos.x, y: pos.y,
          sourceLabel: sourceNode?.label ?? edgeData.source,
          targetLabel: targetNode?.label ?? edgeData.target,
          edgeType: edgeData.type,
        });
      }
    } catch (err) {
      log.error('handleEdgeTap failed', { edgeId, err });
    }
  }, [getDataRef, setTooltip]);

  useEffect(() => {
    handleNodeDoubleTapRef.current = (nodeId: string) => {
      try {
        const data = getDataRef.current?.getNodeData(nodeId);
        const isClusterNode = data ? ('isCluster' in data && data.isCluster === true) : nodeId.startsWith('cluster__') || nodeId.startsWith('filecluster__') || nodeId.startsWith('subgroup__');
        if (isClusterNode) {
          const isExpanded = expandedNodeIds.has(nodeId);
          if (isExpanded) collapseNode(nodeId);
          else expandNode(nodeId);
        } else if (data && data.type === 'function') {
          setSelectedNode(NodeId(nodeId));
          setSelectedNodeData(data);
        } else {
          setFocusNodeId((prev) => {
            if (prev === nodeId) {
              setSelectedNode(null);
              return null;
            }
            setSelectedNode(null);
            return nodeId;
          });
        }
      } catch (err) {
        log.error('handleNodeDoubleTap failed', { nodeId, err });
      }
    };
  }, [expandedNodeIds, collapseNode, expandNode, handleSelectFunction, setSelectedNode, setSelectedNodeData, setFocusNodeId, getDataRef, handleNodeDoubleTapRef]);

  return {
    handleNodeTap, handleNodeDoubleTap, handleNodeHover, handleNodeHoverOut,
    handleNodeHoverPrefetch, handleEdgeHover, handleEdgeHoverOut, handleEdgeTap,
  };
}