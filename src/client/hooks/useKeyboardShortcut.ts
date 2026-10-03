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
        const target = e.target as HTMLElement | null;
        // The host composer is a contenteditable div, not an input/textarea, so a tag check
        // alone lets panel shortcuts steal keystrokes from whatever the user is typing into
        // (J0 Round 12, BUG-R12-04: Shift+F10 opened the node menu from the composer).
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
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