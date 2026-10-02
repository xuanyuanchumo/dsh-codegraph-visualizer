import { useEffect, type RefObject } from 'react';

export interface DismissableOptions {
  closeOnOutsideClick?: boolean;
}

/**
 * 统一的"关闭浮层"行为：外部点击 + Escape。
 * 供 Dropdown / ContextMenu / SearchBar / WorkspaceSelector 等复用，避免重复实现。
 */
export function useDismissable(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onDismiss: () => void,
  opts: DismissableOptions = {},
): void {
  const { closeOnOutsideClick = true } = opts;

  useEffect(() => {
    if (!enabled) return;

    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };

    if (closeOnOutsideClick) document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      if (closeOnOutsideClick) document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, enabled, onDismiss, closeOnOutsideClick]);
}