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