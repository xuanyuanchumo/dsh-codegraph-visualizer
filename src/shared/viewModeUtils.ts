import type { ViewMode } from '../types/index.ts';

export type LayoutType = 'cose' | 'dagre' | 'circle' | 'grid' | 'radial' | 'tree';

export const VIEW_MODE_LAYOUT: Record<ViewMode, LayoutType> = {
  code: 'cose',
  dependencies: 'dagre',
  inheritance: 'tree',
  callgraph: 'dagre',
  package: 'tree',
  class: 'dagre',
  cfg: 'dagre',
  flowchart: 'dagre',
  sequence: 'grid',
};

export function isLayeredViewMode(mode: ViewMode): boolean {
  return mode === 'inheritance' || mode === 'callgraph' || mode === 'package' || mode === 'class' || mode === 'dependencies';
}
