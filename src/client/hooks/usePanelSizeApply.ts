import { useEffect, type RefObject } from 'react';
import { getMinPanelSize, isHostSizedIntegrationMode, type IntegrationMode } from '../../shared/constants.ts';

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
    const panelEl = panelRef.current;
    if (!panelEl) return;
    // Two situations where the persisted free-float size must NOT be applied:
    //  - collapsed: `.cg-graph-panel.cg-collapsed` sizes the FAB, and a stale inline size
    //    is an inline declaration that outranks that rule (cleared instead of escalating
    //    the stylesheet to `!important`).
    //  - host-sized integration modes: responsive.css declares `width: 100%; height: 100%`
    //    for the DSH slots, so an inline size would shrink the primary tab view to the last
    //    floating size instead of tracking the container.
    if (collapsed || isHostSizedIntegrationMode(integrationMode)) {
      if (panelEl.style.width) panelEl.style.width = '';
      if (panelEl.style.height) panelEl.style.height = '';
      rendererResize();
      return;
    }
    const minSize = getMinPanelSize(integrationMode);
    if (panelHeight !== null && panelHeight >= minSize.minHeight) panelEl.style.height = `${Math.min(panelHeight, window.innerHeight)}px`;
    if (panelWidth !== null && panelWidth >= minSize.minWidth) panelEl.style.width = `${panelWidth}px`;
    if (panelHeight !== null || panelWidth !== null) rendererResize();
  }, [collapsed, panelHeight, panelWidth, panelRef, integrationMode, rendererResize]);
}
