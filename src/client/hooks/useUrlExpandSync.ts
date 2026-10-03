import { useEffect } from 'react';
import { updateUrlExpand } from '../utils/urlState.ts';

export function useUrlExpandSync(expandedNodeIds: Set<string>, urlRestored: boolean) {
  useEffect(() => {
    if (!urlRestored) return;
    updateUrlExpand(expandedNodeIds);
  }, [expandedNodeIds, urlRestored]);
}