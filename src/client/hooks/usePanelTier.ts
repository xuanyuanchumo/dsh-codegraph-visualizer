import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * 面板宽度分档（cycle-110 / T3）。
 *
 * 工具栏的响应式由 `useElementWidth` 量**工具栏自身**宽度，这里量的是
 * **面板根元素**：两者在窄宿主里可以不同（工具栏带 padding，面板还要减去边框）。
 * 分档阈值刻意与容器查询的分档对齐（768 / 480，与 `UI.TOOLBAR_BREAKPOINT_*` 同值），
 * 否则同一个面板会出现「JS 认为是 compact、CSS 认为是 wide」的半适配状态
 * （`tests/unit/responsiveContract.test.ts` 对工具栏那一对已经守过一次）。
 */
export const PANEL_TIER_COMPACT_PX = 768;
export const PANEL_TIER_NARROW_PX = 480;

/** 面板宽度档位。 */
export type PanelTier = 'wide' | 'compact' | 'narrow';

/**
 * 由测量宽度求档位（纯函数，可单测）。
 *
 * `width === 0` 是「还没量到」而不是「很窄」：首帧 `clientWidth` 为 0，
 * 若把它判成 narrow，面板会在挂载瞬间闪一次窄布局。与工具栏「未测量按宽档处理」
 * 的取舍保持一致。
 */
export function resolvePanelTier(width: number): PanelTier {
  if (!Number.isFinite(width) || width <= 0) return 'wide';
  if (width < PANEL_TIER_NARROW_PX) return 'narrow';
  if (width < PANEL_TIER_COMPACT_PX) return 'compact';
  return 'wide';
}

/**
 * 观测面板根元素宽度并求档位。
 *
 * @param externalRef 调用方已持有的面板根 ref（与 `usePanelResize` / `usePanelSizeApply`
 *   共用同一个 DOM 节点；本 hook 不另建 ref，避免同一个元素挂两个观察者）。
 */
export function usePanelTier<T extends HTMLElement>(externalRef: RefObject<T | null>): PanelTier {
  const [width, setWidth] = useState(0);
  const mounted = useRef(false);
  mounted.current = true;

  useLayoutEffect(() => {
    const el = externalRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [externalRef]);

  return resolvePanelTier(width);
}
