import { useEffect, type RefObject } from 'react';

interface UseDeadCodeMarkerParams {
  showDeadCode: boolean;
  deadCodeResult: { unreachableNodes: string[] } | null;
  rendererRef: RefObject<{ markDeadCode: (ids: Set<string>) => void; clearDeadCodeMarks: () => void } | null>;
}

export function useDeadCodeMarker({ showDeadCode, deadCodeResult, rendererRef }: UseDeadCodeMarkerParams) {
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (showDeadCode && deadCodeResult) {
      r.markDeadCode(new Set(deadCodeResult.unreachableNodes));
    } else {
      r.clearDeadCodeMarks();
    }
  }, [showDeadCode, deadCodeResult, rendererRef]);
}