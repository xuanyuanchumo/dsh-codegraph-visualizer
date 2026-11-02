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
  fileLevelEdgeFacts,
  parseCommitLog,
  temporalPredicate,
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

/**
 * 边级时序过滤的请求参数（cycle-138 / 研究方案 §4 的边级时序谓词）。
 *
 * 语义：在 commit 切片（图级）**之后**，再按「边的引入时间」做**边级**
 * 过滤。两者是正交的两刀：切片决定「哪些文件存在」，谓词决定「哪些关系够新」。
 */
export interface EdgeTemporalFilterRequest {
  /** 原始 `git log --name-only --format=%x1e%H%x1f%ct` 输出（与图级切片同一份）。 */
  commitLog?: string;
  /**
   * 挥发度下限（含）。**当前被显式拒绝**：挥发度需要边级事实（每个切片里边的
   * 存在性），raw `--name-only` 只有文件级事实 ⇒ 请求即返回 `available: false`
   * + reason（见 `filterEdgesByTemporalPredicate` 头注）。
   */
  minVolatility?: number;
  /** 挥发度上限（含）。同上，当前被显式拒绝。 */
  maxVolatility?: number;
  /** 只保留首次共同触及时刻（引入时刻的**下界**）≥ since 的边（unix 毫秒）。 */
  since?: number;
  /** 参考时间（unix 毫秒）；测试注入固定值，透传给 `temporalPredicate` 的 `days` 判定。 */
  now?: number;
}

/** 边级时序过滤的元信息（未请求时为 `null`）。 */
export interface EdgeTemporalMeta {
  /** 调用方是否请求了边级过滤（给了 commitLog 且给了任一谓词参数）。 */
  requested: boolean;
  /** 文件级事实是否可用（不可用时**全图保留**，不做静默清空）。 */
  available: boolean;
  /** 有事实的边数。 */
  factCount: number;
  /** 被谓词过滤掉的边数。 */
  filtered: number;
  /** 过滤后剩余的边数。 */
  kept: number;
  /** 不可用/未过滤时的人类可读原因。 */
  reason?: string;
}

/** 边级时序过滤的结果。 */
export interface EdgeTemporalOutcome {
  data: GraphData;
  meta: EdgeTemporalMeta | null;
}

/**
 * 按**边级时序谓词**过滤图（cycle-138）。
 *
 * ## 为什么放在图级切片之后、枚举之前
 *
 * 与 §14.3 的「切片是图级操作」同构：谓词是**边级**操作，ρ 是**图级**操作。
 * 把谓词放在枚举之前，等于先把不满足时序约束的边从图里**摘掉**再枚举——ρ 的
 * 长度区间、分页游标、截断预算全部按过滤后的图工作，语义不与分页纠缠。
 * （若把谓词做成枚举中的每步回调，`cursor` 的「第 k 条」语义会被过滤吞掉：
 * 同一游标翻页两次可能因过滤顺序产生不同结果——那正是 cycle-86 边聚合要修的
 * 「聚合与分页顺序」同族缺陷。）
 *
 * ## 三种状态（调用方——工具层——按 meta 分流）
 *
 * - 未请求（无 commitLog 或无谓词参数）⇒ 原图原样返回 + `meta: null`；
 * - 请求了但不可用 ⇒ **原图原样返回** + `available: false` + reason。这里刻意
 *   **不**在函数内清空边：过滤函数只负责诚实报告，「请求了但不可用 ⇒ 诚实空结果」
 *   的裁决权在工具层（与图级切片的既有契约同形，两处共用同一个早退分支）；
 * - 事实可用 ⇒ 只保留「有事实且通过谓词」的边；**无事实的边一律移除**
 *   （不知道 ≠ 符合，`temporalPredicate` 自己的语义就是缺事实判不符合）。
 *
 * ## `volatility` 谓词当前被显式拒绝（不是静默缺失）
 *
 * raw `git log --name-only` 只有文件级事实；挥发度需要**每个 commit 切片里这条边
 * 是否真的存在**（边级事实），当前没有任何数据面提供它。因此请求了
 * `minVolatility`/`maxVolatility` 时返回 `available: false` + 指明原因——这是一个
 * **可达且可测**的降级态，而不是「参数存在但永远产出空结果」的陷阱（那会让下一个
 * 调用方把「数据面缺失」误读成「图上没有稳定关系」）。等将来有边级采集渠道
 * （逐 commit 的边存在性），在 `fileLevelEdgeFacts` 的产出端点亮 `volatility`
 * 字段即可，谓词与工具面零改动。
 */
export function filterEdgesByTemporalPredicate(
  data: GraphData,
  request: EdgeTemporalFilterRequest = {},
): EdgeTemporalOutcome {
  const hasPredicate =
    request.minVolatility !== undefined ||
    request.maxVolatility !== undefined ||
    request.since !== undefined;
  if (typeof request.commitLog !== 'string' || request.commitLog.trim() === '' || !hasPredicate) {
    return { data, meta: null };
  }

  // 挥发度谓词需要边级事实：当前数据面（--name-only，文件级）不提供 ⇒ 显式拒绝。
  if (request.minVolatility !== undefined || request.maxVolatility !== undefined) {
    return {
      data,
      meta: {
        requested: true,
        available: false,
        factCount: 0,
        filtered: 0,
        kept: data.edges.length,
        reason: '挥发度过滤需要边级事实（每个 commit 切片里边的存在性）；当前数据面只有文件级事实（--name-only），挥发度谓词被显式拒绝',
      },
    };
  }

  // now 是 CommitRange 的可选字段：给就带上（测试注入固定值），不给则让
  // temporalPredicate 用自己的 Date.now() 缺省（与既有行为一致）。
  const range: CommitRange = request.now !== undefined && Number.isFinite(request.now)
    ? { now: request.now }
    : {};
  const report = fileLevelEdgeFacts(data.nodes, data.edges, request.commitLog as string, range);
  if (!report.available) {
    return {
      data,
      meta: {
        requested: true,
        available: false,
        factCount: 0,
        filtered: 0,
        kept: data.edges.length,
        reason: report.reason ?? 'commit 历史不可用',
      },
    };
  }

  const predicate = temporalPredicate({
    ...(request.since !== undefined ? { since: request.since } : {}),
    ...(request.now !== undefined ? { now: request.now } : {}),
  });

  const keptEdges = data.edges.filter((edge) => {
    const fact = report.facts.get(`${String(edge.source)}->${String(edge.target)}`);
    if (!fact) return false; // 无事实 ≠ 符合（与 temporalPredicate 的缺字段语义一致）。
    return predicate(fact);
  });
  return {
    data: { nodes: data.nodes, edges: keptEdges, metadata: { ...data.metadata } },
    meta: {
      requested: true,
      available: true,
      factCount: report.facts.size / 2, // 双向键指向同一事实。
      filtered: data.edges.length - keptEdges.length,
      kept: keptEdges.length,
    },
  };
}
