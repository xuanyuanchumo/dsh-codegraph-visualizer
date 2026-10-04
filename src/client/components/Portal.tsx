import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface PortalProps {
  children: ReactNode;
  /** 挂载目标；缺省 `document.body`。测试可注入容器以免污染 body。 */
  target?: HTMLElement | null;
}

/**
 * 浮层逃生舱：把子节点渲染到 `.cg-graph-panel` 之外。
 *
 * 面板本身带 `contain: layout paint style`（见 `styles/layout.css` 的 `.cg-graph-panel`），
 * 这会让它同时成为 `position: fixed` 后代的包含块并裁剪溢出内容；工具栏又有
 * `overflow-y: auto`。两者叠加后，面板内部渲染的任何下拉/右键菜单/提示框都会被裁掉
 * （J0 实测：231.6px 高的下拉只有 3px 可见）。因此浮层必须挂到 `document.body` 上，
 * 并由 `.cg-portal-layer` 提供高于宿主外壳（最高 z-index 40）的层级。
 */
export function Portal({ children, target }: PortalProps) {
  if (typeof document === 'undefined') return null;
  const host = target ?? document.body;
  if (!host) return null;
  return createPortal(children, host);
}
