/**
 * 时序视图（研究方案 §4 的 $\mathcal{T}$ 维）的**纯函数层**。
 *
 * 形式化定义：$\mathcal{G} = (V, E, \Sigma, \mathcal{T}, \Pi)$，其中 $\mathcal{T}$ 是
 * commit（或 commit 区间）索引。本模块把「以 commit 为切片单位的图切片」与
 * 「边的挥发度」这两件**没有副作用**的事放在 `src/shared/`，原因与 `churn.ts` 相同：
 * ① 宿主与浏览器端都能 import；② 单测不必真的跑 git；③ 关键不变量（缺数据时必须
 * 拒绝而不是编造）可以在纯函数层直接钉死。
 *
 * ## 数据来源（刻意不新建存储层）
 *
 * 仓库已有 `src/host/gitChurn.ts` 用 `git log --name-only` 采集变更频率。本模块复用
 * 同一份原始输出，只多解析出**每个提交的 hash 与时间戳**。分隔符必须放在格式
 * **开头**（`%x1e` 前置），与 `churn.ts` 的 `parseGitLogNames` 完全一致——若放在末尾，
 * 文件列表会落进下一个提交的分段，解析出的提交数与文件归属全部错位。
 *
 * ```
 * git log --name-only --format=%x1e%H%x1f%ct
 * ```
 *
 * 输出形状（`\x1e` 是提交分隔符，`\x1f` 分隔 hash 与 unix 时间戳）：
 *
 * ```
 * \x1e<hash>\x1f<unix-ts>
 * src/a.ts
 * src/b.ts
 * \x1e<hash2>\x1f<unix-ts2>
 * src/c.ts
 * ```
 *
 * `parseCommitLog` 把这段原始文本解析成 `CommitSlice[]`；宿主只需在既有的
 * `git log` 调用上换一个 `--format`，不必引入新的索引或数据库。
 *
 * ## 挥发度的语义（研究方案 §4 原文）
 *
 * $$
 * \text{vol}(u,v) = \frac{|\{t : (u,v,t) \in E\}|}{|\{t : u,v \text{ 均存在}\}|}
 * $$
 *
 * 分子 = 该边在**多少个 commit 切片中存在**；分母 = 两端点同时存在的切片数。
 * 比值接近 1 = 稳定关系，接近 0 = 只在个别切片里出现过（volatile）。
 *
 * **为什么缺边级事实时必须拒绝**：若 `CommitSlice.edges` 未提供，我们只能用
 * 「两端文件都被触及」近似「边存在」，此时分子恒等于分母、挥发度恒为 1——
 * 那是一份看起来正常、实则毫无信息的假数据。因此 `edgeVolatility` 在切片没有
 * 边级事实时返回 `available: false`，而不是返回一排 1.0。
 *
 * @module shared/temporal
 */

import type { GraphData, GraphEdge, GraphNode } from '../types/index.ts';
import { normalizeChurnPath } from './churn.ts';

/** 一个 commit 切片。 */
export interface CommitSlice {
  /** 提交 hash（完整或短 hash）。 */
  hash: string;
  /** 提交时间戳（unix 秒）。 */
  timestamp: number;
  /** 该提交触及的文件（已归一化路径，去空）。 */
  files: readonly string[];
  /**
   * 该切片中「已存在」的边（可选，**边级事实**）。
   *
   * 只有提供它才能算出有意义的挥发度分子；缺省时 `edgeVolatility` 拒绝计算。
   */
  edges?: ReadonlyArray<{ source: string; target: string }>;
}

/** 一次 commit 历史的采集结果。 */
export interface CommitHistory {
  slices: readonly CommitSlice[];
  /** 采集时的 HEAD；不可用为 `null`。 */
  head: string | null;
  /** 采集是否真的拿到了 git 数据。 */
  available: boolean;
  /** 失败原因（成功为 `null`）。 */
  error?: string | null;
}

/** commit 区间。`days` 与 `from`/`to` 可组合；`now` 可注入以便测试确定性。 */
export interface CommitRange {
  /** 只保留该 hash 及其之后的提交（含）。 */
  from?: string;
  /** 只保留到该 hash 为止（含）。 */
  to?: string;
  /** 只保留最近 N 天内的提交。 */
  days?: number;
  /** 参考时间（unix 毫秒）；缺省 `Date.now()`。测试注入固定值。 */
  now?: number;
}

/** `commitSliceGraph` 的结果。 */
export interface TemporalSliceResult {
  /** 是否真的拿到了可用切片。 */
  available: boolean;
  /** 命中的切片数。 */
  sliceCount: number;
  /** 命中区间的首个提交 hash。 */
  from: string | null;
  /** 命中区间的末个提交 hash。 */
  to: string | null;
  /** 区间是否把历史截断了（有提交被排除在外）。 */
  truncated: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** 不可用/空区间时的人类可读原因。 */
  reason?: string;
}

/** 单条边的挥发度。 */
export interface EdgeVolatilityEntry {
  edgeId: string;
  /** 分子：该边存在的切片数。 */
  presentSlices: number;
  /** 分母：两端点同时存在的切片数。 */
  endpointSlices: number;
  /** 挥发度 = presentSlices / endpointSlices；分母为 0 时取 0。 */
  volatility: number;
  /** 该边首次出现的切片时间戳（用于「过去 N 天内新增」这类谓词）。 */
  firstSeenAt?: number;
}

/** `edgeVolatility` 的结果。 */
export interface EdgeVolatilityReport {
  available: boolean;
  /** 参与计算的历史切片数。 */
  slices: number;
  edges: EdgeVolatilityEntry[];
  reason?: string;
}

/** 时序谓词的输入事实（来自 `EdgeVolatilityEntry`）。 */
export interface TemporalEdgeFact {
  firstSeenAt?: number;
  volatility?: number;
}

/** `temporalPredicate` 的规格。 */
export interface TemporalPredicateSpec {
  /** 只保留「首次出现时间在最近 N 天内」的边。 */
  days?: number;
  /** 只保留「首次出现时间不早于该 unix 毫秒」的边。 */
  since?: number;
  /** 挥发度下限（含）。 */
  minVolatility?: number;
  /** 挥发度上限（含）。 */
  maxVolatility?: number;
  /** 参考时间（unix 毫秒）；缺省 `Date.now()`。 */
  now?: number;
}

/** `temporalPredicate` 产出的谓词：接在 ρ 的边匹配之后做时序过滤。 */
export type TemporalPredicate = (fact: TemporalEdgeFact) => boolean;

/**
 * 解析 `git log --name-only --format=%x1e%H%x1f%ct` 的原始输出。
 *
 * 这是**纯函数**：只按 `\x1e` 分段，不访问 git、不抛异常。空行被跳过，
 * 重命名行（`a -> b`）取新路径——与 `churn.ts` 的 `parseGitLogNames` 同一套
 * 归一化口径（`normalizeChurnPath` 是唯一真源）。
 */
export function parseCommitLog(raw: string): CommitSlice[] {
  const segments = String(raw ?? '').split('\x1e');
  const slices: CommitSlice[] = [];

  for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
    const lines = segments[segIndex]?.split(/\r?\n/) ?? [];
    const header = (lines[0] ?? '').trim();
    // 头部可能是 `<hash>\x1f<unix-ts>`（增强格式）或直接是文件名（旧版 `%x1e`）。
    // 刻意**不用**带控制字符的正则（`\x1f`）—— oxlint 的 no-control-regex 会拦；
    // 先按 `\x1f` 切分、再用纯 ASCII 正则判定，语义完全等价。
    const headerParts = header.split('\x1f');
    const hashPart = (headerParts[0] ?? '').trim();
    const tsPart = (headerParts[1] ?? '').trim();
    const isEnriched = /^[0-9a-f]{7,40}$/.test(hashPart) && /^\d+$/.test(tsPart);

    // 兼容旧版 `--format=%x1e`：该格式只输出文件名、没有 hash 与时间戳。
    // 此时给一个稳定的合成 hash（seg-<序号>）与时间戳 0——**时间窗过滤会如实落空**，
    // 因为「不知道时间」不能伪装成「发生在此刻」。
    const hash = isEnriched ? hashPart : `seg-${segIndex}`;
    const timestamp = isEnriched ? Number(tsPart) : 0;
    if (!isEnriched && !header) continue; // 段首空行：不是提交。

    const files: string[] = [];
    for (const lineRaw of lines.slice(isEnriched ? 1 : 0)) {
      const line = lineRaw.trim();
      if (!line) continue;
      const arrow = line.indexOf(' -> ');
      const filePath = normalizeChurnPath(arrow >= 0 ? line.slice(arrow + 4) : line);
      if (filePath) files.push(filePath);
    }

    slices.push({ hash, timestamp, files });
  }
  return slices;
}

/**
 * 按区间过滤切片。
 *
 * 顺序：先 `days`（时间窗），再 `from`（含），再 `to`（含）。任何一步找不到目标
 * 都返回**空切片 + truncated**：宁可说「这个区间里没有东西」，也不要悄悄放宽边界。
 */
export function filterSlices(
  history: CommitHistory,
  range: CommitRange,
  now: number = Date.now(),
): { slices: CommitSlice[]; truncated: boolean } {
  let slices = [...history.slices];
  let truncated = false;

  if (range.days !== undefined && Number.isFinite(range.days)) {
    const cutoff = now - range.days * 86_400_000;
    const kept = slices.filter((slice) => slice.timestamp * 1000 >= cutoff);
    truncated = kept.length !== slices.length;
    slices = kept;
  }

  if (range.from) {
    const index = slices.findIndex((slice) => slice.hash === range.from);
    if (index < 0) return { slices: [], truncated: true };
    slices = slices.slice(index);
  }

  if (range.to) {
    const index = slices.findIndex((slice) => slice.hash === range.to);
    if (index < 0) return { slices: [], truncated: true };
    slices = slices.slice(0, index + 1);
  }

  return { slices, truncated };
}

/**
 * 以 commit 区间为切片，取「区间内至少被触及过一次的文件」所诱导的子图。
 *
 * 节点保留条件：其 `filePath`（归一化）出现在区间内任一切片的 `files` 中。
 * 边保留条件：两端点都保留。这是「commit 切片」在只给文件触及数据时最诚实的近似——
 * 我们无法知道某文件在区间内是否被删除，因此把「被触及」当作「在该切片存在」。
 *
 * **缺历史时返回 `available: false` 的空图**：没有 $\mathcal{T}$ 就没有时序切片，
 * 把它渲染成「空图」比渲染成「整个仓库」更接近事实。
 */
export function commitSliceGraph(
  data: Pick<GraphData, 'nodes' | 'edges'>,
  commitRange: CommitRange,
  history?: CommitHistory | null,
): TemporalSliceResult {
  if (!history || !history.available || history.slices.length === 0) {
    return {
      available: false,
      sliceCount: 0,
      from: null,
      to: null,
      truncated: false,
      nodes: [],
      edges: [],
      reason: history && history.available ? 'commit 历史为空' : '未提供可用的 commit 历史',
    };
  }

  const now = commitRange.now ?? Date.now();
  const { slices, truncated } = filterSlices(history, commitRange, now);
  const activeFiles = new Set<string>();
  for (const slice of slices) {
    for (const file of slice.files) activeFiles.add(file);
  }

  const nodes = data.nodes.filter((node) => activeFiles.has(normalizeChurnPath(node.filePath)));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = data.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  const first = slices[0];
  const last = slices[slices.length - 1];
  return {
    available: true,
    sliceCount: slices.length,
    from: first?.hash ?? null,
    to: last?.hash ?? null,
    truncated,
    nodes,
    edges,
    ...(slices.length === 0 ? { reason: '区间内没有提交' } : {}),
  };
}

/**
 * 计算一组边的挥发度。
 *
 * 分母 = 两端点文件同时出现在该切片 `files` 里的切片数；
 * 分子 = 在这些切片里 `slice.edges` 也确实包含该边的切片数（边级事实）。
 *
 * **拒绝假数据**：只要有一个切片没有提供 `edges`，就无法区分「边不存在」与
 * 「我们不知道」，于是整体返回 `available: false`（而不是用文件近似把分子凑成分母）。
 *
 * `nodeFiles` 是 nodeId → 文件路径的映射，来自图节点；缺它同样拒绝计算。
 */
export function edgeVolatility(
  edges: readonly GraphEdge[],
  commitHistory: CommitHistory,
  nodeFiles?: Readonly<Record<string, string>> | null,
): EdgeVolatilityReport {
  const emptyReport = (reason: string): EdgeVolatilityReport => ({
    available: false,
    slices: commitHistory.slices.length,
    edges: [],
    reason,
  });

  if (!commitHistory || !commitHistory.available || commitHistory.slices.length === 0) {
    return emptyReport('未提供可用的 commit 历史');
  }
  // 每个切片都必须给出边级事实，否则分子无从谈起（见文件头「拒绝假数据」）。
  if (!commitHistory.slices.every((slice) => slice.edges !== undefined)) {
    return emptyReport('commit 切片未提供边级事实（edges）');
  }
  if (!nodeFiles) {
    return emptyReport('缺少 nodeId → 文件路径映射，无法判定端点存在性');
  }

  const results: EdgeVolatilityEntry[] = [];
  for (const edge of edges) {
    const fileU = nodeFiles[String(edge.source)];
    const fileV = nodeFiles[String(edge.target)];
    if (!fileU || !fileV) continue; // 端点不在已知文件里：不猜。

    let endpointSlices = 0;
    let presentSlices = 0;
    let firstSeenAt: number | undefined;

    for (const slice of commitHistory.slices) {
      if (!slice.files.includes(fileU) || !slice.files.includes(fileV)) continue;
      endpointSlices += 1;
      const present = slice.edges?.some(
        (e) =>
          (e.source === String(edge.source) && e.target === String(edge.target)) ||
          (e.source === String(edge.target) && e.target === String(edge.source)),
      );
      if (present) {
        presentSlices += 1;
        if (firstSeenAt === undefined) firstSeenAt = slice.timestamp * 1000;
      }
    }

    results.push({
      edgeId: String(edge.id),
      presentSlices,
      endpointSlices,
      volatility: endpointSlices > 0 ? presentSlices / endpointSlices : 0,
      ...(firstSeenAt === undefined ? {} : { firstSeenAt }),
    });
  }

  return { available: true, slices: commitHistory.slices.length, edges: results };
}

/**
 * 构造时序谓词，供 `graph_path_pattern` 的 ρ 在边类型匹配之后再过滤。
 *
 * 语义：默认（空规格）恒真；给出 `days`/`since`/挥发度区间时，缺少对应事实的边
 * **不进入结果**（把「不知道」当成「不符合」是安全方向——宁可少返回，也不要把
 * 一条无法判定时序的边当成新边放出来）。
 */
export function temporalPredicate(spec: TemporalPredicateSpec = {}): TemporalPredicate {
  const now = spec.now ?? Date.now();
  return (fact: TemporalEdgeFact) => {
    if (spec.days !== undefined) {
      if (fact.firstSeenAt === undefined) return false;
      if (fact.firstSeenAt < now - spec.days * 86_400_000) return false;
    }
    if (spec.since !== undefined) {
      if (fact.firstSeenAt === undefined) return false;
      if (fact.firstSeenAt < spec.since) return false;
    }
    if (spec.minVolatility !== undefined) {
      if (fact.volatility === undefined || fact.volatility < spec.minVolatility) return false;
    }
    if (spec.maxVolatility !== undefined) {
      if (fact.volatility === undefined || fact.volatility > spec.maxVolatility) return false;
    }
    return true;
  };
}
