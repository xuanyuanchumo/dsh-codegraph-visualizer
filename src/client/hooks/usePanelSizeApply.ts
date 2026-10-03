import { useEffect, type RefObject } from 'react';
import { getMinPanelSize, type IntegrationMode } from '../../shared/constants.ts';

interface UsePanelSizeApplyParams {
  panelRef: RefObject<HTMLDivElement | null>;
  collapsed: boolean;
  panelHeight: number | null;
  panelWidth: number | null;
  integrationMode: IntegrationMode;
  rendererResize: () => void;
}

export function usePanelSizeApply({
  panelRef, collapsed, panelHeight, panelWidth, integrationMode, rendererResize,
}: UsePanelSizeApplyParams) {
  useEffect(() => {
    if (collapsed) return;
    const panelEl = panelRef.current;
    if (!panelEl) return;
    const minSize = getMinPanelSize(integrationMode);
    if (panelHeight !== null && panelHeight >= minSize.minHeight) panelEl.style.height = `${Math.min(panelHeight, window.innerHeight)}px`;
    if (panelWidth !== null && panelWidth >= minSize.minWidth) panelEl.style.width = `${panelWidth}px`;
    if (panelHeight !== null || panelWidth !== null) rendererResize();
  }, [collapsed, panelHeight, panelWidth, panelRef, integrationMode, rendererResize]);
}