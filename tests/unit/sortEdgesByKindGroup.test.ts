/**
 * `sortEdgesByKindGroup` 的单元测试（cycle-139 / 需求分析 §82）。
 *
 * ## 它守的是什么
 *
 * file 域边列表的 kind 分组排序契约：
 * 1. 组序 call → import → extend → implement → contains → dependency；
 * 2. 未知组殿后并按字母序（新 kind 不用改表也有确定位置）；
 * 3. 组内 `(source, target, id)` 字典序——与输入序无关的纯确定序；
 * 4. **双来源组键**：`DbEdgeRow.kind` 与 `GraphEdge.type` 都能识别（只认一个会让
 *    另一条路径的排序静默退化——本轮实测缺陷，探针钉住）；
 * 5. 排序不改变集合（纯重排，`total` 不变）。
 */
import { describe, it, expect } from 'vitest';
import { sortEdgesByKindGroup } from '../../src/adapters/codeGraphEdgeReads.ts';

interface Row {
  id: string;
  source: string;
  target: string;
  kind?: string;
  type?: string;
}

function row(id: string, source: string, target: string, extra: { kind?: string; type?: string } = {}): Row {
  return { id, source, target, ...extra };
}

describe('sortEdgesByKindGroup: 组序', () => {
  it('已知组按 call → import → extend → implement → contains → dependency', () => {
    const rows = [
      row('d', 'a', 'b', { type: 'dependency' }),
      row('c', 'a', 'b', { type: 'contains' }),
      row('i', 'a', 'b', { type: 'import' }),
      row('e', 'a', 'b', { type: 'extend' }),
      row('k', 'a', 'b', { type: 'implement' }),
      row('x', 'a', 'b', { type: 'call' }),
    ];
    expect(sortEdgesByKindGroup(rows).map((r) => r.id)).toEqual(['x', 'i', 'e', 'k', 'c', 'd']);
  });

  it('未知组殿后并按字母序（新 kind 不用改表）', () => {
    const rows = [
      row('z-b', 'a', 'b', { type: 'zzz' }),
      row('c', 'a', 'b', { type: 'contains' }),
      row('z-a', 'a', 'b', { type: 'aaa' }),
      row('x', 'a', 'b', { type: 'call' }),
    ];
    expect(sortEdgesByKindGroup(rows).map((r) => r.id)).toEqual(['x', 'c', 'z-a', 'z-b']);
  });
});

describe('sortEdgesByKindGroup: 组内确定序', () => {
  it('组内按 (source, target, id) 字典序，与输入序无关', () => {
    const rows = [
      row('r3', 'n2', 'n1', { type: 'call' }),
      row('r1', 'n1', 'n2', { type: 'call' }),
      row('r2', 'n1', 'n1', { type: 'call' }),
    ];
    expect(sortEdgesByKindGroup(rows).map((r) => r.id)).toEqual(['r2', 'r1', 'r3']);
  });

  it('同端点多重边按 id 决胜（确定性不依赖输入序）', () => {
    const rows = [
      row('b2', 'n1', 'n2', { type: 'call' }),
      row('b1', 'n1', 'n2', { type: 'call' }),
    ];
    expect(sortEdgesByKindGroup(rows).map((r) => r.id)).toEqual(['b1', 'b2']);
  });

  it('排序是纯重排：集合不变（total 不变的依据）', () => {
    const rows = [
      row('a', 'n1', 'n2', { type: 'import' }),
      row('b', 'n1', 'n3', { type: 'call' }),
      row('c', 'n2', 'n3', { type: 'call' }),
    ];
    const out = sortEdgesByKindGroup(rows);
    expect(out).toHaveLength(3);
    expect([...out].map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('sortEdgesByKindGroup: 双来源组键', () => {
  it('DbEdgeRow.kind（无 type 字段）与 GraphEdge.type（无 kind 字段）同组同序', () => {
    const dbRows = [row('d2', 'a', 'b', { kind: 'calls' }), row('d1', 'a', 'b', { kind: 'call' })];
    const graphRows = [row('g2', 'a', 'b', { type: 'call' }), row('g1', 'a', 'b', { type: 'call' })];
    // 两者都识别为 call 组；组内字典序。
    expect(sortEdgesByKindGroup(dbRows).map((r) => r.id)).toEqual(['d1', 'd2']);
    expect(sortEdgesByKindGroup(graphRows).map((r) => r.id)).toEqual(['g1', 'g2']);
  });

  it('混排输入：kind 侧与 type 侧按归并后的组序交叉排列', () => {
    const rows = [
      row('imp', 'a', 'b', { kind: 'imports' }),   // DB 侧写法 → import 组
      row('cal', 'a', 'b', { type: 'call' }),      // 图侧写法 → call 组
      row('dep', 'a', 'b', { kind: 'depends' }),   // DB 侧写法 → dependency 组
    ];
    expect(sortEdgesByKindGroup(rows).map((r) => r.id)).toEqual(['cal', 'imp', 'dep']);
  });

  it('两字段都缺 ⇒ dependency 兜底（殿后组，不抛错）', () => {
    const rows = [row('bare', 'a', 'b')];
    expect(() => sortEdgesByKindGroup(rows)).not.toThrow();
    expect(sortEdgesByKindGroup(rows)[0]!.id).toBe('bare');
  });
});
