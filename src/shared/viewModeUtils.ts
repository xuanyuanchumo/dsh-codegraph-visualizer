import type { ViewMode } from '../types/index.ts';
import { assertNever } from './assertNever.ts';

export type ThemeType = 'light' | 'dark';
export type LayoutType = 'cose' | 'fcose' | 'dagre' | 'circle' | 'grid' | 'radial' | 'tree';
export type RankDir = 'TB' | 'LR' | 'BT' | 'RL';
export type ViewLayer = 'structural' | 'behavioral' | 'runtime';

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
