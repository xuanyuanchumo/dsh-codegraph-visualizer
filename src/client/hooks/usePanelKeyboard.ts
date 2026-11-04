import { useRef } from 'react';
import { useKeyboardShortcut } from './useKeyboardShortcut.ts';
import type { LayoutType } from '../renderer/IRenderer.ts';
import type { IRenderer } from '../renderer/IRenderer.ts';
// 布局顺序的唯一权威表（cycle-84 收敛，原先此处有第 4 份副本）。
import { LAYOUT_ORDER } from '../../shared/viewModeUtils.ts';

export interface PanelKeyboardHandlers {
  onToggleSearch: () => void;
  onCloseAll: () => void;
  onToggleCallChain: () => void;
  onToggleImpact: () => void;
  onToggleInheritance: () => void;
  onToggleMiniMap: () => void;
  onCycleLayout: () => void;
  onToggleImport: () => void;
  onToggleHelp: () => void;
  /**
   * Open the node context menu without a pointer (Shift+F10 / the dedicated menu key). The graph has
   * no keyboard route to per-node actions otherwise: focus / isolate / hide / expand / call chain /
   * impact / find path / open source all live in that menu, and `role="application"` keeps the
   * canvas opaque to assistive technology.
   */
  onOpenContextMenu?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onRefresh?: () => void;
  /**
   * 画布键盘导航（cycle-141 / D）。
   *
   * 方向键 / Enter / Esc / +/- / F 的**实际处理**在 `InteractionController`
   * （它直接拿到 `cy` 才能做「屏幕空间找相邻节点」）；这里只保留父层可选的
   * 通知通道，方便同步 aria 状态、详情面板或提示浮层。**不在这里注册全局监听**，
   * 否则方向键会劫持页面滚动。
   */
  onCanvasArrow?: (dir: 'up' | 'down' | 'left' | 'right') => void;
  onCanvasEnter?: () => void;
  onCanvasEscape?(): void;
  onCanvasZoom?: (direction: 'in' | 'out') => void;
  onCanvasFit?(): void;
  onCanvasHintToggle?(): void;
}

export interface ShortcutDef {
  key: string;
  descKey: string;
  ctrl?: boolean;
  shift?: boolean;
  preventDefault?: boolean;
}

export const KEYBOARD_SHORTCUTS: ShortcutDef[] = [
  { key: '/', descKey: 'shortcut.search', preventDefault: true },
  { key: 'f', descKey: 'shortcut.searchCtrlF', ctrl: true, preventDefault: true },
  { key: 'Escape', descKey: 'shortcut.closeAll' },
  { key: 'C', descKey: 'shortcut.callChain', ctrl: true, shift: true },
  { key: 'E', descKey: 'shortcut.impact', ctrl: true },
  { key: 'H', descKey: 'shortcut.inheritance', ctrl: true },
  { key: 'M', descKey: 'shortcut.minimap', ctrl: true },
  { key: 'L', descKey: 'shortcut.layout', ctrl: true },
  { key: 'I', descKey: 'shortcut.import', ctrl: true },
  { key: 'R', descKey: 'shortcut.refresh', ctrl: true, shift: true, preventDefault: true },
  { key: 'Z', descKey: 'shortcut.undo', ctrl: true, preventDefault: true },
  { key: 'Y', descKey: 'shortcut.redo', ctrl: true, preventDefault: true },
  { key: '?', descKey: 'shortcut.help', preventDefault: true },
  { key: 'F10', descKey: 'shortcut.contextMenu', shift: true, preventDefault: true },
  { key: 'ContextMenu', descKey: 'shortcut.contextMenuKey', preventDefault: true },
];

/**
 * 画布级快捷键（cycle-141 / D）。
 *
 * 与 `KEYBOARD_SHORTCUTS` 分开声明，**不注册全局监听**：面板级快捷键挂在
 * `document` 上、任何焦点下都生效；画布级只在 `.cg-graph-container` 聚焦时由
 * `InteractionController` 接管。此处仅作为键盘提示浮层与文档的元数据，
 * 避免方向键劫持页面滚动、也避免 `usePanelKeyboard` 的测试长度断言被悄悄改变。
 */
export const CANVAS_KEYBOARD_SHORTCUTS: ShortcutDef[] = [
  { key: 'ArrowUp', descKey: 'canvasControls.shortcutArrowUp' },
  { key: 'ArrowDown', descKey: 'canvasControls.shortcutArrowDown' },
  { key: 'ArrowLeft', descKey: 'canvasControls.shortcutArrowLeft' },
  { key: 'ArrowRight', descKey: 'canvasControls.shortcutArrowRight' },
  { key: 'Enter', descKey: 'canvasControls.shortcutEnter' },
  { key: 'Escape', descKey: 'canvasControls.shortcutEscape' },
  { key: '+', descKey: 'canvasControls.shortcutZoomIn' },
  { key: '-', descKey: 'canvasControls.shortcutZoomOut' },
  { key: 'F', descKey: 'canvasControls.shortcutFit' },
];

export function formatShortcutKey(s: ShortcutDef): string {
  let label = '';
  if (s.ctrl) label += 'Ctrl+';
  if (s.shift) label += 'Shift+';
  label += s.key;
  return label;
}

export function usePanelKeyboard(
  layout: LayoutType,
  setLayout: (l: LayoutType) => void,
  rendererRef: React.RefObject<IRenderer | null>,
  handlers: PanelKeyboardHandlers,
): void {
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const setLayoutRef = useRef(setLayout);
  setLayoutRef.current = setLayout;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useKeyboardShortcut('/', () => handlersRef.current.onToggleSearch(), { preventDefault: true });
  useKeyboardShortcut('f', () => handlersRef.current.onToggleSearch(), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('Escape', () => {
    handlersRef.current.onCloseAll();
    rendererRef.current?.highlightCallChain(null);
    rendererRef.current?.highlightCycles(new Set<string>());
  });
  useKeyboardShortcut('c', () => handlersRef.current.onToggleCallChain(), { ctrl: true, shift: true });
  useKeyboardShortcut('e', () => handlersRef.current.onToggleImpact(), { ctrl: true });
  useKeyboardShortcut('h', () => handlersRef.current.onToggleInheritance(), { ctrl: true });
  useKeyboardShortcut('m', () => handlersRef.current.onToggleMiniMap(), { ctrl: true });
  useKeyboardShortcut('l', () => {
    const cur = layoutRef.current;
    // 原先此处有第 4 份布局顺序副本（cycle-84 收敛到 `LAYOUT_ORDER`）。
    const idx = LAYOUT_ORDER.indexOf(cur);
    const next = LAYOUT_ORDER[(idx + 1) % LAYOUT_ORDER.length]!;
    setLayoutRef.current(next);
  }, { ctrl: true });
  useKeyboardShortcut('i', () => handlersRef.current.onToggleImport(), { ctrl: true });
  useKeyboardShortcut('r', () => handlersRef.current.onRefresh?.(), { ctrl: true, shift: true, preventDefault: true });
  useKeyboardShortcut('?', () => handlersRef.current.onToggleHelp(), { preventDefault: true });
  useKeyboardShortcut('F10', () => handlersRef.current.onOpenContextMenu?.(), { shift: true, preventDefault: true });
  useKeyboardShortcut('ContextMenu', () => handlersRef.current.onOpenContextMenu?.(), { preventDefault: true });
  useKeyboardShortcut('z', () => handlersRef.current.onUndo?.(), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('y', () => handlersRef.current.onRedo?.(), { ctrl: true, preventDefault: true });
}

