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

      // cycle-112 修复（E2E J27 长期红背后的真产品缺陷）：`/` 豁免的本意是「焦点在**宿主**
      // 的输入框（contenteditable composer）里时，`/` 仍能呼出搜索」（BUG-R12-04 的设计，
      // 见 docs/需求分析.md §31.11(e)）。但它同时把**本插件自己的搜索输入框**也豁免了 ——
      // 用户在搜索框里输入路径片段（`src/`、`components/`）时每敲一个 `/` 搜索框就被关掉，
      // 输入被打断，且重新打开后焦点丢失。E2E「在输入框中按 / 不应触发搜索打开」钉的正是
      // 这个行为，长期红是因为断言期望的语义（不关）与实现（关）相反。
      // 判据：目标是本插件搜索框（`#graph-search`）⇒ `/` 是普通字符；其余（宿主 composer、
      // 画布、页面任意处）⇒ 保持豁免（呼出搜索）。
      if (isSlash && (e.target as HTMLElement | null)?.id === 'graph-search') return;

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