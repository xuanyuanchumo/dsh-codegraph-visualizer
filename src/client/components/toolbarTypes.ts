import type React from 'react';
import type { LayoutType, ThemeType, GraphType, RankDir } from '../store/graphStore.ts';
import type { GraphNode, ViewMode } from '../../types/index.ts';
import type { WorkspaceSelectorProps } from './WorkspaceSelector.tsx';
import type { AnalysisPanelKey } from '../../shared/viewModeUtils.ts';

export interface ToolMenuItem {
  panel: AnalysisPanelKey;
  Icon: React.ComponentType<{ size?: number }>;
  key: string;
  btnClass: string;
  toggle: keyof ToolbarToggleHandlers;
}

export interface ToolbarVisibilityState {
  showSearch: boolean;
  showCallChain: boolean;
  showCycles: boolean;
  cycleIsolation: boolean;
  showImpact: boolean;
  showInheritance: boolean;
  showMiniMap: boolean;
  showLegend: boolean;
  showImport: boolean;
  showPathFind: boolean;
  showHealthScore: boolean;
  showRules: boolean;
  showHotspot: boolean;
  showGodModule: boolean;
  showCoreFunction: boolean;
  showDeadCode: boolean;
  showFilterPanel: boolean;
  showTour: boolean;
  /** 运行时层面板（cycle-88，P2-1 三层独立面板） */
  showRuntime: boolean;
  /**
   * 版本对比面板（研究报告 §六 #13）。
   *
   * 与 `showRuntime` 同族「独立面板开关」，可用性由 `getAvailablePanels` 的层矩阵给出：
   * 结构层与行为层有图可标，运行时层没有图，因此该面板在运行时层不可用。
   */
  showDiff: boolean;
  /**
   * 关键词图检索面板（cycle-111 / N-5）。
   *
   * 与 `showDiff` 同一条层判据：检索的产出是一张**子图**（种子可点、命中集合要在
   * 画布上高亮），所以它需要一层有图的视图；运行时层没有图，该面板在这一层不可用。
   */
  showKeywordQuery: boolean;
  showRegistry: boolean;
}

export interface ToolbarToggleHandlers {
  onToggleSearch: () => void;
  onToggleCallChain: () => void;
  onToggleCycles: () => void;
  onToggleCycleIsolation: () => void;
  onToggleImpact: () => void;
  onToggleInheritance: () => void;
  onToggleMiniMap: () => void;
  onToggleLegend: () => void;
  onToggleImport: () => void;
  onTogglePathFind: () => void;
  onToggleHealthScore: () => void;
  onToggleRules: () => void;
  onToggleHotspot: () => void;
  onToggleGodModule: () => void;
  onToggleCoreFunction: () => void;
  onToggleDeadCode: () => void;
  onToggleFilterPanel: () => void;
  onToggleTour: () => void;
  onToggleRuntime: () => void;
  onToggleDiff: () => void;
  /** 关键词图检索面板开关（cycle-111 / N-5）。 */
  onToggleKeywordQuery: () => void;
  onToggleRegistry: () => void;
}

export interface PanelControls extends ToolbarVisibilityState, ToolbarToggleHandlers {}

export type ExportFormat = 'png' | 'svg' | 'json' | 'mermaid' | 'mermaid-seq' | 'mermaid-class' | 'graphml' | 'jsonld';

export interface ToolbarLayoutConfig {
  layout: LayoutType;
  dagreRankDir: RankDir;
  clusterDepth: number;
  onChange: (field: 'layout' | 'dagreRankDir' | 'clusterDepth', value: LayoutType | RankDir | number) => void;
}

export interface ToolbarViewConfig {
  viewMode: ViewMode;
  graphType: GraphType;
  filterType: GraphNode['type'] | 'all';
  currentLayer: number;
  layerNames: string[];
  hierarchyLevel: number;
  hasSelectedFunction?: boolean;
  onChange: (field: 'viewMode' | 'graphType' | 'filterType' | 'layer' | 'hierarchyLevel', value: ViewMode | GraphType | GraphNode['type'] | 'all' | number) => void;
}

export interface ToolbarHistory {
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export interface ToolbarProps extends WorkspaceSelectorProps {
  statsText: string;
  typeCounts: { function: number; class: number; interface: number };
  theme: ThemeType;
  collapsed: boolean;
  hasData: boolean;
  /**
   * Raw graph presence, independent of the current view. Keeps the layout and
   * view-mode triggers usable when a behavioural view renders zero nodes
   * (J0 Round 11: the empty call-graph view used to strand the user).
   */
  hasGraphData: boolean;
  panelControls: PanelControls;
  layoutConfig: ToolbarLayoutConfig;
  viewConfig: ToolbarViewConfig;
  history?: ToolbarHistory;
  onThemeToggle: () => void;
  onRefresh: () => void;
  onExport: (format: ExportFormat) => void;
  onCollapse: () => void;
  onCollapseAll?: () => void;
}