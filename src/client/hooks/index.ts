// Custom hooks for graph visualization
import { useEffect, useRef } from 'react';

export { useGraphRenderer } from './useGraphRenderer.ts';
export { usePanelResize } from './usePanelResize.ts';

export { useFocusMode } from './useFocusMode.ts';
export { useNodeInteraction } from './useNodeInteraction.ts';
export { useGraphDerivedValues } from './useGraphDerivedValues.ts';
export { useWorkspaceHandlers } from './useWorkspaceHandlers.ts';
export { useAdjacencyMap } from './useAdjacencyMap.ts';
export { usePanelSizeApply } from './usePanelSizeApply.ts';
export { useVisibleNodeCount } from './useVisibleNodeCount.ts';
export { useDeadCodeMarker } from './useDeadCodeMarker.ts';
export { useWorkspaceEventListener } from './useWorkspaceEventListener.ts';
export { useUrlExpandSync } from './useUrlExpandSync.ts';
export { usePanelVisibility } from './usePanelVisibility.ts';

export { usePanelState } from './usePanelState.ts';
export { usePanelKeyboard } from './usePanelKeyboard.ts';
export { useViewMode } from './useViewMode.ts';
export { useAnalysisPanels } from './useAnalysisPanels.ts';
export { useNodeSearch } from './useNodeSearch.ts';
export { useKeyboardShortcut } from './useKeyboardShortcut.ts';
export { useDebounce } from './useDebounce.ts';
export { useExpandedFunctionBodyCount } from './useExpandedFunctionBodyCount.ts';
export {
  useGraphData, useGraphDisplay, useGraphInteraction, useGraphStatus,
  useGraphWorkspace, useGraphAnalysis, useGraphPerformance, useGraphActions,
  usePanelDimensions,
} from './useGraphSelectors.ts';

export function usePolling(
  callback: () => void,
  interval: number,
  enabled = true
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled || interval <= 0) return;

    const id = setInterval(() => {
      if (!document.hidden) {
        callbackRef.current();
      }
    }, interval);

    return () => clearInterval(id);
  }, [interval, enabled]);
}

