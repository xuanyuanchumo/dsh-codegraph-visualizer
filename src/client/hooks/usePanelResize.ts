import { useEffect, useRef } from 'react';
import type { IRenderer } from '../renderer/IRenderer.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { getMinPanelSize, type IntegrationMode } from '../../shared/constants.ts';

export function usePanelResize(
  panelRef: React.RefObject<HTMLDivElement | null>,
  rendererRef: React.RefObject<IRenderer | null>,
): void {
  const savedRef = useRef<HTMLElement | null>(null);
  const setPanelSize = useGraphStore((s) => s.setPanelSize);
  const resetPanelSize = useGraphStore((s) => s.resetPanelSize);
  const integrationMode = useGraphStore((s) => s.integrationMode) as IntegrationMode;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const { minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT } = getMinPanelSize(integrationMode);

    let startX = 0, startY = 0, startW = 0, startH = 0;
    let rafId: number | null = null;
    const onPointerMove = (e: PointerEvent) => {
      const w = Math.max(MIN_WIDTH, startW + (e.clientX - startX));
      const h = Math.max(MIN_HEIGHT, startH + (e.clientY - startY));
      panel.style.width = `${w}px`;
      panel.style.height = `${h}px`;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        rendererRef.current?.resize();
      });
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (rafId !== null) cancelAnimationFrame(rafId);
      rendererRef.current?.resize();
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      if (w >= MIN_WIDTH && h >= MIN_HEIGHT) {
        setPanelSize(h, w);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      startX = e.clientX; startY = e.clientY;
      startW = panel.offsetWidth; startH = panel.offsetHeight;
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };
    const onDoubleClick = () => {
      panel.style.width = '';
      panel.style.height = '';
      resetPanelSize();
      rendererRef.current?.resize();
    };

    const handle = panel.querySelector<HTMLElement>('.cg-resize-handle');
    if (handle) {
      handle.addEventListener('pointerdown', onPointerDown);
      handle.addEventListener('dblclick', onDoubleClick);
      savedRef.current = handle;
    }
    return () => {
      savedRef.current?.removeEventListener('pointerdown', onPointerDown);
      savedRef.current?.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [panelRef, rendererRef, setPanelSize, resetPanelSize, integrationMode]);
}
