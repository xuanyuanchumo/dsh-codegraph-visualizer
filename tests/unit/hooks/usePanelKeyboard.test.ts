/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  usePanelKeyboard,
  formatShortcutKey,
  KEYBOARD_SHORTCUTS,
} from '../../../src/client/hooks/usePanelKeyboard.ts';
import type { IRenderer } from '../../../src/client/renderer/IRenderer.ts';
import type { LayoutType } from '../../../src/client/renderer/IRenderer.ts';

function dispatchKey(opts: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: HTMLElement;
}) {
  const event = new KeyboardEvent('keydown', {
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'target', {
    value: opts.target ?? document.body,
    writable: false,
  });
  document.dispatchEvent(event);
  return event;
}

function createMockRenderer(): IRenderer {
  return {
    highlightCallChain: vi.fn(),
    highlightCycles: vi.fn(),
  } as unknown as IRenderer;
}

function createMockHandlers() {
  return {
    onToggleSearch: vi.fn(),
    onCloseAll: vi.fn(),
    onToggleCallChain: vi.fn(),
    onToggleImpact: vi.fn(),
    onToggleInheritance: vi.fn(),
    onToggleMiniMap: vi.fn(),
    onCycleLayout: vi.fn(),
    onToggleImport: vi.fn(),
    onToggleHelp: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
}

describe('formatShortcutKey', () => {
  it('formats plain key without modifiers', () => {
    expect(formatShortcutKey({ key: '/', descKey: 'shortcut.search' })).toBe('/');
  });

  it('formats key with ctrl', () => {
    expect(formatShortcutKey({ key: 'E', descKey: 'shortcut.impact', ctrl: true })).toBe('Ctrl+E');
  });

  it('formats key with ctrl and shift', () => {
    expect(formatShortcutKey({ key: 'C', descKey: 'shortcut.callChain', ctrl: true, shift: true })).toBe('Ctrl+Shift+C');
  });

  it('formats Escape without modifiers', () => {
    expect(formatShortcutKey({ key: 'Escape', descKey: 'shortcut.closeAll' })).toBe('Escape');
  });

  it('formats key with ctrl and preventDefault', () => {
    expect(formatShortcutKey({ key: 'Z', descKey: 'shortcut.undo', ctrl: true, preventDefault: true })).toBe('Ctrl+Z');
  });
});

describe('KEYBOARD_SHORTCUTS', () => {
  it('has 13 shortcuts', () => {
    expect(KEYBOARD_SHORTCUTS).toHaveLength(13);
  });

  it('contains search shortcut with preventDefault', () => {
    const search = KEYBOARD_SHORTCUTS.find((s) => s.descKey === 'shortcut.search');
    expect(search).toBeDefined();
    expect(search!.key).toBe('/');
    expect(search!.preventDefault).toBe(true);
  });

  it('contains callChain shortcut with ctrl and shift', () => {
    const callChain = KEYBOARD_SHORTCUTS.find((s) => s.descKey === 'shortcut.callChain');
    expect(callChain).toBeDefined();
    expect(callChain!.key).toBe('C');
    expect(callChain!.ctrl).toBe(true);
    expect(callChain!.shift).toBe(true);
  });

  it('contains undo shortcut with ctrl and preventDefault', () => {
    const undo = KEYBOARD_SHORTCUTS.find((s) => s.descKey === 'shortcut.undo');
    expect(undo).toBeDefined();
    expect(undo!.key).toBe('Z');
    expect(undo!.ctrl).toBe(true);
    expect(undo!.preventDefault).toBe(true);
  });

  it('contains help shortcut with preventDefault', () => {
    const help = KEYBOARD_SHORTCUTS.find((s) => s.descKey === 'shortcut.help');
    expect(help).toBeDefined();
    expect(help!.key).toBe('?');
    expect(help!.preventDefault).toBe(true);
  });
});

describe('usePanelKeyboard', () => {
  let mockRenderer: IRenderer;
  let mockHandlers: ReturnType<typeof createMockHandlers>;
  let setLayout: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRenderer = createMockRenderer();
    mockHandlers = createMockHandlers();
    setLayout = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('triggers onToggleSearch when "/" is pressed', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: '/' });
    expect(mockHandlers.onToggleSearch).toHaveBeenCalledTimes(1);
  });

  it('triggers onCloseAll and renderer methods when Escape is pressed', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: 'Escape' });
    expect(mockHandlers.onCloseAll).toHaveBeenCalledTimes(1);
    expect(mockRenderer.highlightCallChain).toHaveBeenCalledWith(null);
    expect(mockRenderer.highlightCycles).toHaveBeenCalledWith(new Set<string>());
  });

  it('triggers onToggleCallChain when Ctrl+Shift+C is pressed', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: 'c', ctrlKey: true, shiftKey: true });
    expect(mockHandlers.onToggleCallChain).toHaveBeenCalledTimes(1);
  });

  it('triggers onToggleImpact when Ctrl+E is pressed', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: 'e', ctrlKey: true });
    expect(mockHandlers.onToggleImpact).toHaveBeenCalledTimes(1);
  });

  it('triggers onToggleInheritance when Ctrl+H is pressed', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: 'h', ctrlKey: true });
    expect(mockHandlers.onToggleInheritance).toHaveBeenCalledTimes(1);
  });

  it('triggers onToggleMiniMap when Ctrl+M is pressed', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: 'm', ctrlKey: true });
    expect(mockHandlers.onToggleMiniMap).toHaveBeenCalledTimes(1);
  });

  it('cycles layout when Ctrl+L is pressed (cose -> fcose)', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: 'l', ctrlKey: true });
    expect(setLayout).toHaveBeenCalledWith('fcose');
  });

  it('cycles layout from tree back to cose', () => {
    renderHook(() =>
      usePanelKeyboard('tree', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: 'l', ctrlKey: true });
    expect(setLayout).toHaveBeenCalledWith('cose');
  });

  it('cycles layout from dagre to circle', () => {
    renderHook(() =>
      usePanelKeyboard('dagre', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: 'l', ctrlKey: true });
    expect(setLayout).toHaveBeenCalledWith('circle');
  });

  it('triggers onToggleImport when Ctrl+I is pressed', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: 'i', ctrlKey: true });
    expect(mockHandlers.onToggleImport).toHaveBeenCalledTimes(1);
  });

  it('triggers onToggleHelp when "?" is pressed', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: '?' });
    expect(mockHandlers.onToggleHelp).toHaveBeenCalledTimes(1);
  });

  it('triggers onUndo when Ctrl+Z is pressed', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: 'z', ctrlKey: true });
    expect(mockHandlers.onUndo).toHaveBeenCalledTimes(1);
  });

  it('triggers onRedo when Ctrl+Y is pressed', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: 'y', ctrlKey: true });
    expect(mockHandlers.onRedo).toHaveBeenCalledTimes(1);
  });

  it('allows "/" key even when focus is in an input', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    const input = document.createElement('input');
    dispatchKey({ key: '/', target: input });
    expect(mockHandlers.onToggleSearch).toHaveBeenCalledTimes(1);
  });

  it('allows Escape key even when focus is in an input', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    const input = document.createElement('input');
    dispatchKey({ key: 'Escape', target: input });
    expect(mockHandlers.onCloseAll).toHaveBeenCalledTimes(1);
  });

  it('blocks Ctrl+E when focus is in an input', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    const input = document.createElement('input');
    dispatchKey({ key: 'e', ctrlKey: true, target: input });
    expect(mockHandlers.onToggleImpact).not.toHaveBeenCalled();
  });

  it('blocks Ctrl+Shift+C when focus is in a textarea', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    const textarea = document.createElement('textarea');
    dispatchKey({ key: 'c', ctrlKey: true, shiftKey: true, target: textarea });
    expect(mockHandlers.onToggleCallChain).not.toHaveBeenCalled();
  });

  it('still triggers onToggleSearch when Ctrl+/ is pressed (no ctrl modifier required)', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: '/', ctrlKey: true });
    expect(mockHandlers.onToggleSearch).toHaveBeenCalledTimes(1);
  });

  it('does not trigger onToggleCallChain without shift', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, mockHandlers),
    );

    dispatchKey({ key: 'c', ctrlKey: true });
    expect(mockHandlers.onToggleCallChain).not.toHaveBeenCalled();
  });

  it('calls onUndo with optional handler when provided', () => {
    const handlersWithoutUndo = {
      ...mockHandlers,
      onUndo: undefined,
    };

    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: mockRenderer }, handlersWithoutUndo),
    );

    dispatchKey({ key: 'z', ctrlKey: true });
    expect(mockHandlers.onUndo).not.toHaveBeenCalled();
  });

  it('uses latest handlers after rerender', () => {
    const { rerender } = renderHook(
      ({ handlers }) =>
        usePanelKeyboard('cose', setLayout, { current: mockRenderer }, handlers),
      { initialProps: { handlers: mockHandlers } },
    );

    const newHandlers = createMockHandlers();
    rerender({ handlers: newHandlers });

    dispatchKey({ key: '/' });
    expect(newHandlers.onToggleSearch).toHaveBeenCalledTimes(1);
    expect(mockHandlers.onToggleSearch).not.toHaveBeenCalled();
  });

  it('uses latest layout after rerender for cycling', () => {
    const { rerender } = renderHook(
      ({ layout }) =>
        usePanelKeyboard(layout, setLayout, { current: mockRenderer }, mockHandlers),
      { initialProps: { layout: 'cose' as LayoutType } },
    );

    rerender({ layout: 'circle' as LayoutType });

    dispatchKey({ key: 'l', ctrlKey: true });
    expect(setLayout).toHaveBeenCalledWith('grid');
  });

  it('handles null rendererRef gracefully on Escape', () => {
    renderHook(() =>
      usePanelKeyboard('cose', setLayout, { current: null }, mockHandlers),
    );

    dispatchKey({ key: 'Escape' });
    expect(mockHandlers.onCloseAll).toHaveBeenCalledTimes(1);
  });
});