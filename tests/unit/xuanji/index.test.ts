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
