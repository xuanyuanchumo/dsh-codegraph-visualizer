/**
 * graphMetrics 共享类型（cycle-141 拆分）。
 *
 * 原 graphMetrics.ts 因新增 8 项图论指标后复杂度 score 132 > upperBand 115，
 * 成为全仓 #1 复杂度热点。按「一域一文件、单文件 ≤~250 行」的模块化纪律拆分：
 * 本文件只放跨模块共享的类型，不含任何逻辑。
 *
 * 库边界自包含约束：所有 import 必须留在 `src/xuanji` 内。
 */

/** 最小节点类型——只含图指标需要的字段。 */
export interface MetricNode {
  id: string;
  label?: string;
  type?: string;
  filePath?: string;
  lineNumber?: number;
  properties?: Record<string, unknown>;
}

/** 最小边类型——只含图指标需要的字段。 */
export interface MetricEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  properties?: Record<string, unknown>;
}

/**
 * 邻接表：节点 id → 邻居 id 集合。
 *
 * - `out`：有向出边（call/import 的方向）
 * - `in`：有向入边
 * - `all`：无向投影（两端各记一次，用于 Brandes / WCC / 聚类等无向算法）
 */
export interface AdjacencyList {
  out: Map<string, Set<string>>;
  in: Map<string, Set<string>>;
  all: Map<string, Set<string>>;
}
