import { useEffect, type RefObject } from 'react';

interface UsePanelVisibilityParams {
  panelVisible: boolean;
  rendererRef: RefObject<{ resumeAnimations: () => void; pauseAnimations: () => void } | null>;
}

export function usePanelVisibility({ panelVisible, rendererRef }: UsePanelVisibilityParams) {
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (panelVisible) r.resumeAnimations();
    else r.pauseAnimations();
  }, [panelVisible, rendererRef]);
}