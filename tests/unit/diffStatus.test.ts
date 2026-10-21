// 旅程覆盖：J19（FR-24 版本对比——基线/目标引用的 diff 三态索引纯函数层）。
/**
 * `src/shared/diffStatus.ts` 的单元测试（cycle-104，研究报告 §六 #13）。
 *
 * 这一层是纯函数，测试必须覆盖**每一个会让用户看到错数字的分支**：
 *   - 非法状态值不能静默变成「没有变更」（要进 unclassified 计数）；
 *   - 节点与边的同 id 不能合并（否则会标错对象）；
 *   - `missing` 必须如实报出（diff 里有、当前视图没渲染的差额）。
 */
import { describe, it, expect } from 'vitest';
import {
  DIFF_STATUSES, DIFF_STATUS_CLASS, DIFF_STATUS_CLASSES,
  asDiffStatus, readDiffStatus, emptyDiffIndex, buildDiffIndex,
  summarizeDiff, isDiffEmpty,
  type DiffIndex, type DiffTagged,
} from '../../src/shared/diffStatus.ts';

function tagged(id: string, status?: unknown): DiffTagged {
  return status === undefined
    ? { id }
    : { id, properties: { diffStatus: status } };
}

describe('DIFF_STATUSES / DIFF_STATUS_CLASS', () => {
  it('has exactly the three statuses the host DiffEngine writes', () => {
    // 宿主 `src/merger/DiffEngine.ts:102-119` 只写这三个值。任何一侧增减都必须同步，
    // 否则新增状态在客户端会被 `asDiffStatus` 判为非法并静默丢弃。
    expect([...DIFF_STATUSES]).toEqual(['added', 'modified', 'removed']);
  });

  it('maps every status to a distinct class', () => {
    const classes = DIFF_STATUSES.map((s) => DIFF_STATUS_CLASS[s]);
    expect(new Set(classes).size).toBe(DIFF_STATUSES.length);
    // 类名必须真的以 diff- 开头：样式文件按这个前缀生成选择器，改前缀而不改样式
    // 会让所有标记规则失效且没有任何错误。
    for (const cls of classes) expect(cls.startsWith('diff-')).toBe(true);
  });

  it('DIFF_STATUS_CLASSES covers every status (clearMarkers relies on it)', () => {
    expect([...DIFF_STATUS_CLASSES].sort()).toEqual(DIFF_STATUSES.map((s) => DIFF_STATUS_CLASS[s]).sort());
  });
});

describe('asDiffStatus', () => {
  it('accepts the three legal values', () => {
    for (const s of DIFF_STATUSES) expect(asDiffStatus(s)).toBe(s);
  });

  it('rejects non-strings instead of coercing them', () => {
    // 刻意不做 String(value)：`0`、`true` 强转后都不等于任何合法值，但强转本身
    // 会让「上游传了数字」这件事看起来像正常数据。
    for (const bad of [null, undefined, 0, 1, true, false, {}, []]) {
      expect(asDiffStatus(bad)).toBeNull();
    }
  });

  it('rejects strings that merely look similar', () => {
    for (const bad of ['Added', 'ADDED', 'added ', ' add', 'delete', 'new']) {
      expect(asDiffStatus(bad)).toBeNull();
    }
  });
});

describe('readDiffStatus', () => {
  it('reads a legal value out of properties', () => {
    expect(readDiffStatus(tagged('n1', 'modified'))).toBe('modified');
  });

  it('returns null when properties is absent', () => {
    expect(readDiffStatus({ id: 'n1' })).toBeNull();
  });

  it('returns null when the property is missing', () => {
    expect(readDiffStatus({ id: 'n1', properties: { other: 1 } })).toBeNull();
  });

  it('returns null for an illegal value rather than guessing', () => {
    expect(readDiffStatus(tagged('n1', 'changed'))).toBeNull();
  });
});

describe('buildDiffIndex', () => {
  it('groups nodes and edges by status', () => {
    const index = buildDiffIndex(
      [tagged('a', 'added'), tagged('b', 'modified'), tagged('c', 'removed'), tagged('d', 'added')],
      [tagged('e1', 'added'), tagged('e2', 'removed')],
    );
    expect([...index.nodes.added]).toEqual(['a', 'd']);
    expect([...index.nodes.modified]).toEqual(['b']);
    expect([...index.nodes.removed]).toEqual(['c']);
    expect([...index.edges.added]).toEqual(['e1']);
    expect([...index.edges.removed]).toEqual(['e2']);
    expect(index.edges.modified.size).toBe(0);
  });

  it('keeps node and edge id spaces separate', () => {
    // 同一个 id 同时作为节点与边是可能的（不同命名空间）。合并成一个 Set 会让
    // 「标记节点」时把同 id 的边也标上，反之亦然。
    const index = buildDiffIndex([tagged('x', 'added')], [tagged('x', 'removed')]);
    expect(index.nodes.added.has('x')).toBe(true);
    expect(index.nodes.removed.has('x')).toBe(false);
    expect(index.edges.removed.has('x')).toBe(true);
    expect(index.edges.added.has('x')).toBe(false);
  });

  it('counts unclassified elements instead of silently dropping them', () => {
    // 上游换了词汇表时，若只是「没匹配到就跳过」，用户会看到 0 处变更并以为
    // 两个版本完全相同。unclassified 让调用方能把这件事说出来。
    const index = buildDiffIndex(
      [tagged('a', 'added'), tagged('b'), tagged('c', 'bogus')],
      [tagged('e1')],
    );
    expect(index.unclassified.nodes).toBe(2);
    expect(index.unclassified.edges).toBe(1);
    expect(index.nodes.added.size).toBe(1);
  });

  it('returns empty sets for empty input', () => {
    const index = buildDiffIndex([], []);
    expect(isDiffEmpty(index)).toBe(true);
    expect(index.unclassified).toEqual({ nodes: 0, edges: 0 });
  });
});

describe('summarizeDiff', () => {
  function indexOf(spec: {
    nodes?: Partial<Record<'added' | 'modified' | 'removed', string[]>>;
    edges?: Partial<Record<'added' | 'modified' | 'removed', string[]>>;
  }): DiffIndex {
    const index = emptyDiffIndex();
    for (const s of DIFF_STATUSES) {
      for (const id of spec.nodes?.[s] ?? []) index.nodes[s].add(id);
      for (const id of spec.edges?.[s] ?? []) index.edges[s].add(id);
    }
    return index;
  }

  it('counts every status across nodes and edges', () => {
    const index = indexOf({
      nodes: { added: ['a', 'b'], modified: ['c'] },
      edges: { removed: ['e1'] },
    });
    const stats = summarizeDiff(index, new Set(['a', 'b', 'c']), new Set(['e1']));
    expect(stats.counts).toEqual({ added: 2, modified: 1, removed: 1 });
    expect(stats.marked).toBe(4);
    expect(stats.missing).toBe(0);
  });

  it('reports elements absent from the current view as missing', () => {
    // 用户只展开了部分目录时这是**正常**状态，但必须披露：面板说「共 3 处」而画布只亮 1 处，
    // 不解释的话用户会认为标记丢了。
    const index = indexOf({ nodes: { added: ['a', 'b', 'c'] } });
    const stats = summarizeDiff(index, new Set(['a']), new Set());
    expect(stats.counts.added).toBe(3);
    expect(stats.marked).toBe(1);
    expect(stats.missing).toBe(2);
  });

  it('does not count a node id present only as an edge as marked', () => {
    // 节点 id 与边 id 分账：`presentEdgeIds` 里出现某个 id 不能让它算作「节点已标记」。
    const index = indexOf({ nodes: { added: ['shared'] } });
    const stats = summarizeDiff(index, new Set(), new Set(['shared']));
    expect(stats.marked).toBe(0);
    expect(stats.missing).toBe(1);
  });

  it('returns all zeros for an empty index', () => {
    const stats = summarizeDiff(emptyDiffIndex(), new Set(), new Set());
    expect(stats).toEqual({ counts: { added: 0, modified: 0, removed: 0 }, missing: 0, marked: 0 });
  });
});

describe('isDiffEmpty', () => {
  it('is true only when all three statuses are empty in both spaces', () => {
    const index = emptyDiffIndex();
    expect(isDiffEmpty(index)).toBe(true);
    index.edges.removed.add('e1');
    expect(isDiffEmpty(index)).toBe(false);
  });
});
