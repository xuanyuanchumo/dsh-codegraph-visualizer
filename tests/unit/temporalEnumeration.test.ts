/**
 * `sliceGraphForTemporal` 的单元测试（cycle-137 / 研究方案 §4 的 𝒯 维）。
 *
 * ## 它守的是什么
 *
 * ρ 的 commit 切片把 `𝒯` 维度接进路径枚举。核心契约：
 *
 * 1. **未提供 commitLog ⇒ 原图 + `temporal: null`**：行为与既有 ρ 调用逐字节一致，
 *    不引入任何回归面。
 * 2. **提供了但切片不可用 ⇒ 原图 + `temporal.available: false` + 原因**：
 *    不拿原图冒充切片（研究方案 §4：没有 𝒯 就没有时序切片）。
 * 3. **切片可用 ⇒ 返回切片图 + 完整元信息**：区间、切片数、是否截断都必须如实。
 *
 * ## 夹具为什么用「三个文件 + 两个 commit」
 *
 * commit1 触及 a.ts、commit2 触及 b.ts、c.ts 不被任何 commit 触及。
 * 于是：
 * - 全区间 ⇒ {a,b}（c 被排除）——证明切片真的在过滤；
 * - `from=commit2` ⇒ {b}——证明 from 是**区间下界**（含）；
 * - `to=commit1` ⇒ {a}——证明 to 是**区间上界**（含）。
 */
import { describe, it, expect } from 'vitest';
import { sliceGraphForTemporal, filterEdgesByTemporalPredicate } from '../../src/shared/analysis/temporalEnumeration.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';

/** commit1 触及 a.ts、commit2 触及 b.ts（时间戳为 unix 秒）。
 *  分段用 `\x1e`，段首行是 `hash\x1f<unix秒>`——与 `git log --format=%x1e%H%x1f%ct` 同形。 */
const COMMIT_LOG = 'abc1234\x1f1000\na.ts\n\x1edef5678\x1f2000\nb.ts\n';

function makeGraph() {
  return makeGraphData(
    [
      makeNode('file:a.ts', 'a.ts', 'module', 'a.ts', 1),
      makeNode('file:b.ts', 'b.ts', 'module', 'b.ts', 1),
      makeNode('file:c.ts', 'c.ts', 'module', 'c.ts', 1),
    ],
    [
      makeEdge('e-ab', 'file:a.ts', 'file:b.ts', 'dependency'),
      makeEdge('e-bc', 'file:b.ts', 'file:c.ts', 'dependency'),
    ],
    'repo-1',
    1000,
  );
}

describe('sliceGraphForTemporal', () => {
  it('未提供 commitLog ⇒ 原图 + temporal: null（行为不变）', () => {
    const graph = makeGraph();
    const outcome = sliceGraphForTemporal(graph, {});
    expect(outcome.temporal).toBeNull();
    expect(outcome.data.nodes).toHaveLength(3);
    expect(outcome.data.edges).toHaveLength(2);
  });

  it('空串 commitLog ⇒ 同样视为未提供', () => {
    const graph = makeGraph();
    const outcome = sliceGraphForTemporal(graph, { commitLog: '   ' });
    expect(outcome.temporal).toBeNull();
    expect(outcome.data.nodes).toHaveLength(3);
  });

  it('全区间 ⇒ 只保留被 commit 触及的文件（c.ts 被排除）', () => {
    const graph = makeGraph();
    const outcome = sliceGraphForTemporal(graph, { commitLog: COMMIT_LOG });
    expect(outcome.temporal).not.toBeNull();
    expect(outcome.temporal!.available).toBe(true);
    expect(outcome.temporal!.sliceCount).toBe(2);
    expect(outcome.temporal!.from).toBe('abc1234');
    expect(outcome.temporal!.to).toBe('def5678');
    const ids = outcome.data.nodes.map((n) => String(n.id)).sort();
    expect(ids).toEqual(['file:a.ts', 'file:b.ts']);
    // 边两端都保留才保留；a→b 保留，b→c 因 c 被排除而不保留。
    expect(outcome.data.edges.map((e) => String(e.id))).toEqual(['e-ab']);
  });

  it('from=commit2 ⇒ 只保留 commit2 及之后（含），即 {b.ts}', () => {
    const graph = makeGraph();
    const outcome = sliceGraphForTemporal(graph, { commitLog: COMMIT_LOG, from: 'def5678' });
    expect(outcome.temporal!.available).toBe(true);
    expect(outcome.temporal!.sliceCount).toBe(1);
    expect(outcome.data.nodes.map((n) => String(n.id))).toEqual(['file:b.ts']);
    expect(outcome.data.edges).toHaveLength(0);
  });

  it('to=commit1 ⇒ 只保留到 commit1（含），即 {a.ts}', () => {
    const graph = makeGraph();
    const outcome = sliceGraphForTemporal(graph, { commitLog: COMMIT_LOG, to: 'abc1234' });
    expect(outcome.temporal!.available).toBe(true);
    expect(outcome.data.nodes.map((n) => String(n.id))).toEqual(['file:a.ts']);
  });

  it('from 未命中 ⇒ 空切片（区间内没有提交），不拿原图冒充', () => {
    const graph = makeGraph();
    const outcome = sliceGraphForTemporal(graph, { commitLog: COMMIT_LOG, from: 'nonexistent' });
    expect(outcome.temporal!.requested).toBe(true);
    // 区间未命中 ⇒ 切片可用但为空（commitSliceGraph 的既有语义：0 切片不是「不可用」）。
    expect(outcome.temporal!.available).toBe(true);
    expect(outcome.temporal!.sliceCount).toBe(0);
    expect(outcome.temporal!.reason).toContain('区间内没有提交');
    expect(outcome.data.nodes).toHaveLength(0);
  });

  it('commitLog 为空历史 ⇒ available:false（历史为空）', () => {
    const graph = makeGraph();
    const outcome = sliceGraphForTemporal(graph, { commitLog: '\x1e\x1e' });
    expect(outcome.temporal!.requested).toBe(true);
    expect(outcome.temporal!.available).toBe(false);
    expect(outcome.temporal!.reason).toContain('commit 历史为空');
  });

  it('切片可用但图为空 ⇒ 仍如实返回 available:true + 空图', () => {
    // 一个 commit 触及了不存在的文件 ⇒ 切片可用但 0 节点。
    const graph = makeGraph();
    const outcome = sliceGraphForTemporal(graph, { commitLog: 'abc1234\x1f1000\nnonexistent.ts\n' });
    expect(outcome.temporal!.available).toBe(true);
    expect(outcome.temporal!.sliceCount).toBe(1);
    expect(outcome.data.nodes).toHaveLength(0);
  });
});

// ── cycle-138：边级时序谓词（filterEdgesByTemporalPredicate） ──────────────

describe('filterEdgesByTemporalPredicate', () => {
  it('未提供 commitLog ⇒ 原图 + meta: null（行为不变）', () => {
    const graph = makeGraph();
    const outcome = filterEdgesByTemporalPredicate(graph, { since: 500 });
    expect(outcome.meta).toBeNull();
    expect(outcome.data.edges).toHaveLength(2);
  });

  it('有 commitLog 但无谓词参数 ⇒ 原图 + meta: null（不做事）', () => {
    const graph = makeGraph();
    const outcome = filterEdgesByTemporalPredicate(graph, { commitLog: COMMIT_LOG });
    expect(outcome.meta).toBeNull();
    expect(outcome.data.edges).toHaveLength(2);
  });

  it('挥发度谓词被显式拒绝（当前数据面只有文件级事实）', () => {
    const graph = makeGraph();
    const outcome = filterEdgesByTemporalPredicate(graph, { commitLog: COMMIT_LOG, minVolatility: 0.5 });
    expect(outcome.meta).not.toBeNull();
    expect(outcome.meta!.requested).toBe(true);
    expect(outcome.meta!.available).toBe(false);
    expect(outcome.meta!.reason).toContain('挥发度');
    // 原图原样返回——过滤函数不负责清空，工具层按 meta 分流。
    expect(outcome.data.edges).toHaveLength(2);
  });

  it('maxVolatility 同样被显式拒绝', () => {
    const graph = makeGraph();
    const outcome = filterEdgesByTemporalPredicate(graph, { commitLog: COMMIT_LOG, maxVolatility: 1 });
    expect(outcome.meta!.available).toBe(false);
  });

  it('无共同触及 ⇒ 0 事实，全部边被移除（不知道 ≠ 符合）', () => {
    // a.ts 与 b.ts 从未被**同一**提交同时触及 ⇒ e-ab 无事实。
    const graph = makeGraph();
    const outcome = filterEdgesByTemporalPredicate(graph, { commitLog: COMMIT_LOG, since: 0 });
    expect(outcome.meta!.available).toBe(true);
    expect(outcome.meta!.factCount).toBe(0);
    expect(outcome.meta!.kept).toBe(0);
    expect(outcome.meta!.filtered).toBe(2);
    expect(outcome.data.edges).toHaveLength(0);
  });

  it('共同触及的边按首次时刻过滤，无事实的边被移除', () => {
    // 一个提交同时触及 a.ts 与 b.ts ⇒ e-ab 有事实，firstSeenAt = 3_000_000ms。
    const log = 'abc1234\x1f3000\na.ts\nb.ts\n';
    const graph = makeGraph();
    const outcome = filterEdgesByTemporalPredicate(graph, { commitLog: log, since: 2_000_000 });
    expect(outcome.meta!.available).toBe(true);
    expect(outcome.meta!.factCount).toBe(1);
    expect(outcome.meta!.kept).toBe(1);
    expect(outcome.meta!.filtered).toBe(1);
    expect(outcome.data.edges.map((e) => String(e.id))).toEqual(['e-ab']);
  });

  it('since 边界：恰等于首次时刻的边保留（≥ 语义，与 temporalPredicate 一致）', () => {
    const log = 'abc1234\x1f3000\na.ts\nb.ts\n';
    const graph = makeGraph();
    const kept = filterEdgesByTemporalPredicate(graph, { commitLog: log, since: 3_000_000 });
    expect(kept.meta!.kept).toBe(1);
    const dropped = filterEdgesByTemporalPredicate(graph, { commitLog: log, since: 3_000_001 });
    expect(dropped.meta!.kept).toBe(0);
  });

  it('边事实是双向的：反向边也能查到事实', () => {
    const log = 'abc1234\x1f3000\na.ts\nb.ts\n';
    const graph = makeGraph();
    const flipped = makeGraphData(
      [
        makeNode('file:a.ts', 'a.ts', 'module', 'a.ts', 1),
        makeNode('file:b.ts', 'b.ts', 'module', 'b.ts', 1),
        makeNode('file:c.ts', 'c.ts', 'module', 'c.ts', 1),
      ],
      [makeEdge('e-ba', 'file:b.ts', 'file:a.ts', 'dependency')],
      'repo-1',
      1000,
    );
    const forward = filterEdgesByTemporalPredicate(graph, { commitLog: log, since: 0 });
    const backward = filterEdgesByTemporalPredicate(flipped, { commitLog: log, since: 0 });
    expect(forward.meta!.factCount).toBe(1);
    expect(backward.meta!.factCount).toBe(1);
    expect(backward.meta!.kept).toBe(1);
  });

  it('空历史 ⇒ available:false + 原图保留（工具层据此早退）', () => {
    const graph = makeGraph();
    const outcome = filterEdgesByTemporalPredicate(graph, { commitLog: '\x1e\x1e', since: 0 });
    expect(outcome.meta!.requested).toBe(true);
    expect(outcome.meta!.available).toBe(false);
    expect(outcome.data.edges).toHaveLength(2);
  });

  it('首次时刻取 min：多个共同触及的提交取最早（与遍历顺序无关）', () => {
    // git log 输出新→旧：commit2（ts=5000）在前、commit1（ts=1000）在后。
    // 首次共同触及 = 1000_000ms 而不是「第一条命中的 5000_000」。
    const log = '\x1edef5678\x1f5000\na.ts\nb.ts\n\x1eabc1234\x1f1000\na.ts\nb.ts\n';
    const graph = makeGraph();
    const early = filterEdgesByTemporalPredicate(graph, { commitLog: log, since: 2_000_000 });
    expect(early.meta!.kept).toBe(0); // 首次 = 1000_000 < 2_000_000 ⇒ 移除。
    const late = filterEdgesByTemporalPredicate(graph, { commitLog: log, since: 500_000 });
    expect(late.meta!.kept).toBe(1);
  });
});
