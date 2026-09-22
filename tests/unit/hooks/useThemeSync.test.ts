// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useThemeSync } from '../../../src/client/hooks/useThemeSync.ts';

vi.mock('../../../src/client/store/graphStore.ts', () => {
  const listeners: Array<() => void> = [];
  const state = { theme: 'light' as string };
  return {
    useGraphStore: Object.assign(
      (selector: (s: { theme: string; setTheme: (t: string) => void }) => unknown) =>
        selector({ theme: state.theme, setTheme: (t: string) => { state.theme = t; } }),
      {
        getState: () => ({
          theme: state.theme,
          setTheme: (t: string) => {
            state.theme = t;
            listeners.forEach((l) => l());
          },
        }),
      }
    ),
    __setTheme: (t: string) => { state.theme = t; },
  };
});

vi.mock('../../../src/client/renderer/styles/ThemeStylesheet.ts', () => ({
  invalidateCssVarCache: vi.fn(),
}));

describe('useThemeSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.removeAttribute('data-ds-dark-theme');
  });

  afterEach(() => {
    document.body.removeAttribute('data-ds-dark-theme');
  });

  it('应在 body 添加 data-ds-dark-theme 属性时切换到 dark 主题', async () => {
    const updateRendererTheme = vi.fn();
    renderHook(() => useThemeSync(updateRendererTheme));
    document.body.setAttribute('data-ds-dark-theme', '');
    await vi.waitFor(() => {
      expect(updateRendererTheme).toHaveBeenCalledWith('dark');
    });
  });

  it('应在 body 移除 data-ds-dark-theme 属性时切换到 light 主题', async () => {
    const updateRendererTheme = vi.fn();
    renderHook(() => useThemeSync(updateRendererTheme));
    document.body.setAttribute('data-ds-dark-theme', '');
    await vi.waitFor(() => {
      expect(updateRendererTheme).toHaveBeenCalledWith('dark');
    });
    document.body.removeAttribute('data-ds-dark-theme');
    await vi.waitFor(() => {
      expect(updateRendererTheme).toHaveBeenCalledWith('light');
    });
  });

  it('卸载时应断开 MutationObserver', () => {
    const updateRendererTheme = vi.fn();
    const { unmount } = renderHook(() => useThemeSync(updateRendererTheme));
    unmount();
    document.body.setAttribute('data-ds-dark-theme', '');
    expect(updateRendererTheme).not.toHaveBeenCalled();
  });

  it('不应在主题未变化时调用 updateRendererTheme', () => {
    const updateRendererTheme = vi.fn();
    renderHook(() => useThemeSync(updateRendererTheme));
    expect(updateRendererTheme).not.toHaveBeenCalled();
  });
});