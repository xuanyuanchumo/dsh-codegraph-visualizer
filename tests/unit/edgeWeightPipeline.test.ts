/**
 * weight 数据面（cycle-119 / §62.6 #4 / X-07 数据侧清偿）。
 *
 * 背景：cycle-110 XJ-07 给 `'top-k-weight'` 截断落了完整契约（`EnumerateOptions.truncation`、
 * 库的按边权重之和取前 k），但 `XJEdge.weight` 在生产数据里零写入——契约就位、数据未喂，
 * 工具面的 `truncation:'top-k-weight'` 是「行为正确但永远等价 DFS 序」的死开关。
 *
 * 本轮的实测证据链（cycle-119 现场取证）：上游 `codegraph.db` 的 `edges` 表是
 * **8 列**（`id,source,target,kind,metadata,line,col,provenance`），其中 `metadata`
 * 是 JSON 文本 `{"confidence":0.9,"resolvedBy":"exact-match"}`；本仓 `.codegraph`
 * 实测 10,869 条边、6,556 条非空 metadata，calls 的 confidence 分布 0.4~0.9。
 * 读取 SQL 此前只取 5 列 ⇒ confidence 从未进入管线。
 *
 * 本文件钉四组契约：
 *   1. `parseEdgeConfidence` 的**保守降级矩阵**（列缺失/非 JSON/非数/越界 ⇒ undefined，
 *      绝不产出编造值）；
 *   2. `mapRowsToGraphEdges` 的 weight 产出（confidence → 顶层 `GraphEdge.weight`，
 *      与 properties 无关——XuanjiAdapter 的 `xjEdge` 只读顶层）；
 *   3. **指纹影响显式化**：weight 进 `graphFingerprint`（stableStringify properties +
 *      顶层 weight 字段）⇒ 同一 DB 两次映射结果一致、有/无 confidence 结果不同
 *      （一次性 re-fingerprint 的显式登记，见交付清单）；
 *   4. 共享列常量 `EDGE_ROW_COLUMNS`（8 处 SELECT 收敛一处，防再次漏列）。
 */
import { describe, it, expect } from 'vitest';
import {
  parseEdgeConfidence,
  EDGE_ROW_COLUMNS,
  mapRowsToGraphEdges,
  type DbEdgeRow,
} from '../../src/adapters/CodeGraphAdapter.ts';
import { computeGraphFingerprint } from '../../src/shared/graphFingerprint.ts';
import { makeNode } from '../helpers.ts';
import { NodeId, EdgeId, RepoId, type GraphData } from '../../src/types/index.ts';

describe('parseEdgeConfidence: 保守降级矩阵', () => {
  it('合法形态：数值且在 [0,1] 内 ⇒ 原样返回', () => {
    expect(parseEdgeConfidence('{"confidence":0.9,"resolvedBy":"exact-match"}')).toBe(0.9);
    expect(parseEdgeConfidence('{"confidence":0}')).toBe(0);
    expect(parseEdgeConfidence('{"confidence":1}')).toBe(1);
  });

  it('缺失/空/null ⇒ undefined（列缺失与「不知道」同型）', () => {
    expect(parseEdgeConfidence(null)).toBeUndefined();
    expect(parseEdgeConfidence(undefined)).toBeUndefined();
    expect(parseEdgeConfidence('')).toBeUndefined();
  });

  it('非 JSON / 非对象 / 非数 ⇒ undefined（不 throw——单行损坏不拖垮整页）', () => {
    expect(parseEdgeConfidence('not json {')).toBeUndefined();
    expect(parseEdgeConfidence('42')).toBeUndefined();
    expect(parseEdgeConfidence('"str"')).toBeUndefined();
    expect(parseEdgeConfidence('[]')).toBeUndefined();
    expect(parseEdgeConfidence('{}')).toBeUndefined();
    expect(parseEdgeConfidence('{"confidence":"0.9"}')).toBeUndefined();
    expect(parseEdgeConfidence('{"confidence":NaN}')).toBeUndefined(); // JSON.parse 抛错路径
  });

  it('越界 [0,1] ⇒ undefined（与缺失同型，绝无编造值）', () => {
    expect(parseEdgeConfidence('{"confidence":1.5}')).toBeUndefined();
    expect(parseEdgeConfidence('{"confidence":-0.1}')).toBeUndefined();
    expect(parseEdgeConfidence('{"confidence":90}')).toBeUndefined();
  });
});

describe('mapRowsToGraphEdges: confidence → weight', () => {
  const nodes = new Set(['n1', 'n2']);

  it('有 confidence 的行产出顶层 weight；无 metadata 的行不产出该键', () => {
    const rows: DbEdgeRow[] = [
      { id: 1, source: 'n1', target: 'n2', kind: 'calls', metadata: '{"confidence":0.9}', line: 1 },
      { id: 2, source: 'n1', target: 'n2', kind: 'calls', metadata: null, line: 2 },
      { id: 3, source: 'n1', target: 'n2', kind: 'calls', metadata: '{"confidence":0.4}', line: 3 },
    ];
    const edges = mapRowsToGraphEdges(rows, nodes);
    expect(edges.map((e) => e.weight)).toEqual([0.9, undefined, 0.4]);
    // 键存在性：id=2 是「无该键」不是「键为 undefined」（toEqual 对两者等价，必须用 in）。
    expect('weight' in edges[1]!).toBe(false);
    expect('weight' in edges[0]!).toBe(true);
  });

  it('weight 不进 properties（消费侧 xjEdge 只读顶层；properties 归因字段不变）', () => {
    const rows: DbEdgeRow[] = [
      { id: 1, source: 'n1', target: 'n2', kind: 'calls', metadata: '{"confidence":0.7}', line: 5 },
    ];
    const [edge] = mapRowsToGraphEdges(rows, nodes);
    expect(edge!.weight).toBe(0.7);
    expect(edge!.properties).not.toHaveProperty('confidence');
    expect(edge!.properties).toMatchObject({ edgeOrigin: 'db', rawKind: 'calls', line: 5 });
  });

  it('归因契约不回归：edgeOrigin/edgeLocatable/rawKind 与 weight 正交（cycle-109 P1-1 的字段一个不少）', () => {
    const rows: DbEdgeRow[] = [
      { id: 1, source: 'n1', target: 'n2', kind: 'calls', metadata: '{"confidence":0.5}', line: null },
    ];
    const [edge] = mapRowsToGraphEdges(rows, nodes);
    expect(edge!.weight).toBe(0.5);
    expect(edge!.properties.edgeLocatable).toBe(false);
  });
});

describe('指纹影响（显式登记的 re-fingerprint）', () => {
  function graphWith(edges: Array<{ weight?: number }>): GraphData {
    const nodesArr = [
      makeNode('a', 'alpha', 'function', 'src/a.ts', 10),
      makeNode('b', 'beta', 'function', 'src/b.ts', 20),
    ];
    return {
      nodes: nodesArr,
      edges: edges.map((w, i) => ({
        id: EdgeId(`e${i}`),
        source: NodeId('a'),
        target: NodeId('b'),
        type: 'call' as const,
        ...(w.weight !== undefined ? { weight: w.weight } : {}),
        properties: { edgeOrigin: 'db' as const, edgeLocatable: true, rawKind: 'calls' },
      })),
      metadata: { repoId: RepoId('r'), timestamp: 1, nodeCount: 2, edgeCount: edges.length },
    };
  }

  it('同一 DB 内容两次映射 → 指纹稳定（确定性不回归）', () => {
    expect(computeGraphFingerprint(graphWith([{ weight: 0.9 }])))
      .toBe(computeGraphFingerprint(graphWith([{ weight: 0.9 }])));
  });

  it('有/无 weight 的图指纹不同（一次性 re-fingerprint 的机制性证据）', () => {
    expect(computeGraphFingerprint(graphWith([{ weight: 0.9 }])))
      .not.toBe(computeGraphFingerprint(graphWith([{}])));
    expect(computeGraphFingerprint(graphWith([{ weight: 0.9 }])))
      .not.toBe(computeGraphFingerprint(graphWith([{ weight: 0.4 }])));
  });
});

describe('EDGE_ROW_COLUMNS: 共享列清单', () => {
  it('必须包含 weight 数据面的三要素列（防再次漏列）', () => {
    for (const col of ['id', 'source', 'target', 'kind', 'metadata', 'line']) {
      expect(EDGE_ROW_COLUMNS).toContain(col);
    }
  });

  it('反向自检：列清单是纯 SELECT 片段（无 FROM/WHERE/尾逗号）', () => {
    expect(EDGE_ROW_COLUMNS).not.toMatch(/FROM|WHERE|,\s*$/);
  });
});
