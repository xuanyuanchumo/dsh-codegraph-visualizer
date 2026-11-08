import type { GraphNode } from '../../../types/index.ts';
import type { GraphState } from '../types.ts';
import { reclusterWith } from '../internals.ts';

type SetFn = (partial: Partial<GraphState>) => void;
type GetFn = () => GraphState;

/**
 * 多选链路的**消费面**（cycle-149）。
 *
 * cycle-141 D 在渲染器侧交付了 Shift+Click 多选（`InteractionController.multiSelectedIds`
 * + `multi-selected` class + `onSelectionToggle` 回调），但该回调在全仓**零消费方**——
 * 多选集合只活在渲染器内部，store/UI 全都看不到。本切片把这条链路接完：
 *
 * - `multiSelectedIds` 是渲染器多选集合的**镜像**（单一事实源仍是渲染器，
 *   store 只做镜像 + 批量动作的消费面；两边经 `syncMultiSelection`/`clearMultiSelection`
 *   同步，避免双集合各自演化后漂移）。
 * - `batchExpandSelected` 复用 expandSlice 的 `batchExpandNodes`（函数体预算 / pinned
 *   语义不重写——两处实现必然漂移，CLAUDE.md「Two data paths for the same semantics
 *   must share ONE implementation」）。
 * - `batchCollapseSelected` 与 expandSlice `collapseAll` 同形：**单次** recluster
 *   （逐个 collapseNode 会 N 次重聚类），pinned 节点不收（与 `collapseNode` 语义一致）。
 * - `exportSelectedNodes` 从 `rawNodes` 过滤导出；**聚合节点（cluster）不在 rawNodes 里**，
 *   选中聚合节点时该 id 被静默跳过——这是有意的诚实缺口（渲染器合并态 store 不可见），
 *   UI 侧以「导出 N 个」计数如实呈现，不伪造。
 *
 * `multiSelectedIds` **不持久化**：画布选区是会话瞬时态，reload 后节点可能已变
 * （与 `xuanjiSignal` 同判据）；`partialize` 白名单不收录即天然排除。
 */
export function createMultiSelectSlice(_set: SetFn, _get: GetFn): Partial<GraphState> {
  return {
    multiSelectedIds: new Set<string>(),

    /** 渲染器 onSelectionToggle 回传的**完整**集合镜像（不是增量 toggle——双集合各自演化必漂移）。 */
    syncMultiSelection: (ids: readonly string[]) => {
      const current = _get().multiSelectedIds;
      if (current.size === ids.length && [...ids].every((id) => current.has(id))) return;
      _set({ multiSelectedIds: new Set<string>(ids) });
    },

    /** 渲染器普通点击 / Esc 清空多选时的镜像清空（InteractionController 静默清空不带回调会留下过期镜像）。 */
    clearMultiSelection: () => {
      if (_get().multiSelectedIds.size === 0) return;
      _set({ multiSelectedIds: new Set<string>() });
    },

    /** 批量展开选区；返回处理数（0 = 空选区）。 */
    batchExpandSelected: () => {
      const ids = [..._get().multiSelectedIds];
      if (ids.length === 0) return 0;
      _get().batchExpandNodes(ids);
      return ids.length;
    },

    /** 批量收起选区（单次重聚类，pinned 豁免）；返回实际收起数。 */
    batchCollapseSelected: () => {
      const { multiSelectedIds, expandedNodeIds, expandedNodeIdsByViewMode, viewMode, pinnedIds } = _get();
      if (multiSelectedIds.size === 0) return 0;
      const newExpanded = new Set(expandedNodeIds);
      let collapsed = 0;
      for (const id of multiSelectedIds) {
        if (pinnedIds.has(id)) continue;
        if (newExpanded.delete(id)) collapsed++;
      }
      if (collapsed === 0) return 0;
      const newExpandedByViewMode = { ...expandedNodeIdsByViewMode, [viewMode]: newExpanded };
      reclusterWith(_get, _set, newExpanded, newExpandedByViewMode);
      return collapsed;
    },

    /** 导出选区数据快照（rawNodes 过滤；聚合节点跳过——见类注释的诚实缺口说明）。 */
    exportSelectedNodes: (): GraphNode[] => {
      const { multiSelectedIds, rawNodes } = _get();
      if (multiSelectedIds.size === 0) return [];
      return rawNodes.filter((n) => multiSelectedIds.has(n.id));
    },
  };
}
