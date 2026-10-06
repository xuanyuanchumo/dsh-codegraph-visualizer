import type { ViewMode } from '../types/index.ts';
import { assertNever } from './assertNever.ts';

export type ThemeType = 'light' | 'dark';
export type LayoutType = 'cose' | 'fcose' | 'dagre' | 'circle' | 'grid' | 'radial' | 'tree';
export type RankDir = 'TB' | 'LR' | 'BT' | 'RL';
export type ViewLayer = 'structural' | 'behavioral' | 'runtime';

/**
 * 布局类型的**唯一权威顺序表**（cycle-84 收敛）。
 *
 * 在此之前，同一份 7 项列表在仓库里有 4 份互相独立的副本：工具栏下拉
 * （`src/client/components/toolbarConfig.ts`）、斜杠命令循环
 * （`src/client/integrations/CommandUiIntegration.ts`）、持久化迁移校验
 * （`src/client/store/graphStore.ts` 的 `migrate`）、键盘快捷键循环
 * （`src/client/hooks/usePanelKeyboard.ts`）。四份副本同序但各写各的，任何
 * 一次「新增一种布局」都要记得改 4 处，漏改的后果是静默的：工具栏能选、
 * 命令循环跳过、持久化把它当脏值回退、键盘循环永远轮不到。
 *
 * 这里把它提升到 `LayoutType` 的类型归属地（`src/shared/`），四者一律引用
 * 本常量；`tests/unit/layoutOrderContract.test.ts` 用源码守卫锁死这件事。
 *
 * 顺序即 UI 呈现顺序，也是键盘/命令循环顺序，**不要按字母序重排**：
 * `cose`（默认）必须排在第一位，`migrate` 的兜底值也依赖它。
 *
 * `Object.freeze` 是运行期保险：`readonly` 只在编译期生效，而 JS 侧任何一处
 * `LAYOUT_ORDER[0] = 'grid'` 都能静默改掉全局顺序（`tests/unit/layoutOrderContract.test.ts`
 * 对此有断言）。
 */
export const LAYOUT_ORDER: readonly LayoutType[] = Object.freeze([
  'cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree',
]);

export const VIEW_MODE_LAYOUT: Record<ViewMode, LayoutType> = {
  code: 'cose',
  dependencies: 'cose',
  inheritance: 'tree',
  callgraph: 'dagre',
  package: 'tree',
  class: 'dagre',
  cfg: 'dagre',
  flowchart: 'dagre',
  sequence: 'cose',
};

export function isLayeredViewMode(mode: ViewMode): boolean {
  switch (mode) {
    case 'inheritance':
    case 'callgraph':
    case 'package':
    case 'class':
    case 'dependencies':
      return true;
    case 'code':
    case 'cfg':
    case 'flowchart':
    case 'sequence':
      return false;
    default:
      return assertNever(mode);
  }
}

export function getViewLayer(mode: ViewMode): ViewLayer {
  switch (mode) {
    case 'code':
      return 'structural';
    case 'dependencies':
    case 'inheritance':
    case 'callgraph':
    case 'package':
    case 'class':
    case 'cfg':
    case 'flowchart':
    case 'sequence':
      return 'behavioral';
    default:
      return assertNever(mode);
  }
}

export const STRUCTURAL_VIEW_MODES: ViewMode[] = ['code'];
export const BEHAVIORAL_VIEW_MODES: ViewMode[] = ['dependencies', 'inheritance', 'callgraph', 'package', 'class'];
export const BEHAVIORAL_MICRO_VIEW_MODES: ViewMode[] = ['cfg', 'flowchart', 'sequence'];
export type AnalysisPanelKey =
  | 'showSearch' | 'showPathFind' | 'showHealthScore' | 'showRules' | 'showImport' | 'showFilterPanel'
  | 'showCallChain' | 'showCycles' | 'showImpact' | 'showInheritance' | 'showHotspot' | 'showGodModule' | 'showCoreFunction'
  | 'showDeadCode'
  | 'showMiniMap' | 'showLegend';

export const STRUCTURAL_PANELS: Set<AnalysisPanelKey> = new Set([
  'showSearch', 'showPathFind', 'showHealthScore', 'showRules', 'showImport', 'showFilterPanel',
  'showDeadCode',
  'showMiniMap', 'showLegend',
]);

export const BEHAVIORAL_PANELS: Set<AnalysisPanelKey> = new Set([
  'showCallChain', 'showCycles', 'showImpact', 'showInheritance', 'showHotspot', 'showGodModule', 'showCoreFunction',
  'showDeadCode',
  'showSearch', 'showPathFind', 'showMiniMap', 'showLegend',
]);

export function getAvailablePanels(layer: ViewLayer): Set<AnalysisPanelKey> {
  switch (layer) {
    case 'structural':
      return STRUCTURAL_PANELS;
    case 'behavioral':
      return BEHAVIORAL_PANELS;
    case 'runtime':
      return new Set<AnalysisPanelKey>(['showMiniMap', 'showLegend']);
    default:
      return assertNever(layer);
  }
}
