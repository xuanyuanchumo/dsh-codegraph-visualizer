import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { GraphState } from './types.ts';
import type { LayoutType } from '../../shared/viewModeUtils.ts';
import {
  internals, registerStoreGetter, diagramCache, clusterCache,
  invalidateExpandCostCache, clearLoadingFailsafe,
} from './internals.ts';
import { createGraphDataSlice } from './slices/graphDataSlice.ts';
import { createViewModeSlice } from './slices/viewModeSlice.ts';
import { createSessionSlice } from './slices/sessionSlice.ts';
import { createExpandSlice } from './slices/expandSlice.ts';
import { createWorkspaceSlice } from './slices/workspaceSlice.ts';
import { createPathFocusSlice } from './slices/pathFocusSlice.ts';
import { createFilterSlice } from './slices/filterSlice.ts';
import { createAnalysisSlice } from './slices/analysisSlice.ts';
import { createPanelLodSlice } from './slices/panelLodSlice.ts';

export type { ClusterNode, ClusterEdge } from './cluster/index.ts';
export type { LayoutType, ThemeType, RankDir } from '../../shared/viewModeUtils.ts';
export type { GraphType, WorkspaceInfo } from './types.ts';

const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export function disposeStore(): void {
  for (const controller of internals.prefetchAbortControllers.values()) controller.abort();
  internals.prefetchAbortControllers.clear();
  internals.prefetchInFlightCount = 0;
  for (const controller of internals.expandAbortControllers.values()) controller.abort();
  internals.expandAbortControllers.clear();
  if (internals.prefetchIdleHandle !== null) {
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(internals.prefetchIdleHandle as number);
    else clearTimeout(internals.prefetchIdleHandle as ReturnType<typeof setTimeout>);
    internals.prefetchIdleHandle = null;
  }
  const state = useGraphStore.getState();
  for (const controller of state.pendingRequests.values()) controller.abort();
  useGraphStore.setState({ pendingRequests: new Map() });
  if (internals.restoreTimeoutHandle !== null) {
    clearTimeout(internals.restoreTimeoutHandle);
    internals.restoreTimeoutHandle = null;
  }
  if (internals.restoreAbortController) {
    internals.restoreAbortController.abort();
    internals.restoreAbortController = null;
  }
  internals.restoreGeneration++;
  diagramCache.invalidate();
  clusterCache.invalidate();
  internals.incrementalClusterCtx = null;
  invalidateExpandCostCache();
  internals.microAssemblyGeneration = 0;
  internals.multiAssemblyGeneration = 0;
  internals.expandGeneration = 0;
  clearLoadingFailsafe();
  if (internals.persistentCache) { internals.persistentCache.close(); internals.persistentCache = null; }
  internals.persistentCacheRepoId = null;
}

export const useGraphStore = create<GraphState>()(
  persist(
    (set, get) => {
      const store = {
        ...createGraphDataSlice(set, get),
        ...createViewModeSlice(set, get),
        ...createSessionSlice(set, get),
        ...createExpandSlice(set, get),
        ...createWorkspaceSlice(set, get),
        ...createPathFocusSlice(set, get),
        ...createFilterSlice(set, get),
        ...createAnalysisSlice(set, get),
        ...createPanelLodSlice(set, get),
      };
      registerStoreGetter(get);
      return store as GraphState;
    },
    {
      name: 'dsh-codegraph-visualizer/ui',
      version: 9,
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? window.localStorage : memoryStorage,
      ),
      merge: (persisted, current) => {
        const p = persisted as Record<string, unknown>;
        const raw = p.expandedNodeIds;
        const expandedNodeIds = Array.isArray(raw)
          ? new Set(raw as string[])
          : raw instanceof Set ? (raw as Set<string>) : new Set<string>();
        return { ...current, ...(persisted as object), expandedNodeIds } as GraphState;
      },
      migrate: (persisted, version) => {
        const p = persisted as Partial<GraphState>;
        const layout = p.layout;
        const valid: LayoutType[] = ['cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree'];
        const result: Partial<GraphState> = {
          ...p,
          layout: valid.includes(layout as LayoutType) ? (layout as LayoutType) : 'cose',
          theme: p.theme === 'light' ? 'light' : 'dark',
          filterType: p.filterType ?? 'all',
        };
        if (version < 3) {
          result.workspaceList = Array.isArray(p.workspaceList) ? p.workspaceList : [];
          result.currentWorkspace = typeof p.currentWorkspace === 'string' ? p.currentWorkspace : '.';
        }
        if (version < 4) {
          (result as Record<string, unknown>).clusterLevel = 'directory';
        }
        if (version < 5) {
          const h = (p as { panelHeight?: unknown }).panelHeight;
          const w = (p as { panelWidth?: unknown }).panelWidth;
          result.panelHeight = typeof h === 'number' && h >= 240 ? h : null;
          result.panelWidth = typeof w === 'number' && w >= 320 ? w : null;
        }
        if (version < 6) {
          const validClusterLevels = ['directory', 'file', 'function', 'progressive'];
          if (!validClusterLevels.includes((p as { clusterLevel?: string }).clusterLevel ?? '')) {
            (result as Record<string, unknown>).clusterLevel = 'progressive';
          }
        }
        if (version < 7) {
          const oldLevel = (p as { clusterLevel?: string }).clusterLevel;
          const depthMap: Record<string, number> = { directory: 0, file: 1, function: 2, progressive: 0, smart: 0 };
          result.clusterDepth = typeof oldLevel === 'string' ? (depthMap[oldLevel] ?? 0) : 0;
        }
        if (version < 8) {
          const validRankDirs = ['TB', 'LR', 'BT', 'RL'];
          const savedRankDir = (p as { dagreRankDir?: string }).dagreRankDir;
          (result as Record<string, unknown>).dagreRankDir = validRankDirs.includes(savedRankDir ?? '') ? savedRankDir : 'TB';
        }
        if (version < 9) {
          const arr = (p as { expandedNodeIds?: unknown }).expandedNodeIds;
          (result as Record<string, unknown>).expandedNodeIds = Array.isArray(arr)
            ? new Set(arr as string[])
            : new Set<string>();
        }
        return result;
      },
      partialize: (s) => ({
        layout: s.layout, dagreRankDir: s.dagreRankDir, theme: s.theme, filterType: s.filterType,
        graphType: s.graphType, clusterDepth: s.clusterDepth,
        currentWorkspace: s.currentWorkspace, workspaceList: s.workspaceList,
        rules: s.rules, focusDepth: s.focusDepth,
        panelHeight: s.panelHeight, panelWidth: s.panelWidth,
        expandedNodeIds: [...s.expandedNodeIds],
      }),
    },
  ),
);
