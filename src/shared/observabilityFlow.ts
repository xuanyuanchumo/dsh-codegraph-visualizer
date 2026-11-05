/**
 * 可观测性流动数据构建器（cycle-142，T4）。
 *
 * ## 为什么需要这个模块
 *
 * cycle-141 第二轮交付的 `observability.ts` 数据面（计数器 + 管线耗时栈）与
 * RuntimePanel 的 `ObservabilitySection` 之间隔着「原始计数 → 可视化流动」的
 * 升维一步。cycle-141 只完成了**文本行呈现**（`cache.scan.hit: 12` 这样的
 * 键值对），用户点名的「量化、白盒透明化、可视化流动」还缺后半句：
 *
 *   - **管线流动条**：各阶段平均耗时占总耗时的比例 → 一条分段色带
 *     （学 dsh-context 的 timing strip 模式：数据段 `leftPct/widthPct` 前置计算）；
 *   - **缓存命中率**：hit/(hit+miss)，分母为 0 时不渲染（避免除零伪造 100%）；
 *   - **ETag 决策分布**：200/304/rejected 各占比 → 三段色带，rejected 是
 *     最该被看见的决策（cycle-82 ETag 身份定域的教训）；
 *   - **AST 预算用量**：requested/returned → 用量比 + 截断计数。
 *
 * ## 为什么是纯函数（CLAUDE.md 教训）
 *
 * 「预算规则带多个维度的属于纯函数，不属于组件」。本模块的占比/分母判零/
 * 排序/归一化逻辑全部无 React、无副作用——组件只负责把返回值画出来，
 * 测试不需要挂载任何组件就能钉死数学正确性。
 *
 * @module shared/observabilityFlow
 */

import { PIPELINE_ORDER, PIPELINE_STAGE_LABELS } from './observability.ts';

/** 管线流动条的一段：一个阶段的占比与绝对耗时。 */
export interface PipelineFlowSegment {
  /** 阶段名（observability 的内部键，如 `dbRead`）。 */
  stage: string;
  /** 显示名（中文技术术语，来自 PIPELINE_STAGE_LABELS）。 */
  label: string;
  /** 计时窗口数（最近样本数，≤100）。 */
  count: number;
  /** 平均耗时（毫秒）。 */
  avgMs: number;
  /** 最大耗时（毫秒）。 */
  maxMs: number;
  /** 该阶段平均耗时占所有已渲染阶段总平均耗时之和的比例（0-100，保留两位小数）。 */
  widthPct: number;
  /** 该段在色带中的起始位置（0-100，累计前序 widthPct）。 */
  leftPct: number;
}

/** 缓存命中率行。 */
export interface CacheFlowRow {
  /** 缓存名（scan / indexeddb / diagram / cluster）。 */
  cache: string;
  /** 命中次数。 */
  hits: number;
  /** 未命中次数。 */
  misses: number;
  /** 命中率 0-1；分母为 0 时为 null（调用方不渲染，避免伪造 100%）。 */
  ratio: number | null;
}

/** ETag 决策分布行。 */
export interface EtagFlowRow {
  /** 决策（200 / 304 / rejected）。 */
  decision: '200' | '304' | 'rejected';
  /** 该决策次数。 */
  count: number;
  /** 占全部 ETag 决策的比例 0-100；总决策数为 0 时为 null。 */
  pct: number | null;
}

/** AST 预算用量行。 */
export interface AstFlowRow {
  /** 累计请求节点数。 */
  requested: number;
  /** 累计返回节点数。 */
  returned: number;
  /** 截断次数。 */
  truncated: number;
  /** 分页未完（hasMore）次数。 */
  hasMore: number;
  /** 返回/请求比 0-1；请求为 0 时为 null。 */
  usage: number | null;
}

/** 可观测性流动快照：RuntimePanel 白盒区的新数据形状。 */
export interface ObservabilityFlow {
  /** 管线流动条分段（按 PIPELINE_ORDER 过滤掉 count=0 的阶段后保持数据流方向）。 */
  pipeline: PipelineFlowSegment[];
  /** 缓存命中率行（只保留 hit 或 miss 至少一项 > 0 的缓存）。 */
  cache: CacheFlowRow[];
  /** ETag 决策分布（只保留决策至少一项 > 0 的行）。 */
  etag: EtagFlowRow[];
  /** AST 预算用量；四项计数全 0 时为 null（无 AST 活动不渲染）。 */
  ast: AstFlowRow | null;
  /** 是否整体无任何可观测数据（调用方据此整区隐藏，与旧行为一致）。 */
  empty: boolean;
}

/** 输入形状：observability.snapshot() 的扁平计数 + getAllPipelineTiming()。 */
export interface ObservabilityFlowInput {
  counts: Record<string, number>;
  timing: Record<string, { count: number; avgMs: number; maxMs: number; minMs: number; lastMs: number }>;
}

/**
 * 把占比裁剪到 [0, 100] 并保留两位小数。
 *
 * 浮点累加可能出现 33.33000000000001 之类的尾数；统一走本函数，
 * 保证同输入的快照逐字节可比较（测试与视觉基线都依赖这一点）。
 */
function clampPct(pct: number): number {
  if (!Number.isFinite(pct) || pct < 0) return 0;
  if (pct > 100) return 100;
  return Math.round(pct * 100) / 100;
}

/** 四类缓存的固定顺序——渲染顺序稳定，与写入顺序无关。 */
const CACHE_ORDER = ['scan', 'indexeddb', 'diagram', 'cluster'] as const;

/** ETag 决策的固定顺序：200 → 304 → rejected（数据流方向 + 风险项殿后）。 */
const ETAG_ORDER = ['200', '304', 'rejected'] as const;

/**
 * 从原始计数与管线耗时构建流动快照。
 *
 * 排序契约：
 *   - `pipeline` 沿 **PIPELINE_ORDER（数据流方向）** 过滤 count=0 的阶段，
 *     不按耗时排序——流动条讲的是「数据往哪流、时间花在哪」，不是排行榜；
 *   - `cache` / `etag` 沿固定常量序（见上），零条目行被过滤；
 *   - 所有占比字段为 `null` 表示「无法计算」（分母为 0），**不是** 0%。
 */
export function buildObservabilityFlow(input: ObservabilityFlowInput): ObservabilityFlow {
  const { counts, timing } = input;

  // ── 管线流动条 ───────────────────────────────────────────────
  // 只统计有样本的阶段；avgMs 总和作为分母。没有样本 → 空数组。
  const activeStages = PIPELINE_ORDER.filter((stage) => {
    const tm = timing[stage];
    return tm !== undefined && tm.count > 0;
  });
  const totalAvg = activeStages.reduce((acc, stage) => acc + timing[stage]!.avgMs, 0);
  let cursor = 0;
  const pipeline: PipelineFlowSegment[] = activeStages.map((stage) => {
    const tm = timing[stage]!;
    const widthPct = totalAvg > 0 ? clampPct((tm.avgMs / totalAvg) * 100) : 0;
    const seg: PipelineFlowSegment = {
      stage,
      label: PIPELINE_STAGE_LABELS[stage] ?? stage,
      count: tm.count,
      avgMs: tm.avgMs,
      maxMs: tm.maxMs,
      widthPct,
      leftPct: clampPct(cursor),
    };
    cursor += widthPct;
    return seg;
  });

  // ── 缓存命中率 ───────────────────────────────────────────────
  const cache: CacheFlowRow[] = [];
  for (const cacheName of CACHE_ORDER) {
    const hits = counts[`cache.${cacheName}.hit`] ?? 0;
    const misses = counts[`cache.${cacheName}.miss`] ?? 0;
    if (hits === 0 && misses === 0) continue;
    cache.push({
      cache: cacheName,
      hits,
      misses,
      ratio: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 1000) / 1000 : null,
    });
  }

  // ── ETag 决策分布 ────────────────────────────────────────────
  // 只渲染发生过的决策（count>0）：零宽段不可见、图例也不该有死条目；
  // pct 为 null 仅当整体总数为 0——但那意味着没有任何行，故实际不会出现。
  const etagTotal = ETAG_ORDER.reduce((acc, d) => acc + (counts[`etag.${d}`] ?? 0), 0);
  const etag: EtagFlowRow[] = [];
  for (const decision of ETAG_ORDER) {
    const count = counts[`etag.${decision}`] ?? 0;
    if (count === 0) continue;
    etag.push({
      decision,
      count,
      pct: etagTotal > 0 ? clampPct((count / etagTotal) * 100) : null,
    });
  }

  // ── AST 预算用量 ─────────────────────────────────────────────
  const requested = counts['ast.requested'] ?? 0;
  const returned = counts['ast.returned'] ?? 0;
  const truncated = counts['ast.truncated'] ?? 0;
  const hasMore = counts['ast.hasMore'] ?? 0;
  const ast: AstFlowRow | null =
    requested === 0 && returned === 0 && truncated === 0 && hasMore === 0
      ? null
      : {
          requested,
          returned,
          truncated,
          hasMore,
          usage: requested > 0 ? Math.round((returned / requested) * 1000) / 1000 : null,
        };

  const empty = pipeline.length === 0 && cache.length === 0 && etag.length === 0 && ast === null;
  return { pipeline, cache, etag, ast, empty };
}
