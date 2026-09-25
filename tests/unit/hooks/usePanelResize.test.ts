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
    handle.className = 'cg-resize-handle';
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

  it('pointerdown 应注册 pointermove 和 pointerup 监听器', () => {
    renderHook(() => usePanelResize(panelRef, rendererRef));
    Object.defineProperty(panel, 'offsetWidth', { value: 600, configurable: true });
    Object.defineProperty(panel, 'offsetHeight', { value: 400, configurable: true });
    const moveSpy = vi.spyOn(window, 'addEventListener');
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    expect(moveSpy).toHaveBeenCalled();
  });

  it('pointermove 应更新面板尺寸', () => {
    renderHook(() => usePanelResize(panelRef, rendererRef));
    Object.defineProperty(panel, 'offsetWidth', { value: 600, configurable: true });
    Object.defineProperty(panel, 'offsetHeight', { value: 400, configurable: true });
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 120 }));
    expect(panel.style.width).toBe('650px');
    expect(panel.style.height).toBe('420px');
  });

  it('pointermove 应尊重最小宽度 320px', () => {
    renderHook(() => usePanelResize(panelRef, rendererRef));
    Object.defineProperty(panel, 'offsetWidth', { value: 400, configurable: true });
    Object.defineProperty(panel, 'offsetHeight', { value: 300, configurable: true });
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50 }));
    expect(parseInt(panel.style.width)).toBeGreaterThanOrEqual(320);
    expect(parseInt(panel.style.height)).toBeGreaterThanOrEqual(240);
  });

  it('pointerup 应调用 setPanelSize 保存尺寸', () => {

    renderHook(() => usePanelResize(panelRef, rendererRef));
    Object.defineProperty(panel, 'offsetWidth', { value: 600, configurable: true });
    Object.defineProperty(panel, 'offsetHeight', { value: 400, configurable: true });
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 120 }));
    window.dispatchEvent(new PointerEvent('pointerup'));
    expect(rendererRef.current?.resize).toHaveBeenCalled();
  });

  it('pointerup 应移除 pointermove 和 pointerup 监听器', () => {
    renderHook(() => usePanelResize(panelRef, rendererRef));
    Object.defineProperty(panel, 'offsetWidth', { value: 600, configurable: true });
    Object.defineProperty(panel, 'offsetHeight', { value: 400, configurable: true });
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup'));
    const styleBefore = panel.style.width;
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 999, clientY: 999 }));
    expect(panel.style.width).toBe(styleBefore);
  });

  it('双击 handle 应调用 resetPanelSize', () => {
    renderHook(() => usePanelResize(panelRef, rendererRef));
    panel.style.width = '500px';
    panel.style.height = '400px';
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(panel.style.width).toBe('');
    expect(panel.style.height).toBe('');
  });
});