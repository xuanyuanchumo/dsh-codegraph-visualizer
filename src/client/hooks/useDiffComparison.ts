import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { fetchGraphDiff } from '../api/index.ts';
import { buildDiffIndex, type DiffMarkStats } from '../../shared/diffStatus.ts';
import type { DiffState } from '../store/types.ts';
import { scoped } from '../../shared/Logger.ts';

const log = scoped('diff');

/** 只依赖渲染器的两个 diff 方法，不依赖整个 `IRenderer` 表面（便于单测替身）。 */
interface DiffRendererHandle {
  applyDiffMarkers: (index: DiffState['index']) => DiffMarkStats;
  clearDiffMarkers: () => void;
}

export interface UseDiffComparisonParams {
  /** 面板是否可见。关闭时必须清除画布标记，否则标记会留在用户看不到任何解释的画面上。 */
  enabled: boolean;
  rendererRef: RefObject<DiffRendererHandle | null>;
  /** 当前工作区，作为 `/diff` 的 `workspace` 参数。 */
  workspace: string;
}

export interface UseDiffComparisonResult {
  /** 发起一次对比。`null` 返回值表示失败（见下方说明），成功时返回落库的 diff 状态。 */
  compare: (from: string, to: string) => Promise<DiffState | null>;
  /** 清空结果与画布标记。 */
  clear: () => void;
  isComparing: boolean;
  /** 最近一次对比的错误消息；`null` 表示没有错误。 */
  error: string | null;
  /** 最近一次标记的统计（含「diff 里有、但当前视图没渲染」的差额）。 */
  markStats: DiffMarkStats | null;
}

/**
 * 版本对比的编排层（研究报告 §六 #13）。
 *
 * 这条能力的三个缺口曾同时成立，任何单层修复都无效：
 *   1. 客户端**从未调用** `/diff`（全仓 `codegraph/diff` 只出现在宿主路由与限流表里）；
 *   2. 即使拿到响应，`diffStatus` 也没有任何渲染消费者（`grep diffStatus src/client` 为空）；
 *   3. 没有面板能显示「新增/修改/删除各多少」。
 *
 * 本 hook 把三者串起来，并刻意做了四个决定：
 *
 * - **失败与空结果必须可区分**。`fetchGraphDiff` 返回 `null` 表示失败，此时保留原有结果不动、
 *   只把 `error` 置上；绝不把失败渲染成「0 处变更」——用户会把一次失败读成「两版本完全一样」。
 * - **标记与数据分离**。`diffResult` 进 store（可被面板读取），标记进渲染器（视图态）。
 *   关闭面板只清标记与 store，不动 `rawNodes`——对比不是一次图替换。
 * - **请求可被下一次请求取代**。`generation` 令牌防止慢的旧请求覆盖新结果（与 `astRequestSeq`
 *   同族约束：代际计数器不能兼任请求归属）。
 * - **标记要在数据变化后重放**。`useGraphRenderer` 在 `nodes` 变化时会重建 cytoscape 元素，
 *   已加的 class 会随之消失；因此 effect 依赖 `markSignature`（由 store 的 `diffResult`
 *   与当前图版本共同决定），数据一变就重新标记。
 */
export function useDiffComparison(params: UseDiffComparisonParams): UseDiffComparisonResult {
  const { enabled, rendererRef, workspace } = params;

  const diffResult = useGraphStore((s) => s.diffResult);
  const setDiffResult = useGraphStore((s) => s.setDiffResult);
  const clearDiffResult = useGraphStore((s) => s.clearDiffResult);
  // 图替换会清空 diff（见 analysisSlice 的注释）；这里额外订阅「图版本」用于重放标记：
  // `lastUpdated` 在每次整图替换与增量补丁落地时都会前进，是现成的、无需新增字段的信号。
  const graphRevision = useGraphStore((s) => s.lastUpdated);

  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markStats, setMarkStats] = useState<DiffMarkStats | null>(null);

  // 请求归属令牌：慢的旧请求不得覆盖新结果。
  const generationRef = useRef(0);
  // 组件卸载后不再 setState / 不再碰渲染器。
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const clear = useCallback(() => {
    // 递增令牌让在途请求作废，否则它回来时会把刚清掉的结果又写回去。
    generationRef.current += 1;
    clearDiffResult();
    rendererRef.current?.clearDiffMarkers();
    setMarkStats(null);
    setError(null);
    setIsComparing(false);
  }, [clearDiffResult, rendererRef]);

  const compare = useCallback(async (from: string, to: string): Promise<DiffState | null> => {
    const gen = ++generationRef.current;
    setIsComparing(true);
    setError(null);
    try {
      const payload = await fetchGraphDiff(from, to, undefined, workspace);
      if (!aliveRef.current || gen !== generationRef.current) return null;
      if (!payload) {
        // 失败：保留上一次结果与画布标记不动，只报错。把失败当成「空 diff」会让用户
        // 得到「这两个版本没有任何差异」这个虚假结论。
        setError('diff request failed');
        setIsComparing(false);
        return null;
      }
      const index = buildDiffIndex(payload.nodes, payload.edges);
      const next: DiffState = {
        from: payload.from,
        to: payload.to,
        nodes: payload.nodes,
        edges: payload.edges,
        index,
        requestedAt: Date.now(),
        granularity: payload.granularity,
        truncated: payload.truncated,
      };
      setDiffResult(next);
      setIsComparing(false);
      return next;
    } catch (e) {
      if (!aliveRef.current || gen !== generationRef.current) return null;
      log.warn('diff comparison failed', e);
      setError(e instanceof Error ? e.message : String(e));
      setIsComparing(false);
      return null;
    }
  }, [setDiffResult, workspace]);

  /**
   * 标记重放。
   *
   * 依赖 `graphRevision`：整图替换 / 增量补丁会让渲染器重建元素，先前加的 class 全部消失，
   * 必须重新标记。依赖 `enabled`：面板关闭就清标记。
   *
   * 这里读 `rendererRef.current` 而不是把它放进 deps：ref 对象的 identity 永远不变，
   * 放进去等于没依赖；而渲染器本身在 `nodes` 变化时会被 `useGraphRenderer` 重建，
   * 靠 `graphRevision` 这个"图变了"的信号触发重放就够了。
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (!enabled || !diffResult) {
      renderer.clearDiffMarkers();
      setMarkStats(null);
      return;
    }
    const stats = renderer.applyDiffMarkers(diffResult.index);
    setMarkStats(stats);
  }, [enabled, diffResult, graphRevision, rendererRef]);

  return { compare, clear, isComparing, error, markStats };
}
