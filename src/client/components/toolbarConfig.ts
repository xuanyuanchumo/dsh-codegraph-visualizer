import type { LayoutType, GraphType, RankDir } from '../store/graphStore.ts';
import type { ViewMode } from '../../types/index.ts';
// 布局顺序的唯一权威表在 `src/shared/viewModeUtils.ts`（cycle-84 收敛，原先此处有第 2 份副本）。
import { LAYOUT_ORDER } from '../../shared/viewModeUtils.ts';

import {
  ChainIcon, CycleIcon, ZapIcon, TreeIcon, PathIcon,
  HeartIcon, RuleIcon, FlameIcon, AlertCircleIcon,
  StarIcon, GhostIcon, WatchIcon, DiffIcon,
} from './Icons.tsx';
import type { ToolMenuItem, ExportFormat } from './toolbarTypes.ts';

/** 工具栏布局下拉的选项顺序，直接引用权威表（见 `LAYOUT_ORDER` 的中文说明）。 */
export const LAYOUTS: readonly LayoutType[] = LAYOUT_ORDER;

export const RANK_DIRS: { value: RankDir; label: string }[] = [
  { value: 'TB', label: 'TB' },
  { value: 'LR', label: 'LR' },
  { value: 'BT', label: 'BT' },
  { value: 'RL', label: 'RL' },
];

export const GRAPH_TYPES: { value: GraphType; key: string }[] = [
  { value: 'all', key: 'graphType.all' },
  { value: 'call', key: 'graphType.call' },
  { value: 'dependency', key: 'graphType.dependency' },
];

export const STRUCTURAL_MODE_KEYS: Partial<Record<ViewMode, string>> = {
  code: 'viewMode.code',
};
export const BEHAVIORAL_MODE_KEYS: Partial<Record<ViewMode, string>> = {
  dependencies: 'viewMode.dependencies',
  inheritance: 'viewMode.inheritance',
  callgraph: 'viewMode.callgraph',
  package: 'viewMode.package',
  class: 'viewMode.class',
};
export const BEHAVIORAL_MICRO_MODE_KEYS: Partial<Record<ViewMode, string>> = {
  cfg: 'viewMode.cfg',
  flowchart: 'viewMode.flowchart',
  sequence: 'viewMode.sequence',
};
/**
 * 运行时层的下拉文案（cycle-88，P2-1 三层独立面板）。
 *
 * 与 structural/behavioral 三组键同形，是工具栏第四段的数据来源。之所以单独
 * 一组而不是并进 `BEHAVIORAL_MICRO_MODE_KEYS`：运行时层不是「行为层的微观
 * 子视图」，而是与结构层/行为层平级的第三层（`docs/图谱按需加载.md:276`
 * 「结构 / 行为 / 运行时分层隔离，各自独立预算」）。合并会让工具栏无法表达
 * 「这是第三层」这件事，也会让 `getViewLayer` 的映射与下拉分组对不上。
 */
export const RUNTIME_MODE_KEYS: Partial<Record<ViewMode, string>> = {
  runtime: 'viewMode.runtime',
};
export const STRUCTURAL_TITLE_KEYS: Partial<Record<ViewMode, string>> = {
  code: 'toolbar.viewModeCode',
};
export const BEHAVIORAL_TITLE_KEYS: Partial<Record<ViewMode, string>> = {
  dependencies: 'toolbar.viewModeDeps',
  inheritance: 'toolbar.viewModeInheritance',
  callgraph: 'toolbar.viewModeCallgraph',
  package: 'toolbar.viewModePackage',
  class: 'toolbar.viewModeClass',
};
export const BEHAVIORAL_MICRO_TITLE_KEYS: Partial<Record<ViewMode, string>> = {
  cfg: 'toolbar.viewModeCfg',
  flowchart: 'toolbar.viewModeFlowchart',
  sequence: 'toolbar.viewModeSequence',
};
export const RUNTIME_TITLE_KEYS: Partial<Record<ViewMode, string>> = {
  runtime: 'toolbar.viewModeRuntime',
};

export const CLUSTER_DEPTHS: { value: number; key: string }[] = [
  { value: 0, key: 'clusterDepth.directory' },
  { value: 1, key: 'clusterDepth.file' },
  { value: 2, key: 'clusterDepth.function' },
];

export const HIERARCHY_LEVELS: { value: number; key: string; short: string }[] = [
  { value: 0, key: 'toolbar.hierarchyL0', short: 'L0' },
  { value: 1, key: 'toolbar.hierarchyL1', short: 'L1' },
  { value: 2, key: 'toolbar.hierarchyL2', short: 'L2' },
  { value: 3, key: 'toolbar.hierarchyL3', short: 'L3' },
];

export const ANALYSIS_ITEMS: ToolMenuItem[] = [
  { panel: 'showCallChain', Icon: ChainIcon, key: 'toolbar.chain', btnClass: 'cg-chain-btn', toggle: 'onToggleCallChain' },
  { panel: 'showCycles', Icon: CycleIcon, key: 'toolbar.cycles', btnClass: 'cg-cycle-btn', toggle: 'onToggleCycles' },
  { panel: 'showImpact', Icon: ZapIcon, key: 'toolbar.impact', btnClass: 'cg-impact-btn', toggle: 'onToggleImpact' },
  { panel: 'showInheritance', Icon: TreeIcon, key: 'toolbar.inheritance', btnClass: 'cg-inheritance-btn', toggle: 'onToggleInheritance' },
  { panel: 'showPathFind', Icon: PathIcon, key: 'toolbar.pathFind', btnClass: 'cg-pathfind-btn', toggle: 'onTogglePathFind' },
];

export const QUALITY_ITEMS: ToolMenuItem[] = [
  { panel: 'showHealthScore', Icon: HeartIcon, key: 'toolbar.health', btnClass: 'cg-health-btn', toggle: 'onToggleHealthScore' },
  { panel: 'showRules', Icon: RuleIcon, key: 'toolbar.rules', btnClass: 'cg-rules-btn', toggle: 'onToggleRules' },
  { panel: 'showHotspot', Icon: FlameIcon, key: 'toolbar.hotspot', btnClass: 'cg-hotspot-btn', toggle: 'onToggleHotspot' },
  { panel: 'showGodModule', Icon: AlertCircleIcon, key: 'toolbar.godModule', btnClass: 'cg-godmodule-btn', toggle: 'onToggleGodModule' },
  { panel: 'showCoreFunction', Icon: StarIcon, key: 'toolbar.coreFunction', btnClass: 'cg-corefunction-btn', toggle: 'onToggleCoreFunction' },
  { panel: 'showDeadCode', Icon: GhostIcon, key: 'toolbar.deadCode', btnClass: 'cg-deadcode-btn', toggle: 'onToggleDeadCode' },
];

/**
 * 运行时层的工具项（cycle-88，P2-1 三层独立面板）。
 *
 * 单独一段而不是并进 `ANALYSIS_ITEMS`：`ANALYSIS_ITEMS` 里的 5 项都是
 * 行为层的图分析入口（调用链/环/影响/继承/路径），而 `showRuntime` 是**第三层
 * 自己的面板入口**。并进去会让「工具下拉里为什么混着一个不画图的项」无法解释，
 * 也会让 `availablePanels` 过滤后出现空段（段标题渲染了、段内容全被过滤掉）。
 *
 * 由 `availablePanels.has('showRuntime')` 门控：只有 `getViewLayer(viewMode)`
 * 为 `'runtime'` 时该段才出现，结构层/行为层看不到它——这正是
 * `docs/图谱按需加载.md:202`「三层不要同时叠加」在 UI 上的体现。
 */
export const RUNTIME_ITEMS: ToolMenuItem[] = [
  { panel: 'showRuntime', Icon: WatchIcon, key: 'toolbar.runtime', btnClass: 'cg-runtime-btn', toggle: 'onToggleRuntime' },
];

/**
 * 版本对比（diff）的工具项（研究报告 §六 #13）。
 *
 * 单独一段而不是并进 `QUALITY_ITEMS`：那 6 项都是「对当前图做一次分析并给出结论」
 * （健康分/规则/热点/上帝模块/核心函数/死代码），而版本对比是**换一个输入**（两个 git 引用）
 * 再叠加一层视图标记。并进去会让「为什么这一项要填两个输入框」无法从分组标题读出来。
 *
 * 由 `availablePanels.has('showDiff')` 门控：结构层与行为层有图可标，运行时层没有图，
 * 该段在运行时层整体消失（段标题也一并消失，靠 `ToolbarActions` 的 `visibleSections` 过滤）。
 */
export const DIFF_ITEMS: ToolMenuItem[] = [
  { panel: 'showDiff', Icon: DiffIcon, key: 'toolbar.diff', btnClass: 'cg-diff-btn', toggle: 'onToggleDiff' },
];

export const PANEL_DROPDOWN_SECTIONS: { labelKey: string; items: ToolMenuItem[] }[] = [
  { labelKey: 'toolbar.analysis', items: ANALYSIS_ITEMS },
  { labelKey: 'toolbar.quality', items: QUALITY_ITEMS },
  { labelKey: 'toolbar.runtimeSection', items: RUNTIME_ITEMS },
  { labelKey: 'toolbar.diffSection', items: DIFF_ITEMS },
];
export const EXPORT_FORMATS: { value: ExportFormat; key: string }[] = [
  { value: 'png', key: 'export.png' },
  { value: 'svg', key: 'export.svg' },
  { value: 'json', key: 'export.json' },
  { value: 'mermaid', key: 'export.mermaid' },
  { value: 'mermaid-seq', key: 'export.mermaidSeq' },
  { value: 'mermaid-class', key: 'export.mermaidClass' },
  { value: 'graphml', key: 'export.graphml' },
  { value: 'jsonld', key: 'export.jsonld' },
];