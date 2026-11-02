/**
 * ρ 枚举的 commit 切片（cycle-137 / 研究方案 §4 的 $\\mathcal{T}$ 维）。
 *
 * ## 它解决什么
 *
 * 研究方案 §4 把路径查询定义为「在给定 commit 切片 `t` 下枚举」。cycle-134/135 的 ρ
 * 枚举只能在整个图上跑——`𝒯` 维度没有数据面。本模块把 `src/shared/temporal.ts` 的
 * `commitSliceGraph` 接进 ρ：给定 `commitLog`（`git log --name-only
 * --format=%x1e%H%x1f%ct` 的原始输出）与一个区间，先按区间切片，再在切片上枚举。
 *
 * ## 为什么切片而不是边级谓词
 *
 * 研究方案 §4 的原话是「在给定 commit 切片 `t` 下枚举」——切片是**图级**操作，
 * ρ 是**图级**操作。把切片放在枚举之前，等于复用既有的 `commitSliceGraph`
 * （已经测过、已经用于 `graph_slice`），而不必改枚举引擎的核心。
 *
 * 边级时序谓词（`temporalPredicate` 的挥发度过滤）是更细的语义，属于后续轮。
 *
 * ## 为什么调用方必须用**临时**适配器
 *
 * 切片后的图是原图的子集。把它 `syncGraph` 进按 repoId 缓存的共享池，会让池里的图
 * 变成切片——下一次不带 `commitLog` 的 ρ 调用会拿到切片图，静默少查。因此工具层
 * 必须为时序路径建一个**一次性**适配器。
 */
import type { GraphData } from '../../types/index.ts';
import {
  commitSliceGraph,
  parseCommitLog,
  type CommitRange,
  type CommitHistory,
} from '../temporal.ts';
import { XuanjiAdapterPool } from './XuanjiAdapter.ts';

/**
 * ρ 时序路径的**独立**适配器池（cycle-137）。
 *
 * ## 为什么独立于 tools.ts 的主池
 *
 * 切片图是原图的**子集**。把它 `syncGraph` 进按 repoId 缓存的主池，会让池里的图变成
 * 切片——下一次不带 `commitLog` 的 ρ 调用会拿到切片图，静默少查（与 cycle-135 的
 * 「所见即所查」同族缺陷）。因此时序路径必须用一个与主池**互不污染**的池。
 *
 * ## 为什么放在本模块而不是 tools.ts
 *
 * 源码级守卫（`tests/unit/xuanjiReachability.test.ts` 的 XJ-02 / `xuanjiIntegrationContract.test.ts`
 * 的 XJ-13）要求：
 * - `src/tools.ts` 里 `new XuanjiAdapterPool(` **恰好一次**；
 * - `src/tools.ts` 里 `new XuanjiAdapter()` **零次**；
 * - 全 `src/` 里唯一直接构造 `XuanjiAdapter` 的文件是池自身。
 *
 * 把时序池放在这里，tools.ts 只 import 它——三条守卫的计数与负向断言都不受影响。
 * 容量取 1：时序路径每次的切片都可能不同，本没有缓存收益，独立池只为「不污染主池」。
 */
export const temporalXuanjiPool = new XuanjiAdapterPool(1);

/** ρ 时序切片的请求参数。 */
export interface TemporalEnumerationRequest {
  /** 原始 `git log --name-only --format=%x1e%H%x1f%ct` 输出。 */
  commitLog?: string;
  /** 只保留最近 N 天内的提交。 */
  days?: number;
  /** 只保留该 hash 及之后的提交（含）。 */
  from?: string;
  /** 只保留到该 hash 为止（含）。 */
  to?: string;
  /** 参考时间（unix 毫秒）；测试注入固定值。 */
  now?: number;
}

/** `sliceGraphForTemporal` 的时序元信息（未请求时为 `null`）。 */
export interface TemporalEnumerationMeta {
  /** 调用方是否提供了 commitLog。 */
  requested: boolean;
  /** 是否真的拿到了可用切片。 */
  available: boolean;
  /** 命中的切片数。 */
  sliceCount: number;
  /** 命中区间的首个提交 hash。 */
  from: string | null;
  /** 命中区间的末个提交 hash。 */
  to: string | null;
  /** 区间是否把历史截断了。 */
  truncated: boolean;
  /** 不可用/空区间时的人类可读原因。 */
  reason?: string;
}

/** `sliceGraphForTemporal` 的结果。 */
export interface TemporalEnumerationOutcome {
  /** 用于枚举的图（未提供 commitLog 时为原图；提供且可用时为切片）。 */
  data: GraphData;
  /** 时序元信息；未请求时为 `null`（调用方据此区分「没请求」与「请求了但失败」）。 */
  temporal: TemporalEnumerationMeta | null;
}

/**
 * 按 commit 区间切片 ρ 枚举用的图。
 *
 * 契约：
 * - 未提供 / 空 `commitLog` ⇒ 返回原图 + `temporal: null`（**行为与既有调用逐字节一致**）；
 * - 提供了但切片不可用（历史为空 / 区间未命中）⇒ 返回**原图** + `temporal.available: false`
 *   与原因（调用方据此做诚实降级，**不**假装切片为空图）；
 * - 切片可用 ⇒ 返回切片图 + 完整元信息。
 */
export function sliceGraphForTemporal(
  data: GraphData,
  request: TemporalEnumerationRequest = {},
): TemporalEnumerationOutcome {
  const commitLog = request.commitLog;
  if (typeof commitLog !== 'string' || commitLog.trim() === '') {
    return { data, temporal: null };
  }

  const history: CommitHistory = {
    slices: parseCommitLog(commitLog),
    head: null,
    available: true,
  };

  const range: CommitRange = {
    ...(request.days !== undefined && Number.isFinite(request.days) ? { days: request.days } : {}),
    ...(request.from ? { from: request.from } : {}),
    ...(request.to ? { to: request.to } : {}),
    ...(request.now !== undefined && Number.isFinite(request.now) ? { now: request.now } : {}),
  };

  const slice = commitSliceGraph(data, range, history);
  if (!slice.available) {
    return {
      data,
      temporal: {
        requested: true,
        available: false,
        sliceCount: 0,
        from: null,
        to: null,
        truncated: false,
        reason: slice.reason ?? 'commit 切片不可用',
      },
    };
  }

  const sliced: GraphData = {
    nodes: slice.nodes,
    edges: slice.edges,
    metadata: { ...data.metadata },
  };
  return {
    data: sliced,
    temporal: {
      requested: true,
      available: true,
      sliceCount: slice.sliceCount,
      from: slice.from,
      to: slice.to,
      truncated: slice.truncated,
      ...(slice.reason ? { reason: slice.reason } : {}),
    },
  };
}
