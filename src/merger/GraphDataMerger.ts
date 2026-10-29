// GraphDataMerger - multi-source aggregation with dedup + delta merge.
import type { GraphNode, GraphEdge, GraphData, AdapterResult, RepoId } from '../types/index.ts';
import { sanitizeGraphData } from '../shared/GraphValidator.ts';
import { stableStringify } from '../shared/graphFingerprint.ts';

/**
 * 边来源归因的取值 —— 与 `CodeGraphAdapter` / `TreeSitterAdapter` 写进 `properties.edgeOrigin`
 * 的那一套同源。
 *
 * 只有**可证明**的取值在这里：`ast`（语法结构造出来的边，无歧义）、`db`（SQLite 索引的 edges
 * 行）、`heuristic`（适配器靠启发式拼出来的边）。上游边表没有 confidence 列，所以这里也
 * 刻意不出现 `EXTRACTED`/`INFERRED` —— 那种取值无法由本仓库的任何数据证明。
 *
 * 生产代码里**实际有两个**档位在产出（cycle-111 收口 P1-N4）：
 *   · `db`  —— `src/adapters/codeGraphRows.ts` 的 `readEdges*` 系列，来自 SQLite edges 行；
 *   · `ast` —— `src/adapters/TreeSitterAdapter.ts` 的 `contains` 边（语法树父子关系的直接投影）。
 *     修前该文件写的是 `properties: {}`，于是 `EDGE_ORIGIN_RANK.ast = 3` 这一档
 *     **从未在真实数据上生效过** —— 一条写着却永不触发的裁决规则。
 *
 * `heuristic` 至今**仍然没有生产者**（全仓只有 `tests/unit/mergeDeterminism.test.ts` 的 fixture
 * 在用它）。保留该档位是因为它描述的是"适配器靠启发式拼出来的边"这一**可能**的来源，
 * 删掉它会让将来第一个启发式适配器不得不连裁决表一起改；但**不宣称它已在被使用** ——
 * 这正是本仓反复记录的"注释宣称的特性 vs 代码里真实发生的特性"的区别。若下一轮仍无生产者，
 * 应当连同 `EDGE_ORIGIN_RANK` 的这一档一起删掉，而不是继续留着。
 *
 * 因此 `EDGE_ORIGIN_RANK.ast = 3` 现在是**可被观测**的：同一对端点的 `contains` 边若同时来自
 * 索引行与语法树，语法树那份胜出（`compareEdgePreference` 第 1 层）。
 * `tests/unit/mergeDeterminism.test.ts` 有一条用例直接钉住这个结果。
 */
export type EdgeOrigin = 'ast' | 'db' | 'heuristic';

/** 来源强弱：语法结构 > 索引行 > 启发式。缺失/未知来源按 0 处理（最弱）。 */
export const EDGE_ORIGIN_RANK: Readonly<Record<EdgeOrigin, number>> = Object.freeze({
  ast: 3,
  db: 2,
  heuristic: 1,
});

/**
 * 关系具体度：`dependency` 是 `EDGE_KIND_MAP` 对**未知上游 kind** 的兜底值
 * （`CodeGraphAdapter.mapEdgeKind`），所以它必然比具名关系更弱；具名关系之间不再区分强弱。
 */
const EDGE_TYPE_SPECIFICITY: Readonly<Record<GraphEdge['type'], number>> = Object.freeze({
  call: 2,
  import: 2,
  extend: 2,
  implement: 2,
  contains: 2,
  association: 1,
  aggregation: 1,
  composition: 1,
  dependency: 0,
});

function edgeOriginRank(edge: GraphEdge): number {
  const origin = edge.properties.edgeOrigin;
  if (typeof origin !== 'string') return 0;
  return EDGE_ORIGIN_RANK[origin as EdgeOrigin] ?? 0;
}

function hasDeclaredDirection(edge: GraphEdge): number {
  return edge.direction === undefined ? 0 : 1;
}

function edgeSpecificity(edge: GraphEdge): number {
  return EDGE_TYPE_SPECIFICITY[edge.type] ?? 0;
}

function isLocatable(edge: GraphEdge): number {
  return edge.properties.edgeLocatable === true ? 1 : 0;
}

/**
 * 同一条边被多个适配器同时描述时的**总序**：返回值 > 0 表示 `a` 胜出。
 *
 * 分四层，每层只在上一层打平时参与裁决：
 *   1. 来源强弱（`EDGE_ORIGIN_RANK`）；
 *   2. 是否声明了方向（`direction` 有值 = 信息更完整）；
 *   3. 关系具体度（具名关系 > `dependency` 兜底值）；
 *   4. 是否可定位（`edgeLocatable === true`，即该行有 line 可回溯）。
 *
 * 四层全平时用**规范化序列化**兜底。这一层没有语义偏好，唯一目的是让"平局"也有确定答案：
 * 没有它，结果就退回"后写覆盖"，与入参顺序有关（本函数存在的全部理由）。方向（取较大者）
 * 是任意选择，已被 `tests/unit/mergeDeterminism.test.ts` 钉死，改动它必须是有意行为。
 */
export function compareEdgePreference(a: GraphEdge, b: GraphEdge): number {
  const layers = [
    edgeOriginRank(a) - edgeOriginRank(b),
    hasDeclaredDirection(a) - hasDeclaredDirection(b),
    edgeSpecificity(a) - edgeSpecificity(b),
    isLocatable(a) - isLocatable(b),
  ];
  for (const delta of layers) {
    if (delta !== 0) return delta;
  }
  const sa = stableStringify(a);
  const sb = stableStringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** 输出数组的稳定次序：按 id 升序。入参排列不能影响合并结果的字节形状。 */
function compareById(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 属性键排序后重建对象。
 *
 * `JSON.stringify` 保留键的插入顺序，而"先铺输家再铺赢家"的合并顺序会让同名键的插入次序随
 * 入参排列变化 —— 值相同、字节不同。属性表没有语义顺序，所以输出前统一排序。
 *
 * `undefined` 值一并丢弃：它们不会出现在序列化里，留着只影响 `Object.keys()` 的读数。
 */
function canonicalProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(properties).sort()) {
    const value = properties[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** 一条边的裁决状态：胜出记录本身 + 所有来源的属性并集。 */
interface EdgeSlot {
  winner: GraphEdge;
  properties: Record<string, unknown>;
}

export class GraphDataMerger {
  /**
   * 多源合并。**结果与 `results` 的排列无关**（同一组输入，任意顺序产出逐字节相同的 GraphData，
   * 时间戳除外，它来自 `Date.now()`）。
   *
   * 边冲突不再"后写覆盖"：`compareEdgePreference` 给出总序，胜者的标量字段与属性值胜出，
   * 输者的独有属性键仍然保留（属性并集）。每个键的取值来自"偏好顺序最高且含有该键"的那条记录，
   * 因此并集本身也与顺序无关。
   *
   * 节点冲突仍保持既有的"后写覆盖"语义（`GraphDataMerger.test.ts` 的
   * "with second source winning" 用例把它钉死）：节点没有与边对等的可证明归因维度，
   * 本轮不去发明一个。输出数组按 id 排序，所以**只要节点集合不冲突**，排列不影响结果。
   */
  merge(results: AdapterResult[], repoId: RepoId): GraphData {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, EdgeSlot>();

    for (const r of results) {
      for (const node of r.nodes) {
        const existing = nodes.get(node.id);
        if (existing) {
          nodes.set(node.id, {
            ...existing,
            ...node,
            properties: { ...existing.properties, ...node.properties, __source: r.source },
          });
        } else {
          nodes.set(node.id, {
            ...node,
            properties: { ...node.properties, __source: r.source },
          });
        }
      }
      for (const edge of r.edges) {
        const candidate: GraphEdge = {
          ...edge,
          properties: { ...edge.properties, __source: r.source },
        };
        const existing = edges.get(edge.id as string);
        if (!existing) {
          edges.set(edge.id as string, {
            winner: candidate,
            properties: { ...candidate.properties },
          });
          continue;
        }
        if (compareEdgePreference(candidate, existing.winner) > 0) {
          edges.set(edge.id as string, {
            winner: candidate,
            properties: { ...existing.properties, ...candidate.properties },
          });
        } else {
          edges.set(edge.id as string, {
            winner: existing.winner,
            properties: { ...candidate.properties, ...existing.properties },
          });
        }
      }
    }

    const rawData = {
      nodes: Array.from(nodes.values()).sort(compareById),
      edges: Array.from(edges.values())
        .map((slot) => ({ ...slot.winner, properties: canonicalProperties(slot.properties) }))
        .sort(compareById),
      metadata: {
        repoId: repoId,
        timestamp: Date.now(),
        nodeCount: nodes.size,
        edgeCount: edges.size,
      },
    };

    const { data, issues } = sanitizeGraphData(rawData);
    if (issues.length > 0) {
      const dropped = issues.filter((i: { level: string }) => i.level === 'dropped').length;
      const autoCorrected = issues.filter((i: { level: string }) => i.level === 'auto-corrected').length;
      if (dropped > 0 || autoCorrected > 0) {
        data.metadata.nodeCount = data.nodes.length;
        data.metadata.edgeCount = data.edges.length;
      }
    }


    return data;
  }

  // Delta merge for incremental heat-updates.
  //
  // 这里刻意**不**套用 `compareEdgePreference`：delta 的冲突是**时间**顺序而不是多源顺序，
  // 它是"同一份图的更新一版"，后者必须胜出。换成偏好裁决会让一次合法的字段更新被旧记录拒绝
  // （`GraphDataMerger.test.ts` 的 "should update existing edges with delta data" 就是这条契约）。
  applyDelta(current: GraphData, delta: AdapterResult): GraphData {
    const nodes = new Map(current.nodes.map(n => [n.id, n]));
    const edges = new Map(current.edges.map(e => [e.id, e]));

    for (const node of delta.nodes) {
      const existing = nodes.get(node.id);
      if (existing) {
        nodes.set(node.id, {
          ...existing,
          ...node,
          properties: { ...existing.properties, ...node.properties },
        });
      } else {
        nodes.set(node.id, node);
      }
    }
    for (const edge of delta.edges) {
      const existing = edges.get(edge.id);
      if (existing) {
        edges.set(edge.id, {
          ...existing,
          ...edge,
          properties: { ...existing.properties, ...edge.properties },
        });
      } else {
        edges.set(edge.id, edge);
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
      metadata: {
        ...current.metadata,
        timestamp: Date.now(),
        nodeCount: nodes.size,
        edgeCount: edges.size,
      },
    };
  }
}
