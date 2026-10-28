// P0-1（graphify 借鉴）：边来源归因 —— 只断言**可证明**的三件事。
//
// 上游 `codegraph.db` 的 edges 表只有 `id/source/target/kind/line`，没有 confidence 列
// （见 `src/adapters/CodeGraphAdapter.ts` 的 `DbEdgeRow`）。因此本文件断言的是：
//   - `edgeOrigin`：这条边由谁造出来（DB 索引行 ⇒ 'db'）；
//   - `edgeLocatable`：这一行有没有 line（有 ⇒ 证据可回溯到源码位置）；
//   - `rawKind`：被 `EDGE_KIND_MAP` 压平之前的上游 kind。
// 并**反向**断言不存在 `confidence: 'EXTRACTED' | 'INFERRED'` 这类伪造证据 —— 那是一条守卫，
// 不是一条注释：后人想"顺手加上"就会在这里变红。
import { describe, it, expect } from 'vitest';
import { mapRowsToGraphEdges } from '../../src/adapters/CodeGraphAdapter.ts';
import type { DbEdgeRow } from '../../src/adapters/CodeGraphAdapter.ts';

const VALID_NODES = new Set(['n1', 'n2', 'n3']);

/** 覆盖：可定位 / 不可定位 / 压平后改变 type / 未知 kind / 自环 / 过滤 / 断头边。 */
const ROWS: DbEdgeRow[] = [
  { id: 1, source: 'n1', target: 'n2', kind: 'calls', line: 15 },
  { id: 2, source: 'n2', target: 'n1', kind: 'contains', line: null },
  { id: 3, source: 'n1', target: 'n3', kind: 'unknown_relation', line: 7 },
  { id: 4, source: 'n1', target: 'n1', kind: 'call', line: 1 },
  { id: 5, source: 'n1', target: 'n3', kind: 'uses_var', line: 1 },
  { id: 6, source: 'n1', target: 'ghost', kind: 'call', line: 1 },
];

function edgeById(id: string) {
  const edges = mapRowsToGraphEdges(ROWS, VALID_NODES);
  const edge = edges.find((e) => e.id === id);
  if (!edge) throw new Error(`edge ${id} was not emitted; emitted=${edges.map((e) => e.id).join(',')}`);
  return edge;
}

describe('edge attribution: mapRowsToGraphEdges', () => {
  it('emits only the edges that pass the shared filter (self-loop / FILTERED_EDGE_KINDS / missing endpoint)', () => {
    expect(mapRowsToGraphEdges(ROWS, VALID_NODES).map((e) => e.id as string)).toEqual(['1', '2', '3']);
  });

  it("stamps every emitted edge with edgeOrigin 'db'", () => {
    for (const edge of mapRowsToGraphEdges(ROWS, VALID_NODES)) {
      expect(edge.properties.edgeOrigin).toBe('db');
    }
  });

  it('keeps the upstream kind in rawKind, including when type was flattened', () => {
    // 'calls' -> type 'call'，但压平前的写法仍然可读
    expect(edgeById('1').type).toBe('call');
    expect(edgeById('1').properties.rawKind).toBe('calls');
    // 未知 kind -> type 的兜底值 'dependency'，rawKind 仍保留原值（否则"未知"就永远查不出来）
    expect(edgeById('3').type).toBe('dependency');
    expect(edgeById('3').properties.rawKind).toBe('unknown_relation');
  });

  it('sets edgeLocatable from the presence of a line, in BOTH directions', () => {
    expect(edgeById('1').properties.edgeLocatable).toBe(true);
    expect(edgeById('2').properties.edgeLocatable).toBe(false);

    // 反向保护：全体用例里 edgeLocatable 不能只有一种取值，否则"恒 false"也能全绿
    const values = new Set(mapRowsToGraphEdges(ROWS, VALID_NODES).map((e) => e.properties.edgeLocatable));
    expect(values).toEqual(new Set([true, false]));
  });

  it('keeps the line property consistent with edgeLocatable', () => {
    expect(edgeById('1').properties.line).toBe(15);
    expect(edgeById('2')).not.toHaveProperty('properties.line');
  });

  it('never invents a confidence field or an EXTRACTED/INFERRED verdict', () => {
    for (const edge of mapRowsToGraphEdges(ROWS, VALID_NODES)) {
      for (const [key, value] of Object.entries(edge.properties)) {
        expect(key).not.toMatch(/confidence/i);
        expect(value).not.toBe('EXTRACTED');
        expect(value).not.toBe('INFERRED');
      }
    }
  });

  it('tags import-capped edges too (attribution must not be lost by the cap)', () => {
    const importRows: DbEdgeRow[] = [
      { id: 1, source: 'n1', target: 'n2', kind: 'imports', line: 1 },
      { id: 2, source: 'n1', target: 'n3', kind: 'imports', line: 2 },
      { id: 3, source: 'n1', target: 'n2', kind: 'imports', line: 3 },
    ];
    const capped = mapRowsToGraphEdges(importRows, VALID_NODES, { importCap: 2 });
    expect(capped.map((e) => e.id as string)).toEqual(['1', '2']);
    for (const edge of capped) {
      expect(edge.properties).toMatchObject({ edgeOrigin: 'db', rawKind: 'imports' });
    }
  });

  it('keeps the pre-existing __source marker alongside the attribution keys', () => {
    const [edge] = mapRowsToGraphEdges(ROWS.slice(0, 1), VALID_NODES, { source: 'codegraph' });
    expect(edge!.properties).toMatchObject({ __source: 'codegraph', edgeOrigin: 'db', rawKind: 'calls' });
  });
});
