import { useMemo } from 'react';
import { useGraphStore } from '../store/graphStore.ts';

export function useExpandedFunctionBodyCount(): { expandedFunctionCount: number; totalFunctionCount: number; expandedNodeIdsSize: number } {
  const expandedNodeIds = useGraphStore(s => s.expandedNodeIds);
  const rawNodes = useGraphStore(s => s.rawNodes);

  return useMemo(() => {
    const functionIdSet = new Set<string>();
    for (const n of rawNodes) {
      if (n.type === 'function') functionIdSet.add(n.id as string);
    }
    let expanded = 0;
    for (const id of expandedNodeIds) {
      if (functionIdSet.has(id)) expanded++;
    }
    return { expandedFunctionCount: expanded, totalFunctionCount: functionIdSet.size, expandedNodeIdsSize: expandedNodeIds.size };
  }, [expandedNodeIds, rawNodes]);
}