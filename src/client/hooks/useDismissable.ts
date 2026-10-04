import { useEffect, type RefObject } from 'react';

export interface DismissableOptions {
  closeOnOutsideClick?: boolean;
}

/**
 * 浮层可能由多个 DOM 节点组成（例如触发器在工具栏内、内容被 portal 到 body），
 * 因此"点击是否算外部"必须对全部相关节点取并集判断。
 */
export type DismissableRefs =
  | RefObject<HTMLElement | null>
  | Array<RefObject<HTMLElement | null>>;

/**
 * 统一的"关闭浮层"行为：外部点击 + Escape。
 * 供 Dropdown / ContextMenu / SearchBar / WorkspaceSelector 等复用，避免重复实现。
 *
 * `refs` 可以是单个 ref，也可以是 ref 数组；只要点击目标落在任意一个 ref 的子树内
 * 就算"内部点击"。portal 化的下拉必须同时传入触发器容器与 portal 内容容器，
 * 否则点击被 portal 出去的内容会被误判为外部点击而立刻关闭。
 */
export function useDismissable(
  refs: DismissableRefs,
  enabled: boolean,
  onDismiss: () => void,
  opts: DismissableOptions = {},
): void {
  const { closeOnOutsideClick = true } = opts;

  useEffect(() => {
    if (!enabled) return;

    const list = Array.isArray(refs) ? refs : [refs];
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (list.some((ref) => ref.current?.contains(target))) return;
      onDismiss();
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
  }, [refs, enabled, onDismiss, closeOnOutsideClick]);
}