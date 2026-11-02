/**
 * `src/shared/temporal.ts` 的单元测试（研究方案 §4 的 $\mathcal{T}$ 维）。
 *
 * 全部是**纯函数**用例，不跑 git：
 * ① 解析器认 `\x1e` 分段与 `hash\x1f<ts>` 头部，并兼容旧版只有文件名的 `%x1e`；
 * ② 区间过滤（`days` / `from` / `to`）的边界——找不到目标必须**空 + truncated**，
 *    不能悄悄放宽；
 * ③ `commitSliceGraph` 在缺历史时返回 `available: false`，不编造图；
 * ④ `edgeVolatility` 的分子/分母口径，以及「缺边级事实必须拒绝」这条不变量；
 * ⑤ `temporalPredicate` 的缺失事实语义（不知道 ≠ 符合）。
 */
import { describe, it, expect } from 'vitest';
import {
  commitSliceGraph,
  edgeVolatility,
  filterSlices,
  parseCommitLog,
  temporalPredicate,
  type CommitHistory,
  type CommitSlice,
} from '../../src/shared/temporal.ts';
import type { GraphEdge, GraphNode } from '../../src/types/index.ts';

function node(id: string, filePath: string): GraphNode {
  return { id: id as GraphNode['id'], label: id, type: 'function', filePath, properties: {} };
}

function edge(id: string, source: string, target: string): GraphEdge {
  return { id: id as GraphEdge['id'], source: source as GraphEdge['source'], target: target as GraphEdge['target'], type: 'call', properties: {} };
}

/** 构造一份带边级事实的 commit 历史。 */
function history(slices: CommitSlice[]): CommitHistory {
  return { slices, head: 'head', available: true, error: null };
}

describe('parseCommitLog', () => {
  it('解析增强格式：hash\\x1f<ts> 头部 + 该提交触及的文件', () => {
    const raw = '\x1eaaaa111\x1f1700000000\nsrc/a.ts\nsrc/b.ts\n\x1ebbbb222\x1f1700001000\nsrc/c.ts\n';
    const slices = parseCommitLog(raw);
    expect(slices).toHaveLength(2);
    expect(slices[0]).toMatchObject({ hash: 'aaaa111', timestamp: 1700000000, files: ['src/a.ts', 'src/b.ts'] });
    expect(slices[1]).toMatchObject({ hash: 'bbbb222', timestamp: 1700001000, files: ['src/c.ts'] });
  });

  it('兼容旧版 %x1e：只有文件名时给合成 hash、时间戳 0', () => {
    const raw = '\x1esrc/a.ts\n\x1esrc/b.ts\n';
    const slices = parseCommitLog(raw);
    expect(slices).toHaveLength(2);
    expect(slices[0]?.files).toEqual(['src/a.ts']);
    expect(slices[0]?.timestamp).toBe(0);
    expect(slices[1]?.files).toEqual(['src/b.ts']);
  });

  it('空输入返回空数组（不抛异常）', () => {
    expect(parseCommitLog('')).toEqual([]);
    expect(parseCommitLog(null as unknown as string)).toEqual([]);
  });

  it('CRLF 行尾与重命名行：取新路径', () => {
    const raw = '\x1ecccc333\x1f1700000000\nold/a.ts -> new/a.ts\r\nsrc/b.ts\r\n';
    const slices = parseCommitLog(raw);
    expect(slices[0]?.files).toEqual(['new/a.ts', 'src/b.ts']);
  });
});

describe('filterSlices', () => {
  const slices: CommitSlice[] = [
    { hash: 's1', timestamp: 1_699_000_000, files: ['a'] },
    { hash: 's2', timestamp: 1_700_000_100, files: ['b'] },
    { hash: 's3', timestamp: 1_700_000_200, files: ['c'] },
  ];
  const hist = history(slices);

  it('days 时间窗只保留窗口内的切片', () => {
    // 窗口起点 = now - 5 天 = 1_699_568_200s：s1（1_699_000_000）在窗外，s2/s3 在窗内。
    const result = filterSlices(hist, { days: 5 }, 1_700_000_200_000);
    expect(result.slices.map((s) => s.hash)).toEqual(['s2', 's3']);
    expect(result.truncated).toBe(true);
  });

  it('from/to 都含端点', () => {
    const result = filterSlices(hist, { from: 's1', to: 's2' });
    expect(result.slices.map((s) => s.hash)).toEqual(['s1', 's2']);
    expect(result.truncated).toBe(false);
  });

  it('from 不存在时返回空切片并标记 truncated', () => {
    const result = filterSlices(hist, { from: 'nope' });
    expect(result.slices).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it('to 不存在时同样返回空切片', () => {
    const result = filterSlices(hist, { to: 'nope' });
    expect(result.slices).toEqual([]);
    expect(result.truncated).toBe(true);
  });
});

describe('commitSliceGraph', () => {
  const data = {
    nodes: [node('n1', 'src/a.ts'), node('n2', 'src/b.ts'), node('n3', 'src/c.ts')],
    edges: [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
  };
  const hist = history([
    { hash: 's1', timestamp: 1, files: ['src/a.ts', 'src/b.ts'] },
    { hash: 's2', timestamp: 2, files: ['src/b.ts', 'src/c.ts'] },
  ]);

  it('区间内被触及文件的节点/边都被保留', () => {
    const result = commitSliceGraph(data, {}, hist);
    expect(result.available).toBe(true);
    expect(result.sliceCount).toBe(2);
    expect(result.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(result.edges.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(result.from).toBe('s1');
    expect(result.to).toBe('s2');
  });

  it('from 只保留其后的切片诱导的子图', () => {
    const result = commitSliceGraph(data, { from: 's2' }, hist);
    expect(result.nodes.map((n) => n.id)).toEqual(['n2', 'n3']);
    expect(result.edges.map((e) => e.id)).toEqual(['e2']);
    expect(result.from).toBe('s2');
    expect(result.to).toBe('s2');
  });

  it('无 history 时返回 available:false 而不是编造图', () => {
    const result = commitSliceGraph(data, {}, null);
    expect(result.available).toBe(false);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.reason).toBeTruthy();
  });

  it('history.available 但 slices 为空时同样拒绝', () => {
    const result = commitSliceGraph(data, {}, history([]));
    expect(result.available).toBe(false);
    expect(result.reason).toBe('commit 历史为空');
  });

  it('空图输入 + 有历史 → available:true 但零节点（诚实空态）', () => {
    const result = commitSliceGraph({ nodes: [], edges: [] }, {}, hist);
    expect(result.available).toBe(true);
    expect(result.nodes).toEqual([]);
    expect(result.sliceCount).toBe(2);
  });
});

describe('edgeVolatility', () => {
  const nodeFiles = { n1: 'src/a.ts', n2: 'src/b.ts' };
  const edges = [edge('e1', 'n1', 'n2')];

  it('挥发度 = 分子（边存在的切片数）/ 分母（两端点都存在的切片数）', () => {
    const hist = history([
      { hash: 's1', timestamp: 1, files: ['src/a.ts', 'src/b.ts'], edges: [{ source: 'n1', target: 'n2' }] },
      { hash: 's2', timestamp: 2, files: ['src/a.ts', 'src/b.ts'], edges: [] },
      { hash: 's3', timestamp: 3, files: ['src/a.ts'], edges: [] },
    ]);
    const report = edgeVolatility(edges, hist, nodeFiles);
    expect(report.available).toBe(true);
    const entry = report.edges[0];
    expect(entry?.endpointSlices).toBe(2); // s1、s2（s3 缺 n2）
    expect(entry?.presentSlices).toBe(1); // 只有 s1
    expect(entry?.volatility).toBeCloseTo(0.5);
  });

  it('端点从未同时出现时挥发度为 0（不跳过该边）', () => {
    const hist = history([{ hash: 's1', timestamp: 1, files: ['src/c.ts'], edges: [] }]);
    const report = edgeVolatility(edges, hist, nodeFiles);
    expect(report.edges[0]?.endpointSlices).toBe(0);
    expect(report.edges[0]?.volatility).toBe(0);
  });

  it('记录首次出现时间（供 temporalPredicate 使用）', () => {
    const hist = history([
      { hash: 's1', timestamp: 1000, files: ['src/a.ts', 'src/b.ts'], edges: [{ source: 'n1', target: 'n2' }] },
      { hash: 's2', timestamp: 2000, files: ['src/a.ts', 'src/b.ts'], edges: [] },
    ]);
    const report = edgeVolatility(edges, hist, nodeFiles);
    expect(report.edges[0]?.firstSeenAt).toBe(1_000_000);
  });

  it('切片未提供边级事实时拒绝计算（不拿文件近似凑分子）', () => {
    const hist = history([{ hash: 's1', timestamp: 1, files: ['src/a.ts', 'src/b.ts'] }]);
    const report = edgeVolatility(edges, hist, nodeFiles);
    expect(report.available).toBe(false);
    expect(report.edges).toEqual([]);
    expect(report.reason).toBeTruthy();
  });

  it('缺少 nodeFiles 映射时拒绝计算', () => {
    const hist = history([{ hash: 's1', timestamp: 1, files: ['src/a.ts', 'src/b.ts'], edges: [] }]);
    expect(edgeVolatility(edges, hist, null).available).toBe(false);
    expect(edgeVolatility(edges, hist, undefined).available).toBe(false);
  });

  it('无 commit 历史时返回 available:false', () => {
    expect(edgeVolatility(edges, { slices: [], head: null, available: false, error: 'x' }).available).toBe(false);
  });

  it('空边集 + 有历史 → available:true 且 edges 为空', () => {
    const hist = history([{ hash: 's1', timestamp: 1, files: ['src/a.ts'], edges: [] }]);
    const report = edgeVolatility([], hist, nodeFiles);
    expect(report.available).toBe(true);
    expect(report.edges).toEqual([]);
  });
});

describe('temporalPredicate', () => {
  it('默认规格恒真', () => {
    const pred = temporalPredicate();
    expect(pred({})).toBe(true);
    expect(pred({ volatility: 0.9 })).toBe(true);
  });

  it('days：只保留最近 N 天内首次出现的边', () => {
    const now = 1_700_000_000_000;
    const pred = temporalPredicate({ days: 30, now });
    expect(pred({ firstSeenAt: now - 10 * 86_400_000 })).toBe(true);
    expect(pred({ firstSeenAt: now - 60 * 86_400_000 })).toBe(false);
  });

  it('days：缺少 firstSeenAt 时判为不符合（不知道 ≠ 新）', () => {
    const pred = temporalPredicate({ days: 30, now: 1_700_000_000_000 });
    expect(pred({})).toBe(false);
  });

  it('since：早于该时刻的边被排除', () => {
    const pred = temporalPredicate({ since: 1_700_000_000_000 });
    expect(pred({ firstSeenAt: 1_700_000_000_000 })).toBe(true);
    expect(pred({ firstSeenAt: 999_999_999_999 })).toBe(false);
  });

  it('minVolatility / maxVolatility 是闭区间', () => {
    const pred = temporalPredicate({ minVolatility: 0.5, maxVolatility: 0.9 });
    expect(pred({ volatility: 0.5 })).toBe(true);
    expect(pred({ volatility: 0.9 })).toBe(true);
    expect(pred({ volatility: 0.49 })).toBe(false);
    expect(pred({ volatility: 0.91 })).toBe(false);
    expect(pred({})).toBe(false);
  });
});
