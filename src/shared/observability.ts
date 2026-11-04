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

/** 读取单个计数器值（不存在返回 0）。 */
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
 * 清零全部计数器（测试用）。
 *
 * 注意：这**不**重置 PerformanceMonitor 的阈值表（那是另一个模块的职责）。
 * 调用方如果需要完整重置，必须同时调用 `clearMeasurements()` 与 `resetThresholds()`。
 */
export function reset(): void {
  counters.clear();
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
