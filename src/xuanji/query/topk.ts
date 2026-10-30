/**
 * Top-K 选择（稳定、非变异）。
 *
 * 璇玑图原型：从成千上万条读法里挑出「最险」或「最工」的十句，
 * 排序必须稳定——同分时保持枚举顺序，结果才可复现（确定性优先于微优化）。
 *
 * 纯函数、零依赖。
 *
 * @module xuanji/query/topk
 */

/**
 * 取分数最高的 k 项。
 *
 * 契约：
 * - `k <= 0` 返回 `[]`（不抛错，退化输入不制造异常）；
 * - `k >= items.length` 返回**副本**（调用方可以安全修改，不污染输入）；
 * - 稳定排序：分数相同时保持原数组顺序（用原下标做次级键，不依赖引擎的 sort 稳定性）；
 * - 不修改输入数组；
 * - 缺省 score 把元素本身当作数值（元素不是 number 时视为 0，NON_NUMERIC 语义见下）。
 *
 * @param items 候选集合（只读，不会被排序或修改）
 * @param k 取前 k 项
 * @param score 评分函数，**分数越大越靠前**；缺省用元素自身的数值
 */
export function topK<T>(items: readonly T[], k: number, score?: (item: T) => number): T[] {
  if (!(k > 0) || items.length === 0) return [];

  const scoreOf = score ?? ((item: T) => (typeof item === 'number' && Number.isFinite(item) ? item : 0));

  // cycle-119 修复：`k >= items.length` 曾在此**提前返回插入序**——但「取前 k 项」的语义
  // 包含顺序（分数越大越靠前），k 覆盖全量时顺序照样影响消费方：top-k-weight 把
  // `maxPaths = cursor + pageSize + 1` 传进来，k==候选数 时 ranked[0] 会是 DFS 首条而不是
  // 最高权重条（实测：菱形图 1+1 vs 5+5，topk 结果 = dfs 结果，透传参数完全失效）。
  // 修复 = 删短路，让 k==len 也走统一排序路径（仍返回新数组，不改输入；
  // 「副本不是同一引用」的既有契约不变，只是副本的**顺序**现在由 score 决定）。

  // 装饰-排序-还原：显式携带原下标，稳定性不依赖 Array.prototype.sort 的实现细节。
  const decorated: Array<{ item: T; score: number; index: number }> = items.map((item, index) => ({
    item,
    score: scoreOf(item),
    index,
  }));

  decorated.sort((a, b) => {
    if (a.score > b.score) return -1;
    if (a.score < b.score) return 1;
    return a.index - b.index;
  });

  const result: T[] = [];
  // 上界取 min(k, decorated.length)：k > 候选数时全部返回（修复前 k>len 走短路分支，
  // 删短路后若仍循环到 k 会读 undefined——`?.item` 掩盖成 push undefined 的更糟形态）。
  const take = Math.min(k, decorated.length);
  for (let i = 0; i < take; i++) result.push(decorated[i]!.item);
  return result;
}
