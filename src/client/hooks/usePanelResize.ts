import { useEffect, useRef } from 'react';
import type { IRenderer } from '../renderer/IRenderer.ts';

export function usePanelResize(
  panelRef: React.RefObject<HTMLDivElement | null>,
  rendererRef: React.RefObject<IRenderer | null>,
): void {
  const savedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    let startX = 0, startY = 0, startW = 0, startH = 0;
    const onPointerMove = (e: PointerEvent) => {
      const w = Math.max(320, startW + (e.clientX - startX));
      const h = Math.max(240, startH + (e.clientY - startY));
      panel.style.width = `${w}px`;
      panel.style.height = `${h}px`;
      rendererRef.current?.resize();
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    const onPointerDown = (e: PointerEvent) => {
      startX = e.clientX; startY = e.clientY;
      startW = panel.offsetWidth; startH = panel.offsetHeight;
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };

    const handle = panel.querySelector<HTMLElement>('.resize-handle');
    if (handle) {
      handle.addEventListener('pointerdown', onPointerDown);
      savedRef.current = handle;
    }
    return () => { savedRef.current?.removeEventListener('pointerdown', onPointerDown); };
  }, [panelRef, rendererRef]);
}