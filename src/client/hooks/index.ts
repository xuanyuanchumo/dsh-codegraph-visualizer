// Custom hooks for graph visualization
import { useState, useEffect, useRef } from 'react';

export { useGraphRenderer } from './useGraphRenderer.ts';
export { usePanelResize } from './usePanelResize.ts';
export { useSearchInteraction } from './useSearchInteraction.ts';
export { useFocusMode } from './useFocusMode.ts';
export { useNodeInteraction } from './useNodeInteraction.ts';
export { usePanelState } from './usePanelState.ts';
export { usePanelKeyboard } from './usePanelKeyboard.ts';
export { useViewMode } from './useViewMode.ts';
export { useAnalysisPanels } from './useAnalysisPanels.ts';
export { useNodeSearch } from './useNodeSearch.ts';
export { useKeyboardShortcut } from './useKeyboardShortcut.ts';
export {
  useGraphData, useGraphDisplay, useGraphInteraction, useGraphStatus,
  useGraphWorkspace, useGraphAnalysis, useGraphPerformance, useGraphActions,
  usePanelDimensions,
} from './useGraphSelectors.ts';

/**
 * Debounce a value with a delay.
 * Use case: search input, window resize, etc.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}

/**
 * Polling hook for real-time updates.
 * Use case: refresh graph data periodically.
 * The callback is kept in a ref so a new inline callback per render does not
 * tear down and recreate the interval (rerender cascade fix).
 */
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

