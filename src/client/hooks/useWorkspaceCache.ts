import { useEffect, useRef } from 'react';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { useGraphStore } from '../store/graphStore.ts';

interface GraphCacheApi {
  getCachedData(workspace: string): { nodes: GraphNode[]; edges: GraphEdge[] } | null;
  cacheData(workspace: string, nodes: GraphNode[], edges: GraphEdge[]): void;
}

interface UseWorkspaceCacheOpts {
  currentWorkspace: string;
  rawNodes: GraphNode[];
  rawEdges: GraphEdge[];
  graphCache: GraphCacheApi;
  setGraphData: (nodes: GraphNode[], edges: GraphEdge[], repoId: string) => void;
}

/**
 * 工作区切换时的数据面（cycle-140 修复）。
 *
 * ## 缺陷现场
 *
 * 旧实现：切换工作区时缓存命中 ⇒ setGraphData(缓存)；缓存未命中 ⇒ **什么都不做**。
 * 于是画布保持上一个工作区的图——用户看到「对话在 A、图谱显示 B」的不一致
 * （会话跟随把 currentWorkspace 切到 A，但画布还是 B 的图）。
 *
 * ## 修复后的三态
 *
 * - 缓存命中 ⇒ 立即 setGraphData（同步切换，无闪烁）；
 * - 缓存未命中 ⇒ loadBootstrap() 拉取当前工作区的图（异步，期间画布短暂显示旧图
 *   是正常过渡——与任何异步切换一致）；
 * - loadBootstrap 失败（无索引/网络错误）⇒ clearGraph()：**画布绝不保留别的工作区
 *   的图**。留着它 = 用户看到错误的工作区的图谱，正是本缺陷的形态。
 */
export function useWorkspaceCache(opts: UseWorkspaceCacheOpts): void {
  const prevWorkspaceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!opts.currentWorkspace) return;
    if (prevWorkspaceRef.current && prevWorkspaceRef.current !== opts.currentWorkspace) {
      const cached = opts.graphCache.getCachedData(opts.currentWorkspace);
      if (cached) {
        opts.setGraphData(cached.nodes, cached.edges, opts.currentWorkspace);
      } else {
        // 缓存未命中 ⇒ 重新拉取当前工作区的图。loadBootstrap 读的是 store 里的
        // currentWorkspace（此刻已是新工作区），失败则清空画布（诚实降级）。
        const ok = useGraphStore.getState().loadBootstrap();
        void ok.then((loaded) => {
          if (!loaded) useGraphStore.getState().clearGraph();
        }).catch(() => useGraphStore.getState().clearGraph());
      }
    }
    prevWorkspaceRef.current = opts.currentWorkspace;
  }, [opts.currentWorkspace, opts.graphCache, opts.setGraphData]);

  useEffect(() => {
    if (opts.currentWorkspace && opts.rawNodes.length > 0) {
      opts.graphCache.cacheData(opts.currentWorkspace, opts.rawNodes, opts.rawEdges);
    }
  }, [opts.currentWorkspace, opts.rawNodes, opts.rawEdges, opts.graphCache]);
}