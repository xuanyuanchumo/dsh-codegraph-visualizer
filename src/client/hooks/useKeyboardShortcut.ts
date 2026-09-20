import { useRef, useEffect } from 'react';

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
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isEscape = e.key === 'Escape';
      const isSlash = e.key === '/';

      if (!isEscape && !isSlash) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      }

      const keyMatch = e.key.toLowerCase() === key.toLowerCase();
      const ctrlMatch = !ctrl || e.ctrlKey;
      const metaMatch = !meta || e.metaKey;
      const altMatch = !alt || e.altKey;
      const shiftMatch = !shift || e.shiftKey;

      if (keyMatch && ctrlMatch && metaMatch && altMatch && shiftMatch) {
        if (preventDefault) e.preventDefault();
        callbackRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown, { passive: !preventDefault });
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [key, ctrl, meta, alt, shift, preventDefault]);
}