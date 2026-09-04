import { useRef } from 'react';
import { useKeyboardShortcut } from './index.ts';
import type { LayoutType } from '../renderer/IRenderer.ts';
import type { IRenderer } from '../renderer/IRenderer.ts';

export interface PanelKeyboardHandlers {
  onToggleSearch: () => void;
  onCloseAll: () => void;
  onToggleCallChain: () => void;
  onToggleImpact: () => void;
  onToggleMiniMap: () => void;
  onCycleLayout: () => void;
  onToggleImport: () => void;
  onToggleHelp: () => void;
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
  useKeyboardShortcut('c', () => handlersRef.current.onToggleCallChain(), { ctrl: true });
  useKeyboardShortcut('e', () => handlersRef.current.onToggleImpact(), { ctrl: true });
  useKeyboardShortcut('m', () => handlersRef.current.onToggleMiniMap(), { ctrl: true });
  useKeyboardShortcut('l', () => {
    const cur = layoutRef.current;
    const next: LayoutType = (cur === 'cose' ? 'dagre' : cur === 'dagre' ? 'circle' : cur === 'circle' ? 'grid' : 'cose');
    setLayoutRef.current(next);
  }, { ctrl: true });
  useKeyboardShortcut('i', () => handlersRef.current.onToggleImport(), { ctrl: true });
  useKeyboardShortcut('?', () => handlersRef.current.onToggleHelp(), { preventDefault: true });
}