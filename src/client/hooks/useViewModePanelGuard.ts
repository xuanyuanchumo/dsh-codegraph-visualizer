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
  showManage: boolean; setShowManage: (v: boolean) => void;
  showFilterPanel: boolean; setShowFilterPanel: (v: boolean) => void;
  showSearch: boolean; setShowSearch: (v: boolean) => void;
  showPathFind: boolean; setShowPathFind: (v: boolean) => void;
  /**
   * 运行时层面板（cycle-88，P2-1）。
   *
   * 它**不在**这里的自动关闭清单里：`getAvailablePanels('runtime')` 提供
   * `showRuntime`，而离开运行时层时 `GraphPanel` 的 `viewMode` effect 会把
   * `showRuntime` 显式置回 false（`panel.setShowRuntime(viewMode === 'runtime')`）。
   * 若也放进来，两条规则会在同一次切换里先后写同一个状态，且顺序取决于 effect
   * 的注册顺序——这正是 cycle-84「capability guard + setter 互相回滚」的
   * 同一个失败模式，能避开就避开。
   */
  showRuntime: boolean; setShowRuntime: (v: boolean) => void;
  /**
   * 版本对比面板（研究报告 §六 #13）。
   *
   * 它**在**自动关闭清单里（与 `showRuntime` 相反）：`showDiff` 属于结构层/行为层的能力，
   * 切到运行时层后 `getAvailablePanels('runtime')` 不含它，必须收起——否则用户会停在一张
   * 空画布上，带着一堆没有落地对象的 diff 标记，且面板里还显示着上一次的计数。
   *
   * `showRuntime` 之所以例外，是因为它由 `GraphPanel` 的 `viewMode` effect 单向驱动
   * （进入运行时层打开、离开关闭），两条规则同时写同一个 key 会互相回滚。`showDiff` 没有
   * 那条单向驱动，因此放进本清单是唯一写入方，不存在互相回滚。
   */
  showDiff: boolean; setShowDiff: (v: boolean) => void;
  /**
   * ρ 路径模式面板（cycle-135）。
   *
   * 它在**自动关闭清单里**（与 `showDiff` 同族）：`showPathPattern` 属于结构层/行为层的
   * 能力，切到运行时层后 `getAvailablePanels('runtime')` 不含它，必须收起——否则用户会
   * 停在一张空画布上，对着一个没有落地对象的 ρ 输入框。
   *
   * 它没有 `showRuntime` 那条「由 viewMode effect 单向驱动」的写入者，因此放进本清单是
   * 该 key 的唯一写入方，不存在 cycle-84「guard 与 writer 互相回滚」的失败模式。
   */
  showPathPattern: boolean; setShowPathPattern: (v: boolean) => void;
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
      // showManage is a full-screen overlay, not an analysis panel — skip guard
      // ['showManage', opts.panel.showManage, () => opts.panel.setShowManage(false)],
      ['showFilterPanel', opts.panel.showFilterPanel, () => opts.panel.setShowFilterPanel(false)],
      ['showSearch', opts.panel.showSearch, () => opts.panel.setShowSearch(false)],
      ['showPathFind', opts.panel.showPathFind, () => opts.panel.setShowPathFind(false)],
      ['showDiff', opts.panel.showDiff, () => opts.panel.setShowDiff(false)],
      ['showPathPattern', opts.panel.showPathPattern, () => opts.panel.setShowPathPattern(false)],
    ];
    for (const [key, isShowing, close] of panelEntries) {
      if (!available.has(key) && isShowing) close();
    }
  }, [opts.viewMode, opts.panel]);
}