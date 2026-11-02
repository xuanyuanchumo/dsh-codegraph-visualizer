import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { GraphState } from './types.ts';
import type { LayoutType } from '../../shared/viewModeUtils.ts';
import { LAYOUT_ORDER } from '../../shared/viewModeUtils.ts';
import {
  internals, registerStoreGetter, diagramCache, clusterCache,
  invalidateExpandCostCache, clearLoadingFailsafe, abortAllControllers,
} from './internals.ts';
import { createGraphDataSlice } from './slices/graphDataSlice.ts';
import { createViewModeSlice } from './slices/viewModeSlice.ts';
import { createSessionSlice } from './slices/sessionSlice.ts';
import { createExpandSlice } from './slices/expandSlice.ts';
import { createEdgeSlice } from './slices/edgeSlice.ts';
import { createWorkspaceSlice } from './slices/workspaceSlice.ts';
import { createPathFocusSlice } from './slices/pathFocusSlice.ts';
import { createFilterSlice } from './slices/filterSlice.ts';
import { createAnalysisSlice } from './slices/analysisSlice.ts';
import { createPanelLodSlice } from './slices/panelLodSlice.ts';
import { createKeywordQuerySlice } from './slices/keywordQuerySlice.ts';
import { createPathPatternSlice } from './slices/pathPatternSlice.ts';
import { clearEtagCache } from '../api/index.ts';
import { getMinPanelSize } from '../../shared/constants.ts';
import { getSafeStorage, safeGetItem } from '../utils/safeStorage.ts';

export type { ClusterNode, ClusterEdge } from './cluster/index.ts';
export type { LayoutType, ThemeType, RankDir } from '../../shared/viewModeUtils.ts';
export type { GraphType, WorkspaceInfo } from './types.ts';

/**
 * 持久化后端的选取**必须走 `getSafeStorage()`**，不能在这里直接摸 `window.localStorage`。
 *
 * 修前是 `typeof window !== 'undefined' ? window.localStorage : memoryStorage`：跨源 iframe
 * （`dsh-remote-web-ui`）里读 `window.localStorage` 这个属性**本身**就抛 `SecurityError`，
 * 而这段代码在 `create()` 的初始化路径上执行 ⇒ store 建不出来 ⇒ 插件白屏，且**没有任何
 * 可见错误**（只有一行被吞掉的异常）。选一个会抛的后端，等于把"持久化失效"升级成"整块 UI 挂了"。
 *
 * 模块级求值只在**一次**做：`getSafeStorage()` 内含一次真读真写探测（`setItem` + `removeItem`），
 * 每个请求/每次渲染都探测一遍是不必要的开销，而它探测的是环境属性、不是状态。
 */
const persistedStorage: StateStorage = getSafeStorage('graphStore');

export function disposeStore(): void {
  abortAllControllers(internals.prefetchAbortControllers);
  internals.prefetchInFlightCount = 0;
  abortAllControllers(internals.expandAbortControllers);
  if (internals.prefetchIdleHandle !== null) {
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(internals.prefetchIdleHandle as number);
    else clearTimeout(internals.prefetchIdleHandle as ReturnType<typeof setTimeout>);
    internals.prefetchIdleHandle = null;
  }
  const state = useGraphStore.getState();
  abortAllControllers(state.pendingRequests);
  useGraphStore.setState({
    pendingRequests: new Map(),
    nodeEdgesByNodeId: new Map(),
    nodeEdgeTotals: new Map(),
    nodeEdgeCursors: new Map(),
    loadingEdgeNodeIds: new Set(),
    detailEdgeNodeIds: new Set(),
  });
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
  // 按需路由的校验值缓存与"客户端持有的载荷"是一对：store 被释放后载荷没了，
  // 校验值留着只会让重新挂载的实例拿到 304。
  clearEtagCache();
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
        ...createEdgeSlice(set, get),
        ...createWorkspaceSlice(set, get),
        ...createPathFocusSlice(set, get),
        ...createFilterSlice(set, get),
        ...createAnalysisSlice(set, get),
        ...createPanelLodSlice(set, get),
        // 关键词图检索的请求状态（cycle-111 / N-5）。`GraphState` 的形状由该切片用
        // 声明合并扩展（见 `keywordQuerySlice.ts` 顶部的说明），因此这里只需并进来。
        ...createKeywordQuerySlice(set, get),
        // 璇玑图 ρ 路径模式枚举的请求状态（cycle-135）。`GraphState` 的形状由该切片用
        // 声明合并扩展（见 `pathPatternSlice.ts` 顶部的说明），因此这里只需并进来。
        ...createPathPatternSlice(set, get),
      };
      registerStoreGetter(get);
      return store as GraphState;
    },
    {
      name: 'dsh-codegraph-visualizer/ui',
      version: 10,
      storage: createJSONStorage(() => persistedStorage),
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
        // 原先此处有第 3 份布局顺序副本（cycle-84 收敛到 `LAYOUT_ORDER`）。
        const valid = LAYOUT_ORDER as readonly LayoutType[];
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
          const minSize = getMinPanelSize('unknown');
          result.panelHeight = typeof h === 'number' && h >= minSize.minHeight ? h : null;
          result.panelWidth = typeof w === 'number' && w >= minSize.minWidth ? w : null;
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
        if (version < 10) {
          const byMode = (p as { expandedNodeIdsByViewMode?: unknown }).expandedNodeIdsByViewMode;
          if (byMode && typeof byMode === 'object') {
            const restored: Record<string, Set<string>> = {};
            for (const [k, v] of Object.entries(byMode as Record<string, unknown>)) {
              restored[k] = Array.isArray(v) ? new Set(v as string[]) : new Set<string>();
            }
            (result as Record<string, unknown>).expandedNodeIdsByViewMode = restored;
          }
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
        expandedNodeIdsByViewMode: Object.fromEntries(
          Object.entries(s.expandedNodeIdsByViewMode).map(([k, v]) => [k, [...v]])
        ),
      }),
    },
  ),
);
// 调试开关同样不能直接摸 `localStorage`：这一句在**模块顶层**，跨源 iframe 里它会抛
// `SecurityError`，一个纯调试用途的开关不该能把整个模块求值干掉（与上面 `persistedStorage`
// 同一类缺陷，只是位置更早、症状更直接）。
if (typeof window !== 'undefined' && safeGetItem('__cg_debug') === '1') {
  (window as unknown as Record<string, unknown>).__graphStore = useGraphStore;
}
