/**
 * PathIndex 单测：桶结构 / hash 去重 / 惰性失效 / 抽样 / 清理 / O(1) 计数。
 *
 * 索引本身不解释语义，所以这里用 makeEntry 直接造条目，不经过枚举器。
 */

import { describe, expect, it } from 'vitest';
import type { NodeId } from '../../../src/xuanji/core/graph-space.ts';
import { makeEntry, type PathEntry } from '../../../src/xuanji/core/path-entry.ts';
import type { NormalizeStrategy, PathRule } from '../../../src/xuanji/core/path-rule.ts';
import { PathIndex, reviveEntry } from '../../../src/xuanji/index/path-index.ts';

function rule(overrides: Partial<PathRule> = {}): PathRule {
  return {
    name: 'index-test',
    version: 1,
    start: () => true,
    edgeTypes: new Set(['call']),
    lMin: 1,
    lMax: 4,
    normalize: 'none',
    ...overrides,
  };
}

function entry(r: PathRule, nodes: readonly NodeId[], version = 1): PathEntry {
  return makeEntry(r, nodes, version);
}

function findEntry(index: PathIndex, nodes: readonly NodeId[], r: PathRule = rule()): PathEntry | undefined {
  return index.hashIndex.get(makeEntry(r, nodes, 0).hash);
}

describe('PathIndex 桶结构', () => {
  it('按起点 / 终点 / 边数入桶', () => {
    const r = rule();
    const index = new PathIndex();
    const e = entry(r, ['a', 'b', 'c']);

    expect(index.add(e)).toBe(true);
    expect(index.getStartBuckets('a').get(2)).toEqual([e]);
    expect(index.getEndBuckets('c').get(2)).toEqual([e]);
    expect(index.getStartBuckets('a').size).toBe(1);
    expect(index.counters.total).toBe(1);
    expect(index.liveCount()).toBe(1);
  });

  it('edgeToPaths 逐边对登记（不含类型），多条路径共享同一键', () => {
    const r = rule();
    const index = new PathIndex();
    const short = entry(r, ['a', 'b']);
    const long = entry(r, ['a', 'b', 'c']);
    index.add(short);
    index.add(long);

    expect([...(index.edgeToPaths.get('a->b') ?? [])].sort()).toEqual([short.hash, long.hash].sort());
    expect(index.edgeToPaths.get('b->c')?.size).toBe(1);
    expect(index.edgeToPaths.get('b->a')).toBeUndefined();
  });

  it('零长度条目（单节点）进 0 号桶且不登记边对', () => {
    const r = rule({ lMin: 0 });
    const index = new PathIndex();
    const single = entry(r, ['a']);

    expect(index.add(single)).toBe(true);
    expect(index.getStartBuckets('a').get(0)).toEqual([single]);
    expect(index.getEndBuckets('a').get(0)).toEqual([single]);
    expect(index.edgeToPaths.size).toBe(0);
  });

  it('空节点序列被拒绝（无法确定起点/终点）', () => {
    const r = rule({ lMin: 0 });
    const index = new PathIndex();

    expect(index.add(entry(r, []))).toBe(false);
    expect(index.counters.total).toBe(0);
    expect(index.hashIndex.size).toBe(0);
  });

  it('未知节点的桶查询返回空 Map，不创建桶', () => {
    const index = new PathIndex();

    expect(index.getStartBuckets('ghost').size).toBe(0);
    expect(index.getEndBuckets('ghost').size).toBe(0);
    expect(index.startIndex.size).toBe(0);
    expect(index.endIndex.size).toBe(0);
  });
});

describe('PathIndex hash 去重', () => {
  it('同路径重复 add 返回 false 且不重复入桶、不重复计数', () => {
    const r = rule();
    const index = new PathIndex();

    expect(index.add(entry(r, ['a', 'b']))).toBe(true);
    expect(index.add(entry(r, ['a', 'b']))).toBe(false);
    expect(index.getStartBuckets('a').get(1)?.length).toBe(1);
    expect(index.hashIndex.size).toBe(1);
    expect(index.counters.total).toBe(1);
  });

  it('canonical 规范化下同一循环等价类只入桶一次', () => {
    const r = rule({ normalize: 'canonical' });
    const index = new PathIndex();
    const first = entry(r, ['a', 'b', 'a']);
    const rotated = entry(r, ['a', 'a', 'b']);

    expect(first.hash).toBe(rotated.hash);
    expect(index.add(first)).toBe(true);
    expect(index.add(rotated)).toBe(false);
    expect(index.counters.total).toBe(1);
  });

  it('reverse 规范化下正反序同 hash', () => {
    const r = rule({ normalize: 'reverse' as NormalizeStrategy });
    const index = new PathIndex();

    expect(entry(r, ['a', 'b']).hash).toBe(entry(r, ['b', 'a']).hash);
    expect(index.add(entry(r, ['a', 'b']))).toBe(true);
    expect(index.add(entry(r, ['b', 'a']))).toBe(false);
  });
});

describe('PathIndex 查询只返回 live', () => {
  it('queryByStart 按边数升序且排除 stale', () => {
    const r = rule();
    const index = new PathIndex();
    index.add(entry(r, ['a', 'b', 'c']));
    index.add(entry(r, ['a', 'b']));
    index.add(entry(r, ['a', 'x']));
    index.markStale('a->b');

    const live = index.queryByStart('a');
    expect(live.map((e) => e.nodes)).toEqual([['a', 'x']]);
  });

  it('queryByEnd 按边数升序且排除 stale', () => {
    const r = rule();
    const index = new PathIndex();
    index.add(entry(r, ['a', 'c']));
    index.add(entry(r, ['b', 'c']));
    index.add(entry(r, ['a', 'b', 'c']));
    index.markStale('a->b');

    const live = index.queryByEnd('c');
    expect(live.map((e) => e.nodes)).toEqual([
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });

  it('未知起点的 queryByStart / queryByEnd 返回空数组', () => {
    const index = new PathIndex();
    index.add(entry(rule(), ['a', 'b']));

    expect(index.queryByStart('zzz')).toEqual([]);
    expect(index.queryByEnd('zzz')).toEqual([]);
  });
});

describe('PathIndex 惰性失效', () => {
  it('markStale 只命中经过该边对的条目并返回新置条数', () => {
    const r = rule();
    const index = new PathIndex();
    index.add(entry(r, ['a', 'b']));
    index.add(entry(r, ['b', 'c']));
    index.add(entry(r, ['a', 'b', 'c']));

    expect(index.markStale('a->b')).toBe(2);
    expect(findEntry(index, ['a', 'b'])?.stale).toBe(true);
    expect(findEntry(index, ['a', 'b', 'c'])?.stale).toBe(true);
    expect(findEntry(index, ['b', 'c'])?.stale).toBe(false);
    expect(index.counters.stale).toBe(2);
    expect(index.liveCount()).toBe(1);
  });

  it('markStale 幂等：重复调用返回 0，计数不重复累加', () => {
    const r = rule();
    const index = new PathIndex();
    index.add(entry(r, ['a', 'b']));

    expect(index.markStale('a->b')).toBe(1);
    expect(index.markStale('a->b')).toBe(0);
    expect(index.counters.stale).toBe(1);
    expect(index.markStale('nope->nope')).toBe(0);
  });

  it('markStaleForNodes 同时覆盖起点与终点，同一条目只计一次', () => {
    const r = rule({ lMin: 0 });
    const index = new PathIndex();
    index.add(entry(r, ['a', 'b']));
    index.add(entry(r, ['c', 'a']));
    index.add(entry(r, ['a'])); // 起点=终点=a，两个桶各一次
    index.add(entry(r, ['b', 'c']));

    expect(index.markStaleForNodes(['a'])).toBe(3);
    expect(index.counters.stale).toBe(3);
    expect(findEntry(index, ['b', 'c'])?.stale).toBe(false);
    expect(index.markStaleForNodes(['a'])).toBe(0);
  });

  it('liveCount 等于 total - stale', () => {
    const r = rule();
    const index = new PathIndex();
    for (let i = 0; i < 5; i++) index.add(entry(r, ['a', 'n' + i]));
    index.markStale('a->n0');
    index.markStale('a->n1');

    expect(index.counters.total).toBe(5);
    expect(index.counters.stale).toBe(2);
    expect(index.liveCount()).toBe(3);
  });
});

describe('PathIndex sample / clear / revive', () => {
  it('sample 只取 live 条目并遵守上限', () => {
    const r = rule();
    const index = new PathIndex();
    for (let i = 0; i < 5; i++) index.add(entry(r, ['a', 'n' + i]));
    index.markStale('a->n0');
    index.markStale('a->n2');

    expect(index.sample(0)).toEqual([]);
    expect(index.sample(2).length).toBe(2);
    expect(index.sample(10).length).toBe(3);
    expect(index.sample(10).every((e) => !e.stale)).toBe(true);
  });

  it('clear 清空全部结构并重置计数', () => {
    const r = rule();
    const index = new PathIndex();
    index.add(entry(r, ['a', 'b']));
    index.markStale('a->b');
    index.clear();

    expect(index.hashIndex.size).toBe(0);
    expect(index.edgeToPaths.size).toBe(0);
    expect(index.startIndex.size).toBe(0);
    expect(index.endIndex.size).toBe(0);
    expect(index.counters).toEqual({ total: 0, stale: 0 });
    expect(index.liveCount()).toBe(0);
  });

  it('reviveEntry 把仍合法的 stale 条目恢复为 live（幂等）', () => {
    const r = rule();
    const index = new PathIndex();
    const e = entry(r, ['a', 'b']);
    index.add(e);
    index.markStale('a->b');

    expect(reviveEntry(index, e)).toBe(true);
    expect(e.stale).toBe(false);
    expect(index.counters.stale).toBe(0);
    expect(index.liveCount()).toBe(1);
    expect(reviveEntry(index, e)).toBe(false);
  });

  it('reviveEntry 拒绝恢复未入桶的条目（防止绕过 hashIndex 造假 live）', () => {
    const r = rule();
    const index = new PathIndex();
    const indexed = entry(r, ['a', 'b']);
    index.add(indexed);
    index.markStale('a->b');
    const copy = entry(r, ['a', 'b']);

    expect(reviveEntry(index, copy)).toBe(false);
    expect(indexed.stale).toBe(true);
  });
});

/**
 * XJ-06：I5 抽样偏差。
 *
 * 旧实现 `sample(n)` 按 `hashIndex` 的**插入序**取前 n 条，于是条目数超过 n 之后
 * 「新插入的条目永不入样」——而 I5 要抓的恰恰是新写入的坏条目（版本高于图版本、
 * 边已删）。这里把新契约钉死：**均匀铺满 + 必含尾部**，并且顺序确定。
 */
describe('XJ-06 I5 抽样：均匀铺满 + 必含尾部', () => {
  /** 造 n 条互不相同的条目（节点 id 带序号，hash 必不同）。 */
  function fill(index: PathIndex, r: PathRule, n: number, staleEvery = 0): PathEntry[] {
    const made: PathEntry[] = [];
    for (let i = 0; i < n; i++) {
      const e = entry(r, ['a', 'n' + String(i).padStart(4, '0')]);
      index.add(e);
      made.push(e);
      if (staleEvery > 0 && (i + 1) % staleEvery === 0) index.markStale('a->n' + String(i).padStart(4, '0'));
    }
    return made;
  }

  it('200 条里 sample(10)：恰好 10 条、含首条与**最后插入**那条（引用相等）', () => {
    const r = rule();
    const index = new PathIndex();
    const made = fill(index, r, 200);

    const sampled = index.sample(10);
    expect(sampled).toHaveLength(10);
    // 首条入样：均匀抽样的第一个采样点就是 0 号。
    expect(sampled).toContain(made[0]);
    // 尾部必含：旧实现（前 N 条）在这一条上必红——这是本项的红灯断言。
    expect(sampled).toContain(made[199]);
  });

  it('均匀铺满：采样下标严格递增且覆盖整个区间（不是前 10 条）', () => {
    const r = rule();
    const index = new PathIndex();
    const made = fill(index, r, 200);
    const order = new Map<PathEntry, number>(made.map((e, i) => [e, i]));

    const positions = index.sample(10).map((e) => order.get(e)!);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
    // 覆盖到中段与尾段：只取前 n 条的实现，最大值会是 9 而不是 199。
    expect(positions[0]).toBe(0);
    expect(positions[positions.length - 1]).toBe(199);
    expect(positions.some((p) => p > 100)).toBe(true);
  });

  it('尾部配额取的是「最新插入的 live 条目」：末尾置 stale 时补上一条', () => {
    const r = rule();
    const index = new PathIndex();
    const made = fill(index, r, 200);
    index.markStale('a->n0199');

    const sampled = index.sample(10);
    expect(sampled).toHaveLength(10);
    expect(sampled).not.toContain(made[199]);
    expect(sampled).toContain(made[198]);
  });

  it('条目数 ≤ n 时返回全部 live（且是副本：调用方改数组不影响索引）', () => {
    const r = rule();
    const index = new PathIndex();
    const made = fill(index, r, 3);

    const sampled = index.sample(10);
    expect(sampled).toHaveLength(3);
    expect(sampled).toEqual(made);
    sampled.length = 0;
    expect(index.sample(10)).toHaveLength(3);
  });

  it('sample(0) 返回空、sample(Infinity) 返回全部 live', () => {
    const r = rule();
    const index = new PathIndex();
    fill(index, r, 20);

    expect(index.sample(0)).toEqual([]);
    expect(index.sample(Number.POSITIVE_INFINITY)).toHaveLength(20);
  });
});

/**
 * XJ-09：长度分桶契约。
 *
 * 契约是**分桶只服务查询**（`queryByStart` / `queryByEnd` 的边数升序返回），
 * 增量引擎已改为 DFS 方案（见 `incremental.ts` 模块头与设计方案 §12.2），
 * 不再依赖「前缀桶 × 新边 × 后缀桶」的配对。这条契约以前只写在注释里，
 * 所以「桶序」这个唯一可观测行为没有任何用例——排序被删也不会红。
 */
describe('XJ-09 长度分桶契约：只服务查询，桶序确定', () => {
  it('按 3、1、2 顺序插入 ⇒ queryByStart 仍按边数升序返回 [1,2,3]', () => {
    const r = rule();
    const index = new PathIndex();
    index.add(entry(r, ['s', 'x1', 'x2', 'x3'])); // 3 边
    index.add(entry(r, ['s', 'y1'])); // 1 边
    index.add(entry(r, ['s', 'z1', 'z2'])); // 2 边

    expect(index.queryByStart('s').map((e) => e.nodes.length - 1)).toEqual([1, 2, 3]);
  });

  it('终点桶同契约：queryByEnd 也按边数升序', () => {
    const r = rule();
    const index = new PathIndex();
    index.add(entry(r, ['p3', 'x', 'y', 'end'])); // 3 边
    index.add(entry(r, ['p1', 'end'])); // 1 边
    index.add(entry(r, ['p2', 'z', 'end'])); // 2 边

    expect(index.queryByEnd('end').map((e) => e.nodes.length - 1)).toEqual([1, 2, 3]);
  });

  it('桶键就是边数（nodes.length - 1），零长度条目入 0 号桶', () => {
    const r = rule({ lMin: 0 });
    const index = new PathIndex();
    index.add(entry(r, ['s']));
    index.add(entry(r, ['s', 'a']));

    expect([...index.getStartBuckets('s').keys()].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(index.queryByStart('s').map((e) => e.nodes.length - 1)).toEqual([0, 1]);
  });
});
