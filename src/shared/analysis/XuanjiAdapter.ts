/**
 * XuanjiAdapter — 璇玑图算法库的宿主适配层。
 *
 * 定位（对应 `docs/research/璇玑图算法库设计与集成方案.md` §七）：
 * 把项目的 `GraphData` / `GraphDelta` 翻译成库的 `GraphSpace` / 增量事件，
 * 把宿主需求翻译成 `PathRule`，然后委托库执行。**这是唯一与宿主耦合的模块**。
 *
 * 强制边界：`src/xuanji/**` 只依赖自身（见 tests/unit/xuanji/libraryBoundary.test.ts），
 * 所有 `GraphNode` / branded id / GraphDelta 的转换都发生在这里。
 *
 * @module shared/analysis/XuanjiAdapter
 */

import type { GraphData, GraphDelta, GraphEdge, GraphNode } from '../../types/index.ts';
import { GraphSpace, type NodeAttrs, type XJEdge } from '../../xuanji/core/graph-space.ts';
import type { PathRule } from '../../xuanji/core/path-rule.ts';
import { PathIndex } from '../../xuanji/index/path-index.ts';
import { onEdgeAdded, onEdgeRemoved } from '../../xuanji/index/incremental.ts';
import { enumerate } from '../../xuanji/query/query-engine.ts';

/** 允许的边类型（项目 `GraphEdge.type` 的取值域）。 */
export type AdapterEdgeType = GraphEdge['type'];

/** 默认参与路径读法的边类型：结构包含边 `contains` 不构成调用/依赖路径。 */
export const DEFAULT_PATH_EDGE_TYPES: readonly AdapterEdgeType[] = [
  'call',
  'import',
  'extend',
  'implement',
  'dependency',
];

/** `findPathsBetween` 的读法参数。 */
export interface PathEnumerationOptions {
  /** 参与遍历的边类型；缺省用 DEFAULT_PATH_EDGE_TYPES。 */
  readonly edgeTypes?: readonly AdapterEdgeType[];
  /** 最少跳数（边数），默认 1。 */
  readonly minHops?: number;
  /** 最多跳数（边数），默认 5。 */
  readonly maxHops?: number;
  /** 最多返回多少条路径，默认 20。 */
  readonly limit?: number;
}

/** 路径枚举结果。 */
export interface PathEnumerationResult {
  /** 每条路径是节点 id 序列（含首尾）。 */
  readonly paths: string[][];
  /** 是否因 limit 截断。 */
  readonly truncated: boolean;
  /** 实际返回条数。 */
  readonly total: number;
}

/** 环枚举参数。 */
export interface CycleEnumerationOptions {
  readonly edgeTypes?: readonly AdapterEdgeType[];
  /** 环的最大长度（边数），默认 6。 */
  readonly maxLength?: number;
  /** 最多返回多少条环，默认 100。 */
  readonly limit?: number;
}

function nodeAttrs(node: GraphNode): NodeAttrs {
  return {
    label: node.label,
    role: node.type,
    tags: node.tags,
    filePath: node.filePath,
    isExported: node.properties?.isExported === true || node.properties?.is_exported === 1,
    layer: node.layer,
  };
}

function xjEdge(edge: GraphEdge): XJEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    ...(edge.weight === undefined ? {} : { weight: edge.weight }),
  };
}

/** 结点集合与边集合的图空间视图。 */
export class XuanjiAdapter {
  private space = new GraphSpace();
  /** 已注册规则名 → 索引（增量维护）。 */
  private readonly indexes = new Map<string, PathIndex>();
  private readonly rules = new Map<string, PathRule>();

  /** 用完整图装载（重建图空间；已注册规则的索引全部清空）。 */
  loadGraph(data: Pick<GraphData, 'nodes' | 'edges'>): void {
    this.space = new GraphSpace();
    for (const node of data.nodes) this.space.addNode(node.id, nodeAttrs(node));
    for (const edge of data.edges) this.space.addEdge(xjEdge(edge));
    for (const index of this.indexes.values()) index.clear();
  }

  /**
   * 增量应用 GraphDelta（璇玑图「改一字只重读经过该字的诗」）。
   *
   * - 删除边：库的 `onEdgeRemoved` 只把经过该边的物化路径标记 stale（O(k)），不重建索引；
   * - 新增边：`onEdgeAdded` 用「前缀 × 新边 × 后缀」物化新路径，长度分桶裁剪；
   * - 只有**已注册规则**才承担增量维护成本。
   */
  applyDelta(delta: GraphDelta): { addedPaths: number; stalePaths: number } {
    let addedPaths = 0;
    let stalePaths = 0;

    for (const node of delta.removedNodes) this.space.removeNode(node.id);
    for (const node of delta.addedNodes) this.space.addNode(node.id, nodeAttrs(node));
    for (const node of delta.modifiedNodes) this.space.addNode(node.id, nodeAttrs(node));

    for (const edge of delta.removedEdges) {
      const ej = xjEdge(edge);
      this.space.removeEdge(ej);
      for (const [name, index] of this.indexes) {
        const rule = this.rules.get(name);
        if (!rule) continue;
        stalePaths += onEdgeRemoved(ej, rule, index);
      }
    }

    for (const edge of delta.modifiedEdges) {
      const ej = xjEdge(edge);
      this.space.removeEdge(ej);
      for (const [name, index] of this.indexes) {
        const rule = this.rules.get(name);
        if (!rule) continue;
        stalePaths += onEdgeRemoved(ej, rule, index);
      }
      this.space.addEdge(ej);
      for (const [name, index] of this.indexes) {
        const rule = this.rules.get(name);
        if (!rule) continue;
        addedPaths += onEdgeAdded(ej, rule, this.space, index).length;
      }
    }

    for (const edge of delta.addedEdges) {
      const ej = xjEdge(edge);
      this.space.addEdge(ej);
      for (const [name, index] of this.indexes) {
        const rule = this.rules.get(name);
        if (!rule) continue;
        addedPaths += onEdgeAdded(ej, rule, this.space, index).length;
      }
    }

    return { addedPaths, stalePaths };
  }

  /** 注册一条路径规则（索引惰性创建，与 RuleRegistry 语义一致）。 */
  registerRule(rule: PathRule): PathIndex {
    this.rules.set(rule.name, rule);
    let index = this.indexes.get(rule.name);
    if (!index) {
      index = new PathIndex();
      this.indexes.set(rule.name, index);
    }
    return index;
  }

  getRule(name: string): PathRule | undefined {
    return this.rules.get(name);
  }

  getIndex(name: string): PathIndex | undefined {
    return this.indexes.get(name);
  }

  /**
   * 枚举「从 source 到 target」的简单路径（璇玑图的一种「读法」）。
   * 每次调用使用独立索引——只读查询，不承担增量维护责任。
   */
  findPathsBetween(
    source: string,
    target: string,
    options: PathEnumerationOptions = {},
  ): PathEnumerationResult {
    const edgeTypes = new Set<AdapterEdgeType>(options.edgeTypes ?? DEFAULT_PATH_EDGE_TYPES);
    const minHops = Math.max(1, options.minHops ?? 1);
    const maxHops = Math.max(minHops, options.maxHops ?? 5);
    const limit = Math.max(1, options.limit ?? 20);

    if (!this.space.hasNode(source) || !this.space.hasNode(target)) {
      return { paths: [], truncated: false, total: 0 };
    }

    const rule: PathRule = {
      name: `between:${source}->${target}`,
      version: 1,
      start: (id) => id === source,
      end: (id) => id === target,
      edgeTypes,
      lMin: minHops,
      lMax: maxHops,
      simple: true,
      normalize: 'none',
      output: (nodes) => nodes,
    };

    const index = new PathIndex();
    // limit+1 用于区分「恰好 limit 条」与「被截断」
    const entries = enumerate(this.space, rule, [source], index, { maxPaths: limit + 1 });
    const truncated = entries.length > limit;
    const kept = truncated ? entries.slice(0, limit) : entries;
    return { paths: kept.map((entry) => [...entry.nodes]), truncated, total: kept.length };
  }

  /**
   * 枚举图中的简单环（闭合路径 + Booth 规范化去重）。
   * 同一环从不同节点起读只出现一次——「同一首诗从不同字起读仍是同一首」。
   */
  cycles(options: CycleEnumerationOptions = {}): PathEnumerationResult {
    const edgeTypes = new Set<AdapterEdgeType>(options.edgeTypes ?? DEFAULT_PATH_EDGE_TYPES);
    const maxLength = Math.max(1, options.maxLength ?? 6);
    const limit = Math.max(1, options.limit ?? 100);

    const rule: PathRule = {
      name: 'cycles',
      version: 1,
      start: () => true,
      edgeTypes,
      lMin: 1,
      lMax: maxLength,
      simple: true,
      closed: true,
      normalize: 'canonical',
      output: (nodes) => nodes,
    };

    const index = new PathIndex();
    const starts = [...this.space.nodeIds()];
    const entries = enumerate(this.space, rule, starts, index, { maxPaths: limit + 1 });
    const truncated = entries.length > limit;
    const kept = truncated ? entries.slice(0, limit) : entries;
    return { paths: kept.map((entry) => [...entry.nodes]), truncated, total: kept.length };
  }

  /** 从一批起点沿边类型可正向到达的节点集合（BFS，与 DeadCodeAnalyzer 语义一致）。 */
  reachableFrom(sources: Iterable<string>, edgeTypes?: readonly AdapterEdgeType[]): Set<string> {
    const types = new Set<AdapterEdgeType>(edgeTypes ?? DEFAULT_PATH_EDGE_TYPES);
    const visited = new Set<string>();
    const queue: string[] = [];
    for (const source of sources) {
      if (!this.space.hasNode(source) || visited.has(source)) continue;
      visited.add(source);
      queue.push(source);
    }
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++]!;
      for (const next of this.space.outNeighbors(current, types)) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    return visited;
  }

  /** 图空间只读视图（测试与不变量检查用）。 */
  get graph(): GraphSpace {
    return this.space;
  }

  stats(): { nodes: number; edges: number; version: number } {
    return { nodes: this.space.nodeCount, edges: this.space.edgeCount, version: this.space.version };
  }
}
