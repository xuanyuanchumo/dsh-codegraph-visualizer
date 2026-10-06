import type { LayoutType, GraphType, RankDir } from '../store/graphStore.ts';
import type { ViewMode } from '../../types/index.ts';
// 布局顺序的唯一权威表在 `src/shared/viewModeUtils.ts`（cycle-84 收敛，原先此处有第 2 份副本）。
import { LAYOUT_ORDER } from '../../shared/viewModeUtils.ts';

import {
  ChainIcon, CycleIcon, ZapIcon, TreeIcon, PathIcon,
  HeartIcon, RuleIcon, FlameIcon, AlertCircleIcon,
  StarIcon, GhostIcon,
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

export const PANEL_DROPDOWN_SECTIONS: { labelKey: string; items: ToolMenuItem[] }[] = [
  { labelKey: 'toolbar.analysis', items: ANALYSIS_ITEMS },
  { labelKey: 'toolbar.quality', items: QUALITY_ITEMS },
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