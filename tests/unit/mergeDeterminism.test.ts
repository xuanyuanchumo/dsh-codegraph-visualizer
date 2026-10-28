// P0-1（graphify 借鉴）：合并顺序无关 + 冲突边的分层裁决。
//
// 旧实现是「后写覆盖」：两个适配器描述同一条边时，谁排在 `results` 后面谁赢 —— 于是同一组
// adapter 结果换个顺序就得到不同的图（这也是 `mergeDeterminism` 第一个用例要钉住的东西）。
//
// 本文件锁两件事：
//   1. 同一组 adapter 结果，6 种排列 → 逐字节相同的 GraphData（`Date.now()` 冻结后比较全文）；
//   2. 冲突边按声明好的优先级裁决，每条规则一个用例（来源 > 方向 > 关系具体度 > 可定位 > 平局兜底）。
//
// 诚实边界：节点冲突**仍**是「后写覆盖」（`GraphDataMerger.test.ts` 的 "with second source
// winning" 把该契约钉死，本轮没有为节点发明一个可证明的归因维度），所以排列对比的 fixture
// 让三个适配器各自持有不相交的节点集合 —— 该用例断言的是"边裁决 + 输出次序"的顺序无关性，
// 不是"节点冲突也已顺序无关"。边界写在 `GraphDataMerger.merge` 的注释里。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GraphDataMerger } from '../../src/merger/GraphDataMerger.ts';
import { RepoId } from '../../src/types/index.ts';
import type { AdapterResult, DataSourceType, GraphEdge, GraphNode } from '../../src/types/index.ts';
import { makeEdge, makeNode } from '../helpers.ts';

const FROZEN_NOW = 1_700_000_000_000;

function adapter(source: DataSourceType, nodes: GraphNode[], edges: GraphEdge[]): AdapterResult {
  return { nodes, edges, source, timestamp: 1 };
}

function withProperties(edge: GraphEdge, properties: Record<string, unknown>): GraphEdge {
  return { ...edge, properties: { ...edge.properties, ...properties } };
}

/** All permutations of a small list; the determinism claim is "every one of them", not "a few". */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) out.push([items[i]!, ...perm]);
  }
  return out;
}

const N1 = makeNode('n1', 'A', 'function', 'a.ts', 1);
const N2 = makeNode('n2', 'B', 'function', 'b.ts', 1);
const N3 = makeNode('n3', 'C', 'class', 'c.ts', 1);
const N4 = makeNode('n4', 'D', 'function', 'd.ts', 1);
const N5 = makeNode('n5', 'E', 'function', 'e.ts', 1);

/** 三个适配器：节点集合互不相交，但都描述同一条 `e-shared` 边（并各自带一条独有边）。 */
const RESULTS: AdapterResult[] = [
  adapter('codegraph', [N1, N2], [
    withProperties(makeEdge('e-shared', 'n1', 'n2', 'dependency'), {
      edgeOrigin: 'heuristic', edgeLocatable: false, marker: 'from-codegraph',
    }),
    withProperties(makeEdge('e-a', 'n1', 'n2', 'call'), { edgeOrigin: 'db', edgeLocatable: true, rawKind: 'calls' }),
  ]),
  adapter('lens', [N3], [
    withProperties(makeEdge('e-shared', 'n1', 'n2', 'call'), {
      edgeOrigin: 'db', edgeLocatable: true, marker: 'from-lens', line: 3,
    }),
    withProperties(makeEdge('e-b', 'n2', 'n3', 'import'), { edgeOrigin: 'db', edgeLocatable: true }),
  ]),
  adapter('tree-sitter', [N4, N5], [
    withProperties(makeEdge('e-shared', 'n1', 'n2', 'call'), {
      edgeOrigin: 'ast', edgeLocatable: true, marker: 'from-tree-sitter', line: 9,
    }),
    withProperties(makeEdge('e-c', 'n4', 'n5', 'contains'), { edgeOrigin: 'ast', edgeLocatable: true }),
  ]),
];

describe('merge determinism (P0-1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces byte-identical GraphData for all 6 permutations of 3 adapter results', () => {
    // `metadata.timestamp` is `Date.now()`; freeze it or the comparison is measuring the clock.
    // The arbitration itself must not depend on time.
    vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);

    const perms = permutations(RESULTS);
    expect(perms).toHaveLength(6);

    const merger = new GraphDataMerger();
    const outputs = perms.map((perm) => JSON.stringify(merger.merge(perm, RepoId('repo-1'))));
    const unique = new Set(outputs);
    expect(unique.size).toBe(1);

    const data = JSON.parse(outputs[0]!) as { nodes: { id: string }[]; edges: { id: string }[] };
    // Anti-vacuity: the fixture must really contain the conflict the determinism claim is about.
    expect(data.nodes).toHaveLength(5);
    expect(data.edges.map((e) => e.id)).toEqual(['e-a', 'e-b', 'e-c', 'e-shared']);
  });

  it('keeps the arbitration node-count/edge-count in metadata consistent after sorting', () => {
    const data = new GraphDataMerger().merge(RESULTS, RepoId('repo-1'));
    expect(data.metadata.nodeCount).toBe(5);
    expect(data.metadata.edgeCount).toBe(4);
  });
});

describe('conflicting edge arbitration (one case per declared rule)', () => {
  function mergeEdge(a: GraphEdge, aSource: DataSourceType, b: GraphEdge, bSource: DataSourceType): GraphEdge {
    const nodes = [N1, N2];
    const data = new GraphDataMerger().merge(
      [adapter(aSource, nodes, [a]), adapter(bSource, [], [b])],
      RepoId('repo-1'),
    );
    expect(data.edges).toHaveLength(1);
    return data.edges[0]!;
  }

  function pair(a: GraphEdge, b: GraphEdge): GraphEdge {
    return mergeEdge(a, 'codegraph', b, 'lens');
  }

  it('rule 1 — attribution strength decides first (db beats heuristic, in both orders)', () => {
    const heuristic = withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
      edgeOrigin: 'heuristic', edgeLocatable: true, marker: 'heuristic',
    });
    const indexed = withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
      edgeOrigin: 'db', edgeLocatable: true, marker: 'db',
    });

    expect(pair(heuristic, indexed).properties.marker).toBe('db');
    expect(pair(indexed, heuristic).properties.marker).toBe('db');
  });

  it('rule 2 — a declared direction beats an undeclared one', () => {
    const bare = withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
      edgeOrigin: 'db', edgeLocatable: true, marker: 'bare',
    });
    const directed = {
      ...withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
        edgeOrigin: 'db', edgeLocatable: true, marker: 'directed',
      }),
      direction: 'forward' as const,
    };

    expect(pair(bare, directed).properties.marker).toBe('directed');
    expect(pair(directed, bare).properties.marker).toBe('directed');
  });

  it('rule 3 — a named relation beats the `dependency` catch-all', () => {
    const fallback = withProperties(makeEdge('e1', 'n1', 'n2', 'dependency'), {
      edgeOrigin: 'db', edgeLocatable: true, marker: 'dependency',
    });
    const named = withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
      edgeOrigin: 'db', edgeLocatable: true, marker: 'call',
    });

    expect(pair(fallback, named).properties.marker).toBe('call');
    expect(pair(named, fallback).properties.marker).toBe('call');
  });

  it('rule 4 — a locatable edge beats an unlocatable one when everything else ties', () => {
    const unlocatable = withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
      edgeOrigin: 'db', edgeLocatable: false, marker: 'unlocatable',
    });
    const locatable = withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
      edgeOrigin: 'db', edgeLocatable: true, line: 12, marker: 'locatable',
    });

    expect(pair(unlocatable, locatable).properties.marker).toBe('locatable');
    expect(pair(locatable, unlocatable).properties.marker).toBe('locatable');
  });

  // 反向用例（研究文档 §P0-1 验收 ③）：`edgeLocatable: false` 不得被归因等级"提升"。
  // 一条 db 但无位置的边可以凭归因胜出，但胜出后它仍然是**不可定位**的 —— 裁决不许重写证据。
  it('does not promote edgeLocatable:false to true when the winner is unlocatable', () => {
    const heuristicLocated = withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
      edgeOrigin: 'heuristic', edgeLocatable: true, line: 4, marker: 'located',
    });
    const dbUnlocated = withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
      edgeOrigin: 'db', edgeLocatable: false, marker: 'db-unlocated',
    });

    const winner = pair(heuristicLocated, dbUnlocated);
    expect(winner.properties.marker).toBe('db-unlocated');
    expect(winner.properties.edgeLocatable).toBe(false);
    // 输家带 line，但归因等级先于"可定位"判定，所以 line 不能反向把胜者变成可定位边
    const winnerReversed = pair(dbUnlocated, heuristicLocated);
    expect(winnerReversed.properties.marker).toBe('db-unlocated');
    expect(winnerReversed.properties.edgeLocatable).toBe(false);
  });

  // 平局兜底：四层全部打平时，结果必须仍然确定（否则就退回"后写覆盖"）。
  // 选"规范化序列化较大者"是任意但**完整**的选择，被这里钉死；改它必须是有意行为。
  it('breaks a full tie deterministically, independent of input order', () => {
    const alpha = withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
      edgeOrigin: 'db', edgeLocatable: true, marker: 'alpha',
    });
    const beta = withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
      edgeOrigin: 'db', edgeLocatable: true, marker: 'beta',
    });

    const forwards = mergeEdge(alpha, 'codegraph', beta, 'lens');
    const backwards = mergeEdge(beta, 'lens', alpha, 'codegraph');
    expect(forwards.properties.marker).toBe(backwards.properties.marker);
    expect(forwards.properties).toEqual(backwards.properties);
    expect(forwards.properties.marker).toBe('beta');
  });

  it('still unions the disjoint property keys of the losing record', () => {
    const winner = withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
      edgeOrigin: 'db', edgeLocatable: true, onlyWinner: true,
    });
    const loser = withProperties(makeEdge('e1', 'n1', 'n2', 'call'), {
      edgeOrigin: 'heuristic', edgeLocatable: true, onlyLoser: true,
    });

    expect(pair(winner, loser).properties).toMatchObject({ onlyWinner: true, onlyLoser: true });
    expect(pair(loser, winner).properties).toMatchObject({ onlyWinner: true, onlyLoser: true });
  });

  it('sorts the emitted arrays by id so insertion order cannot leak into the output', () => {
    const nodes = [makeNode('n9', 'Z', 'function', 'z.ts', 1), makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const edges = [
      withProperties(makeEdge('e9', 'n1', 'n9', 'call'), { edgeOrigin: 'db', edgeLocatable: true }),
      withProperties(makeEdge('e1', 'n1', 'n9', 'call'), { edgeOrigin: 'db', edgeLocatable: true }),
    ];
    const data = new GraphDataMerger().merge([adapter('codegraph', nodes, edges)], RepoId('repo-1'));
    expect(data.nodes.map((n) => n.id)).toEqual(['n1', 'n9']);
    expect(data.edges.map((e) => e.id)).toEqual(['e1', 'e9']);
  });
});
