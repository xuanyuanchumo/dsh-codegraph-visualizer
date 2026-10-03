import { useEffect, useState, type RefObject } from 'react';

interface UseVisibleNodeCountParams {
  filterType: string;
  graphType: string;
  fanInThreshold: number;
  fanOutThreshold: number;
  visibleNodeTypes: Set<string>;
  visibleEdgeTypes: Set<string>;
  rendererRef: RefObject<{ getVisibleNodeCount: () => number } | null>;
  nodesLength: number;
}

export function useVisibleNodeCount({
  filterType, graphType, fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes, rendererRef, nodesLength,
}: UseVisibleNodeCountParams) {
  const [visibleNodeCount, setVisibleNodeCount] = useState(0);
  const [hasHiddenNodes, setHasHiddenNodes] = useState(false);

  useEffect(() => {
    const count = rendererRef.current?.getVisibleNodeCount() ?? 0;
    setVisibleNodeCount(count);
    setHasHiddenNodes(count < nodesLength);
  }, [filterType, graphType, fanInThreshold, fanOutThreshold, visibleNodeTypes, visibleEdgeTypes, rendererRef, nodesLength]);

  return { visibleNodeCount, hasHiddenNodes };
}