/**
 * xuanji 公共 API 汇总（库的唯一入口）。
 *
 * 璇玑图原型：一方锦缎，十种读法。本文件把「图空间 / 规则 / 条目 / 索引 /
 * 增量 / 查询 / 注册表 / 不变量 / NFA」全部汇聚成一个可独立发布的表面——
 * 宿主只从这里导入，不深入内部模块路径。
 *
 * 注意：hasDirectedCycle / hasCycleInAdjacency 只在 query/query-engine 处导出一次
 * （它本身就是 ops/cycle-existence 的 re-export），避免 star-export 重名冲突。
 *
 * 库边界：本文件只重新导出 src/xuanji 内部模块，不引入任何宿主/第三方依赖。
 *
 * @module xuanji
 */

// core
export * from './core/graph-space.ts';
export * from './core/path-rule.ts';
export * from './core/path-entry.ts';
export * from './core/nfa.ts';

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
