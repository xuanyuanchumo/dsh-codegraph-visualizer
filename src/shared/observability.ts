/**
 * 白盒可观测性计数器（cycle-141 第二轮）。
 *
 * ## 为什么需要这个模块
 *
 * PerformanceMonitor 只度量**耗时**（cluster/layout/render/diagram/ast-fetch），
 * 但「白盒透明化」还需要回答**计数**问题：
 *   - 缓存命中率是多少？（scanCache / IndexedDB / diagramCache / clusterCache）
 *   - ETag 决策分布如何？（200 多还是 304 多？校验值命中/未命中/被拒绝？）
 *   - AST 预算用量如何？（请求了多少节点、返回了多少、截断了多少、hasMore？）
 *   - 管线各阶段耗时如何？（scan/init/import/DB 读取/三源合并/璇玑增量）
 *
 * 这些是**计数**而非**耗时**，不能用 measureSync 度量。本模块提供轻量级计数器：
 *   - `incr(key, delta)` — 原子递增（Map + 计数）
 *   - `snapshot()` — 一次性取全部计数（供面板渲染）
 *   - `reset()` — 清零（测试用）
 *
 * ## 设计约束
 *
 * - **纯计数，无副作用**：不写文件、不发事件、不触发重渲染——只更新内部 Map。
 * - **线程安全**：JavaScript 单线程，Map 操作天然原子。
 * - **零第三方依赖**：只依赖 Node/浏览器原生 Map。
 * - **可测试**：reset() 后所有计数归零，snapshot() 返回确定性结构。
 *
 * @module shared/observability
 */

/** 计数器条目：累计值 + 采样时间。 */
export interface CounterEntry {
  value: number;
  /** 首次记录的时间戳（用于「最近一次活动」显示）。 */
  firstSeen: number;
  /** 最后一次递增的时间戳。 */
  lastSeen: number;
}

const counters = new Map<string, CounterEntry>();

/**
 * 递增计数器。delta 缺省为 1。
 *
 * 幂等：对不存在的 key 首次调用会创建条目。
 */
export function incr(key: string, delta: number = 1): void {
  const now = Date.now();
  const existing = counters.get(key);
  if (existing) {
    existing.value += delta;
    existing.lastSeen = now;
  } else {
    counters.set(key, { value: delta, firstSeen: now, lastSeen: now });
  }
}

/**
 * 递减计数器。不会低于 0（负值无意义）。
 */
export function decr(key: string, delta: number = 1): void {
  const existing = counters.get(key);
  if (!existing) return;
  const newValue = existing.value - delta;
  if (newValue > 0) {
    existing.value = newValue;
    existing.lastSeen = Date.now();
  } else {
    counters.delete(key);
  }
}

/**
 * 结束该阶段所有**未配对**的计时窗口（reset 用）。
 *
 * 「未配对」= `pipelinePendingMarks` 里还挂着起始时间、从未等到对应 `end` 的窗口。
 * 只清理挂起窗口、**不产生样本**：没有发生的测量不能伪造一次 0ms 样本。
 */
function clearPendingMarks(): void {
  pipelinePendingMarks.clear();
}

/**
 * 读取单个计数器值（不存在返回 0）。 */
export function getCount(key: string): number {
  return counters.get(key)?.value ?? 0;
}

/**
 * 读取全部计数器快照。
 *
 * 返回 `{ key: value }` 的扁平对象，方便面板渲染与测试断言。
 */
export function snapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, entry] of counters) {
    out[key] = entry.value;
  }
  return out;
}

/**
 * 清零全部计数器与管线计时状态（测试用）。
 *
 * 注意：这**不**重置 PerformanceMonitor 的阈值表（那是另一个模块的职责）。
 * 调用方如果需要完整重置，必须同时调用 `clearMeasurements()` 与 `resetThresholds()`。
 *
 * cycle-141 第四轮修复（模块级单例成对重置）：此前本函数只清 `counters`，
 * 不清 `pipelineDurations` / `pipelinePendingMarks`——一个测试里留下的计时样本
 * 会泄入下一个测试（CLAUDE.md「模块级单例必须成对重置」教训的原样复发：
 * `clearMeasurements()` 不重置阈值表是同一家族缺陷）。挂起窗口只清理、
 * 不产生样本——没有发生的测量不能伪造一次 0ms 样本。
 */
export function reset(): void {
  counters.clear();
  pipelineDurations.clear();
  clearPendingMarks();
}

/** 计数器键名常量——避免散落的字符串字面量漂移。 */
export const OBS_KEYS = {
  // 缓存命中/未命中
  cacheScanHit: 'cache.scan.hit',
  cacheScanMiss: 'cache.scan.miss',
  cacheIndexedDbHit: 'cache.indexeddb.hit',
  cacheIndexedDbMiss: 'cache.indexeddb.miss',
  cacheDiagramHit: 'cache.diagram.hit',
  cacheDiagramMiss: 'cache.diagram.miss',
  cacheClusterHit: 'cache.cluster.hit',
  cacheClusterMiss: 'cache.cluster.miss',

  // ETag 决策
  etag200: 'etag.200',
  etag304: 'etag.304',
  etagRejected: 'etag.rejected',

  // AST 预算用量
  astRequested: 'ast.requested',
  astReturned: 'ast.returned',
  astTruncated: 'ast.truncated',
  astHasMore: 'ast.hasMore',

  // 管线阶段计数
  pipelineScan: 'pipeline.scan',
  pipelineInit: 'pipeline.init',
  pipelineImport: 'pipeline.import',
  pipelineDbRead: 'pipeline.dbRead',
  pipelineMerge: 'pipeline.merge',
  pipelineXuanjiDelta: 'pipeline.xuanjiDelta',
  pipelineXuanjiDegraded: 'pipeline.xuanjiDegraded',
} as const;

/**
 * 缓存决策记录器——统一记录命中/未命中。
 *
 * 调用方不需要自己判断 key 是否存在，只需调用 `recordCacheHit(cache)` 或
 * `recordCacheMiss(cache)`，由本函数映射到正确的计数器键。
 */
export function recordCacheHit(cache: 'scan' | 'indexeddb' | 'diagram' | 'cluster'): void {
  incr(`cache.${cache}.hit`);
}

export function recordCacheMiss(cache: 'scan' | 'indexeddb' | 'diagram' | 'cluster'): void {
  incr(`cache.${cache}.miss`);
}

/**
 * ETag 决策记录器。
 *
 * 只记录「决策」而非「传输」——304 是服务端说「没变」，200 是服务端说「变了」。
 * `rejected` 是校验值被拒绝（格式错误/维度不匹配）——这是最该被看见的决策。
 */
export function recordEtagDecision(decision: '200' | '304' | 'rejected'): void {
  incr(`etag.${decision}`);
}

/**
 * AST 预算用量记录器。
 *
 * 每次 AST 请求记录请求的节点数、返回的节点数、是否截断、是否 hasMore。
 * 这些数字在 UI 从未呈现（CLAUDE.md 明确点名过这个「层层丢弃」缺陷）。
 */
export function recordAstBudget(stats: { requested: number; returned: number; truncated: boolean; hasMore: boolean }): void {
  incr(OBS_KEYS.astRequested, stats.requested);
  incr(OBS_KEYS.astReturned, stats.returned);
  if (stats.truncated) incr(OBS_KEYS.astTruncated);
  if (stats.hasMore) incr(OBS_KEYS.astHasMore);
}

/**
 * 管线阶段计数器。
 *
 * 每次进入某个管线阶段递增对应计数器，用于「白盒透明化」的管线流动可视化。
 */
export function recordPipelineStage(stage: 'scan' | 'init' | 'import' | 'dbRead' | 'merge' | 'xuanjiDelta' | 'xuanjiDegraded'): void {
  incr(`pipeline.${stage}`);
}

/**
 * 管线阶段耗时追踪（cycle-141 第二轮）。
 *
 * 计数器只回答「多少次」，不回答「多久」。管线流动可视化需要**两者**：
 *   - 计数：数据流过这个阶段多少次
 *   - 耗时：每次流过花了多少时间
 *
 * 本模块用两个 Map 分别追踪：
 *   - `pipelineDurations`：每个阶段的耗时样本（最近 100 条）
 *   - `pipelineTimingKeys`：每个阶段的计时键名
 *
 * 与 `recordPipelineStage` 配合使用：调用方在进入阶段时调用
 * `startPipelineTiming(stage)`，离开时调用 `endPipelineTiming(stage)`。
 * 这两个函数**必须配对**——漏调 end 会让计时器永久挂起（stale timer）。
 */

/** 每个阶段保留的最近耗时样本数。 */
const PIPELINE_SAMPLE_LIMIT = 100;

/** 阶段 → 耗时样本数组（最近 100 条）。 */
const pipelineDurations = new Map<string, number[]>();

/** 阶段 → 正在计时的起始时间栈（支持同阶段嵌套）。 */
const pipelinePendingMarks = new Map<string, number[]>();

/**
 * 开始计时某个管线阶段。
 *
 * 返回一个 disposer：调用它**只终结这一次调用开启的窗口**，等同于对该窗口调用
 * `endPipelineTiming`。这样调用方可以用 `try/finally` 或 `using` 语法确保计时器
 * 一定被清理。
 *
 * cycle-141 第四轮修复（计时窗口所有权）：此前 disposer 绑定的是**阶段名**——
 * 同阶段嵌套（scan 内再起 scan，例如子图重扫）时，内层先结束、外层的 disposer
 * 会把**内层的起始时间**当成自己的终点（Map.get 取到的是后写者的标记），或者
 * 内层结束把外层要用的标记删掉。现在每对 start/disposer 走独立的栈帧，
 * disposer 只消费自己压入的那一帧。
 */
export function startPipelineTiming(stage: string): () => void {
  const now = Date.now();
  const stack = pipelinePendingMarks.get(stage);
  if (stack) stack.push(now);
  else pipelinePendingMarks.set(stage, [now]);
  return () => endPipelineTiming(stage);
}

/**
 * 结束计时某个管线阶段**最近一次开启**的窗口，记录耗时。
 *
 * 返回耗时（毫秒）；该阶段没有任何挂起窗口时返回 null。
 * 与 `startPipelineTiming` 是 LIFO 配对：后开始的先结束（栈语义）。
 */
export function endPipelineTiming(stage: string): number | null {
  const stack = pipelinePendingMarks.get(stage);
  if (!stack || stack.length === 0) return null;
  const start = stack.pop()!;
  if (stack.length === 0) pipelinePendingMarks.delete(stage);
  const durationMs = Date.now() - start;
  let samples = pipelineDurations.get(stage);
  if (!samples) {
    samples = [];
    pipelineDurations.set(stage, samples);
  }
  samples.push(durationMs);
  if (samples.length > PIPELINE_SAMPLE_LIMIT) samples.shift();
  return durationMs;
}

/**
 * 获取某个管线阶段的耗时统计。
 *
 * 返回 `{ count, avgMs, maxMs, minMs, lastMs, samples }`——
 * `samples` 是最近 100 条样本的数组（用于可视化）。
 */
export function getPipelineTiming(stage: string): {
  count: number;
  avgMs: number;
  maxMs: number;
  minMs: number;
  lastMs: number;
  samples: number[];
} {
  const samples = pipelineDurations.get(stage) ?? [];
  if (samples.length === 0) {
    return { count: 0, avgMs: 0, maxMs: 0, minMs: 0, lastMs: 0, samples: [] };
  }
  const sum = samples.reduce((a, b) => a + b, 0);
  const avgMs = sum / samples.length;
  let maxMs = 0;
  let minMs = Infinity;
  for (const s of samples) {
    if (s > maxMs) maxMs = s;
    if (s < minMs) minMs = s;
  }
  return {
    count: samples.length,
    avgMs,
    maxMs,
    minMs,
    lastMs: samples[samples.length - 1]!,
    samples: [...samples],
  };
}

/**
 * 获取所有管线阶段的耗时统计。
 *
 * 返回 `Record<stage, timing>`——供面板一次性渲染全部阶段。
 */
export function getAllPipelineTiming(): Record<string, ReturnType<typeof getPipelineTiming>> {
  const out: Record<string, ReturnType<typeof getPipelineTiming>> = {};
  for (const stage of pipelineDurations.keys()) {
    out[stage] = getPipelineTiming(stage);
  }
  return out;
}

/**
 * 管线阶段名的有序列表（用于面板渲染顺序）。
 *
 * 按数据流方向排列：scan → import → dbRead → merge → xuanjiDelta。
 */
export const PIPELINE_ORDER = [
  'scan',
  'init',
  'import',
  'dbRead',
  'merge',
  'xuanjiDelta',
  'xuanjiDegraded',
] as const;

/**
 * 指标计算耗时记录器。
 *
 * `manage/metrics` 路由已经计算 `computeMs` 并返回给客户端，但这只出现在
 * 单次响应里。把耗时也记入 observability 模块，面板就能展示「最近 N 次
 * 指标计算的平均耗时」——这才是白盒透明化该有的样子。
 *
 * 用 `pipeline.metricsCompute` 键记录累计耗时（毫秒），面板可据此算平均。
 */
export function recordMetricsCompute(durationMs: number): void {
  incr('pipeline.metricsCompute', durationMs);
  // 也递增一次计数，让面板知道「计算了多少次」
  incr('pipeline.metricsCompute.count');
}

/**
 * 管线阶段中文名（用于面板显示）。
 *
 * 放在 observability 模块而不是 i18n，因为这是**技术术语**而非用户界面文本——
 * 管线阶段名是开发者/运维看的内部指标，不需要国际化。
 */
export const PIPELINE_STAGE_LABELS: Record<string, string> = {
  scan: '扫描',
  init: '初始化',
  import: '导入',
  dbRead: '数据库读取',
  merge: '三源合并',
  xuanjiDelta: '璇玑增量',
  xuanjiDegraded: '璇玑降级',
};
