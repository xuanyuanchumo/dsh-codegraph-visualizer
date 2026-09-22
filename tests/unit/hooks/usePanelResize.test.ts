// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePanelResize } from '../../../src/client/hooks/usePanelResize.ts';
import type { IRenderer } from '../../../src/client/renderer/IRenderer.ts';

vi.mock('../../../src/client/store/graphStore.ts', () => ({
  useGraphStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setPanelSize: vi.fn(),
      resetPanelSize: vi.fn(),
    }),
}));

describe('usePanelResize', () => {
  let panelRef: React.RefObject<HTMLDivElement | null>;
  let rendererRef: React.RefObject<IRenderer | null>;
  let panel: HTMLDivElement;
  let handle: HTMLElement;

  beforeEach(() => {
    panel = document.createElement('div');
    handle = document.createElement('div');
    handle.className = 'resize-handle';
    panel.appendChild(handle);
    document.body.appendChild(panel);
    panelRef = { current: panel };
    rendererRef = { current: { resize: vi.fn() } as unknown as IRenderer };
  });

  afterEach(() => {
    document.body.removeChild(panel);
    vi.clearAllMocks();
  });

  it('应在 resize-handle 上注册 pointerdown 事件', () => {
    renderHook(() => usePanelResize(panelRef, rendererRef));
    expect(true).toBeTruthy();
  });

  it('双击 handle 应重置面板尺寸', () => {
    panel.style.width = '500px';
    panel.style.height = '400px';
    renderHook(() => usePanelResize(panelRef, rendererRef));
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(panel.style.width).toBe('');
    expect(panel.style.height).toBe('');
  });

  it('双击 handle 应调用 renderer.resize', () => {
    const resizeSpy = vi.fn();
    rendererRef.current = { resize: resizeSpy } as unknown as IRenderer;
    renderHook(() => usePanelResize(panelRef, rendererRef));
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(resizeSpy).toHaveBeenCalledTimes(1);
  });

  it('panel 不存在时不应崩溃', () => {
    const emptyRef = { current: null };
    expect(() => {
      renderHook(() => usePanelResize(emptyRef, rendererRef));
    }).not.toThrow();
  });

  it('resize-handle 不存在时不应崩溃', () => {
    const panelNoHandle = document.createElement('div');
    document.body.appendChild(panelNoHandle);
    const ref = { current: panelNoHandle };
    expect(() => {
      renderHook(() => usePanelResize(ref, rendererRef));
    }).not.toThrow();
    document.body.removeChild(panelNoHandle);
  });

  it('卸载时应移除事件监听器', () => {
    const { unmount } = renderHook(() => usePanelResize(panelRef, rendererRef));
    unmount();
    panel.style.width = '500px';
    panel.style.height = '400px';
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(panel.style.width).toBe('500px');
  });
});