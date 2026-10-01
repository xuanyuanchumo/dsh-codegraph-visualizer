import { useEffect } from 'react';
import { UI } from '../../shared/constants.ts';

interface RendererRef {
  resize: () => void;
}

interface UseAncestorResizeOpts {
  collapsed: boolean;
  panelHeight: number | null;
  rendererRef: React.RefObject<RendererRef | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
}

export function useAncestorResize(opts: UseAncestorResizeOpts): void {
  useEffect(() => {
    if (opts.collapsed) return;
    const panelEl = opts.panelRef.current;
    if (!panelEl) return;
    const hasUserOverride = opts.panelHeight !== null;
    if (hasUserOverride) return;
    let ancestor: HTMLElement | null = panelEl.parentElement;
    let depth = 0;
    while (ancestor && depth < UI.ANCESTOR_SEARCH_MAX_DEPTH) {
      const h = ancestor.getBoundingClientRect().height;
      if (h >= UI.ANCESTOR_MIN_HEIGHT_PX) break;
      ancestor = ancestor.parentElement;
      depth++;
    }
    const target = ancestor ?? panelEl.parentElement ?? panelEl;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const applyAncestorHeight = () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        const h = target.getBoundingClientRect().height;
        const maxH = window.innerHeight;
        const finalH = Math.min(h, maxH);
        if (finalH > 0) {
          panelEl.style.height = `${finalH}px`;
          opts.rendererRef.current?.resize();
        }
      }, UI.RESIZE_DEBOUNCE_MS);
    };
    applyAncestorHeight();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(applyAncestorHeight);
      ro.observe(target);
      return () => { ro.disconnect(); if (resizeTimer !== null) clearTimeout(resizeTimer); };
    } else {
      const onWinResize = () => applyAncestorHeight();
      window.addEventListener('resize', onWinResize);
      return () => { window.removeEventListener('resize', onWinResize); if (resizeTimer !== null) clearTimeout(resizeTimer); };
    }
  }, [opts.collapsed, opts.panelHeight, opts.rendererRef, opts.panelRef]);
}