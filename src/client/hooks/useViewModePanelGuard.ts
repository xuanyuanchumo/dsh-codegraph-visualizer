import { useEffect } from 'react';
import { getViewLayer, getAvailablePanels } from '../../shared/viewModeUtils.ts';
import type { AnalysisPanelKey } from '../../shared/viewModeUtils.ts';
import type { ViewMode } from '../../types/index.ts';

interface PanelGuardApi {
  showCallChain: boolean; setShowCallChain: (v: boolean) => void;
  showCycles: boolean; setShowCycles: (v: boolean) => void;
  showImpact: boolean; setShowImpact: (v: boolean) => void;
  showInheritance: boolean; setShowInheritance: (v: boolean) => void;
  showHotspot: boolean; setShowHotspot: (v: boolean) => void;
  showGodModule: boolean; setShowGodModule: (v: boolean) => void;
  showCoreFunction: boolean; setShowCoreFunction: (v: boolean) => void;
  showDeadCode: boolean; setShowDeadCode: (v: boolean) => void;
  showHealthScore: boolean; setShowHealthScore: (v: boolean) => void;
  showRules: boolean; setShowRules: (v: boolean) => void;
  showImport: boolean; setShowImport: (v: boolean) => void;
  showFilterPanel: boolean; setShowFilterPanel: (v: boolean) => void;
  showSearch: boolean; setShowSearch: (v: boolean) => void;
  showPathFind: boolean; setShowPathFind: (v: boolean) => void;
}

interface UseViewModePanelGuardOpts {
  viewMode: ViewMode;
  setFocusNodeId: (id: string | null) => void;
  panel: PanelGuardApi;
}

export function useViewModePanelGuard(opts: UseViewModePanelGuardOpts): void {
  useEffect(() => {
    opts.setFocusNodeId(null);
  }, [opts.viewMode, opts.setFocusNodeId]);

  useEffect(() => {
    const available = getAvailablePanels(getViewLayer(opts.viewMode));
    const panelEntries: Array<[AnalysisPanelKey, boolean, () => void]> = [
      ['showCallChain', opts.panel.showCallChain, () => opts.panel.setShowCallChain(false)],
      ['showCycles', opts.panel.showCycles, () => opts.panel.setShowCycles(false)],
      ['showImpact', opts.panel.showImpact, () => opts.panel.setShowImpact(false)],
      ['showInheritance', opts.panel.showInheritance, () => opts.panel.setShowInheritance(false)],
      ['showHotspot', opts.panel.showHotspot, () => opts.panel.setShowHotspot(false)],
      ['showGodModule', opts.panel.showGodModule, () => opts.panel.setShowGodModule(false)],
      ['showCoreFunction', opts.panel.showCoreFunction, () => opts.panel.setShowCoreFunction(false)],
      ['showDeadCode', opts.panel.showDeadCode, () => opts.panel.setShowDeadCode(false)],
      ['showHealthScore', opts.panel.showHealthScore, () => opts.panel.setShowHealthScore(false)],
      ['showRules', opts.panel.showRules, () => opts.panel.setShowRules(false)],
      ['showImport', opts.panel.showImport, () => opts.panel.setShowImport(false)],
      ['showFilterPanel', opts.panel.showFilterPanel, () => opts.panel.setShowFilterPanel(false)],
      ['showSearch', opts.panel.showSearch, () => opts.panel.setShowSearch(false)],
      ['showPathFind', opts.panel.showPathFind, () => opts.panel.setShowPathFind(false)],
    ];
    for (const [key, isShowing, close] of panelEntries) {
      if (!available.has(key) && isShowing) close();
    }
  }, [opts.viewMode, opts.panel]);
}