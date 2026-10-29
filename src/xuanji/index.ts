/**
 * xuanji 公共 API 汇总（库的唯一入口）。
 *
 * 璇玑图原型：一方锦缎，十种读法。本文件把「图空间 / 规则 / 条目 / 索引 /
 * 增量 / 查询 / 注册表 / 不变量」全部汇聚成一个可独立发布的表面——
 * 宿主只从这里导入，不深入内部模块路径。
 *
 * 注意：hasDirectedCycle / hasCycleInAdjacency 只在 query/query-engine 处导出一次
 * （它本身就是 ops/cycle-existence 的 re-export），避免 star-export 重名冲突。
 *
 * 已移除的模块（cycle-111 / XJ-08）：`core/nfa.ts`。它只有 `states = lMax - lMin + 1`
 * 一个减法，`compileLengthNfa` 全仓 0 生产调用点，而规范 §5.6 想要的「乘积存在性判定」
 * 已由 `existsWalk`（`query/query-engine.ts`）以 O(V·lMax) 覆盖。留一个「只有类型与
 * 常量、没有算法」的模块会让读者以为存在性是 NFA 在做。**不要重新加回来**：
 * `tests/unit/xuanji/publicApi.test.ts` 有两条守卫（负向导出断言 + core 目录清单）
 * 同时把「导出复活」与「文件复活」钉死。
 *
 * 库边界：本文件只重新导出 src/xuanji 内部模块，不引入任何宿主/第三方依赖。
 *
 * @module xuanji
 */

// core
export * from './core/graph-space.ts';
export * from './core/path-rule.ts';
export * from './core/path-entry.ts';

// ops
export * from './ops/booth.ts';
export * from './ops/rolling-hash.ts';
export * from './ops/invariants.ts';
// cycle-existence 的 hasCycleInAdjacency / hasDirectedCycle 经 query-engine 汇总导出

// index
export * from './index/path-index.ts';
export * from './index/incremental.ts';
export * from './index/rebalance.ts';

// query
export * from './query/query-engine.ts';
export * from './query/topk.ts';
export * from './query/keyword-query.ts';

// registry
export * from './registry/rule-registry.ts';
