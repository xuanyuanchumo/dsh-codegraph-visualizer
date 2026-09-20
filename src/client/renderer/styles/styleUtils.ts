export interface ThemeColors {
  nodeDefault: string;
  nodeFunction: string;
  nodeClass: string;
  nodeVariable: string;
  nodeModule: string;
  nodeInterface: string;
  nodeType: string;
  nodeDepNpm: string;
  nodeDepCargo: string;
  nodeDepGomod: string;
  nodeDepPip: string;
  edgeDefault: string;
  edgeCall: string;
  edgeImport: string;
  edgeExtend: string;
  edgeImplement: string;
  edgeDependency: string;
  edgeContains: string;
  edgeDepProd: string;
  edgeDepDev: string;
  edgeDepPeer: string;
  edgeDepOptional: string;
  text: string;
  border: string;
}

export function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

let cssVarCache: Map<string, string> | null = null;

export function readCssVarCached(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  if (!cssVarCache) {
    const style = getComputedStyle(document.body);
    cssVarCache = new Map();
    const vars = [
      '--cg-node-default', '--cg-node-function', '--cg-node-class', '--cg-node-variable',
      '--cg-node-module', '--cg-node-interface', '--cg-node-type', '--cg-node-dep-npm',
      '--cg-node-dep-cargo', '--cg-node-dep-gomod', '--cg-node-dep-pip',
      '--cg-edge-default', '--cg-edge-call', '--cg-edge-import', '--cg-edge-extend',
      '--cg-edge-implement', '--cg-edge-dependency', '--cg-edge-contains',
      '--cg-edge-dep-prod', '--cg-edge-dep-dev', '--cg-edge-dep-peer', '--cg-edge-dep-optional',
      '--cg-text', '--cg-text-secondary', '--cg-text-tertiary', '--cg-border', '--cg-border-strong',
      '--cg-hover-border', '--cg-impact-d1', '--cg-impact-d2',
      '--cg-impact-d3', '--cg-inheritance-extend', '--cg-inheritance-implement',
      '--cg-cluster-bg', '--cg-cluster-border', '--cg-cluster-hover-bg',
      '--cg-cluster-hover-border', '--cg-cluster-edge', '--cg-cluster-edge-label-bg',
      '--cg-warning', '--cg-error', '--cg-success', '--cg-accent', '--cg-accent-hover',
      '--cg-accent-soft', '--cg-surface', '--cg-surface-hover', '--cg-surface-active',
      '--cg-role-entry', '--cg-role-orphan', '--cg-role-leaf', '--cg-role-hub',
      '--cg-heatmap-stable', '--cg-heatmap-unstable', '--cg-heatmap-low', '--cg-heatmap-high',
      '--cg-cycle-highlight',
    ];
    for (const v of vars) {
      cssVarCache.set(v, style.getPropertyValue(v).trim());
    }
  }
  return cssVarCache.get(name) || fallback;
}

export function invalidateCssVarCache(): void {
  cssVarCache = null;
}