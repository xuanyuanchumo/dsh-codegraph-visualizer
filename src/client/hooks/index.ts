// Custom hooks for graph visualization
import { useState, useEffect, useCallback, useRef } from 'react';

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
 * Track previous value for comparison.
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

/**
 * Keyboard shortcut handler.
 * Use case: Ctrl+L for layout switch, / for search, etc.
 */
export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  options: {
    ctrl?: boolean;
    meta?: boolean;
    alt?: boolean;
    shift?: boolean;
    preventDefault?: boolean;
  } = {}
): void {
  const { ctrl = false, meta = false, alt = false, shift = false, preventDefault = true } = options;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const keyMatch = e.key === key;
      const ctrlMatch = !ctrl || e.ctrlKey;
      const metaMatch = !meta || e.metaKey;
      const altMatch = !alt || e.altKey;
      const shiftMatch = !shift || e.shiftKey;

      if (keyMatch && ctrlMatch && metaMatch && altMatch && shiftMatch) {
        if (preventDefault) e.preventDefault();
        callback();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: !preventDefault });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [key, ctrl, meta, alt, shift, preventDefault, callback]);
}

/**
 * Polling hook for real-time updates.
 * Use case: refresh graph data periodically.
 */
export function usePolling(
  callback: () => void,
  interval: number,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled || interval <= 0) return;

    const id = setInterval(() => {
      if (!document.hidden) {
        callback();
      }
    }, interval);

    return () => clearInterval(id);
  }, [callback, interval, enabled]);
}

/**
 * Media query hook for responsive design.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}