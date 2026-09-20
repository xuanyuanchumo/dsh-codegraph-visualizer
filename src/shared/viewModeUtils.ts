import type { ViewMode } from '../types/index.ts';

export type ThemeType = 'light' | 'dark';
export type LayoutType = 'cose' | 'fcose' | 'dagre' | 'circle' | 'grid' | 'radial' | 'tree';

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
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unhandled ViewMode: ${_exhaustive as string}`);
    }
  }
}
