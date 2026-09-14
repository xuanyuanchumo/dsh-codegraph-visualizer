import { useRef } from 'react';
import { useKeyboardShortcut } from './index.ts';
import type { LayoutType } from '../renderer/IRenderer.ts';
import type { IRenderer } from '../renderer/IRenderer.ts';

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
  onUndo?: () => void;
  onRedo?: () => void;
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
    const order: LayoutType[] = ['cose', 'dagre', 'circle', 'grid', 'radial', 'tree'];
    const idx = order.indexOf(cur);
    const next = order[(idx + 1) % order.length]!;
    setLayoutRef.current(next);
  }, { ctrl: true });
  useKeyboardShortcut('i', () => handlersRef.current.onToggleImport(), { ctrl: true });
  useKeyboardShortcut('?', () => handlersRef.current.onToggleHelp(), { preventDefault: true });
  useKeyboardShortcut('z', () => handlersRef.current.onUndo?.(), { ctrl: true, preventDefault: true });
  useKeyboardShortcut('y', () => handlersRef.current.onRedo?.(), { ctrl: true, preventDefault: true });
}