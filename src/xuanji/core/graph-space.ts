/**
 * 图空间 G = (V, E, Σ, τ, A)。
 *
 * 璇玑图原型：一方 29×29 的字格锦缎。所有「读法」（路径规则）共享同一个图空间，
 * 图空间只负责存储与邻接遍历，不解释语义（spec §4.1）。
 *
 * 关键契约：
 * - 边键为 `source->target->type`（多重边按类型区分，同型同端幂等）；
 * - outAdj / inAdj 都按边类型分桶，路径规则的边谓词 Φ 取对应子数组即 O(1) 裁剪；
 * - version 单调递增，供 PathEntry 版本一致性与不变量 I5 使用；
 * - changeLog append-only，供增量引擎消费。
 *
 * 零宿主依赖：库内只用 string 标识，不感知 cytoscape / graphology / branded type。
 *
 * @module xuanji/core/graph-space
 */

/** 节点标识（库内为 string，不依赖宿主的 branded type）。 */
export type NodeId = string;
/** 边标识（库内仅用于追踪，不参与路径语义）。 */
export type EdgeId = string;
/** 边类型（对应 Σ）。 */
export type EdgeType = string;

/** 节点属性：库只存不解释。 */
export interface NodeAttrs {
  readonly label: string;
  /** 角色（起点谓词 S 常用）。 */
  readonly role?: string;
  /** 标签集合（节点约束 Ψ 常用）。 */
  readonly tags?: readonly string[];
  /** 其它宿主属性，库原样保留。 */
  readonly [key: string]: unknown;
}

/** 一条有向边。 */
export interface XJEdge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly type: EdgeType;
  readonly weight?: number;
}

/** 变更事件（append-only，增量引擎的输入）。 */
export interface ChangeEvent {
  readonly kind: 'add-node' | 'remove-node' | 'add-edge' | 'remove-edge';
  readonly edge?: XJEdge;
  readonly node?: { readonly id: NodeId; readonly attrs: NodeAttrs };
  readonly version: number;
}

/** 边键：多重边按类型区分（spec §4.1 契约）。 */
export function edgeKey(source: NodeId, target: NodeId, type: EdgeType): string {
  return `${source}->${target}->${type}`;
}

/**
 * 图空间。构造后通过 addNode/addEdge 填充，或由宿主适配层一次性装载。
 *
 * 复杂度：构建 O(V+E)，按类型取邻接 O(|Σ_filter| + deg)，边查 O(1)。
 */
export class GraphSpace {
  private readonly nodes = new Map<NodeId, NodeAttrs>();
  /** outAdj[node][edgeType] = 目标节点列表（同型同端去重）。 */
  private readonly outAdj = new Map<NodeId, Map<EdgeType, NodeId[]>>();
  /** inAdj[node][edgeType] = 来源节点列表（前缀枚举必需，spec §4.1 契约）。 */
  private readonly inAdj = new Map<NodeId, Map<EdgeType, NodeId[]>>();
  private readonly edgeMap = new Map<string, XJEdge>();
  private readonly log: ChangeEvent[] = [];
  private _version = 0;

  get version(): number {
    return this._version;
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edgeMap.size;
  }

  addNode(id: NodeId, attrs: NodeAttrs): void {
    const isNew = !this.nodes.has(id);
    this.nodes.set(id, attrs);
    if (isNew) {
      // 版本号只为「结构变化」递增：属性覆盖不改变可达性
      this._version++;
      this.log.push({ kind: 'add-node', node: { id, attrs }, version: this._version });
    }
  }

  removeNode(id: NodeId): void {
    if (!this.nodes.has(id)) return;
    // 先删除相邻边（否则邻接表指向不存在的节点，不变量 I5 会报不一致）
    for (const type of this.edgeTypesOf('out', id)) {
      // Array.from 取快照：removeEdge 会 splice 同一数组，直接迭代会跳过元素
      for (const target of Array.from(this.outAdj.get(id)?.get(type) ?? [])) {
        const edge = this.edgeMap.get(edgeKey(id, target, type));
        if (edge) this.removeEdge(edge);
      }
    }
    for (const type of this.edgeTypesOf('in', id)) {
      for (const source of Array.from(this.inAdj.get(id)?.get(type) ?? [])) {
        const edge = this.edgeMap.get(edgeKey(source, id, type));
        if (edge) this.removeEdge(edge);
      }
    }
    this.nodes.delete(id);
    this._version++;
    this.log.push({ kind: 'remove-node', node: { id, attrs: { label: id } }, version: this._version });
  }

  /** 幂等：同 (source,target,type) 只保留第一条。 */
  addEdge(edge: XJEdge): boolean {
    const key = edgeKey(edge.source, edge.target, edge.type);
    if (this.edgeMap.has(key)) return false;
    this.edgeMap.set(key, edge);
    this.pushAdj(this.outAdj, edge.source, edge.type, edge.target);
    this.pushAdj(this.inAdj, edge.target, edge.type, edge.source);
    this._version++;
    this.log.push({ kind: 'add-edge', edge, version: this._version });
    return true;
  }

  removeEdge(edge: XJEdge): boolean {
    const key = edgeKey(edge.source, edge.target, edge.type);
    if (!this.edgeMap.has(key)) return false;
    this.edgeMap.delete(key);
    this.popAdj(this.outAdj, edge.source, edge.type, edge.target);
    this.popAdj(this.inAdj, edge.target, edge.type, edge.source);
    this._version++;
    this.log.push({ kind: 'remove-edge', edge, version: this._version });
    return true;
  }

  hasNode(id: NodeId): boolean {
    return this.nodes.has(id);
  }

  hasEdge(source: NodeId, target: NodeId, type: EdgeType): boolean {
    return this.edgeMap.has(edgeKey(source, target, type));
  }

  getEdge(source: NodeId, target: NodeId, type: EdgeType): XJEdge | undefined {
    return this.edgeMap.get(edgeKey(source, target, type));
  }

  /** 是否存在 u→v 的任一 type ∈ types 的边（规则判据用，O(|types|)）。 */
  hasEdgeOfType(source: NodeId, target: NodeId, types: ReadonlySet<EdgeType>): boolean {
    for (const type of types) {
      if (this.edgeMap.has(edgeKey(source, target, type))) return true;
    }
    return false;
  }

  getNodeAttrs(id: NodeId): NodeAttrs | undefined {
    return this.nodes.get(id);
  }

  /** 所有节点 id（插入序）。 */
  nodeIds(): IterableIterator<NodeId> {
    return this.nodes.keys();
  }

  /** 所有边（插入序）。 */
  edges(): IterableIterator<XJEdge> {
    return this.edgeMap.values();
  }

  /** 图中出现过的全部边类型 Σ。 */
  edgeTypes(): ReadonlySet<EdgeType> {
    const types = new Set<EdgeType>();
    for (const edge of this.edgeMap.values()) types.add(edge.type);
    return types;
  }

  /**
   * 按类型过滤的出边目标（去重、插入序）。
   * types 为空集时返回空数组——空规则不吞噬全图（spec §八）。
   */
  outNeighbors(node: NodeId, types: ReadonlySet<EdgeType>): NodeId[] {
    return this.filtered(this.outAdj, node, types);
  }

  /** 按类型过滤的入边来源（去重、插入序）。 */
  inNeighbors(node: NodeId, types: ReadonlySet<EdgeType>): NodeId[] {
    return this.filtered(this.inAdj, node, types);
  }

  /** 该节点某方向上的边类型集合（removeNode 清理用）。 */
  private edgeTypesOf(dir: 'in' | 'out', id: NodeId): EdgeType[] {
    const adj = dir === 'out' ? this.outAdj : this.inAdj;
    const byType = adj.get(id);
    return byType ? [...byType.keys()] : [];
  }

  /** 消费变更日志（增量引擎接管后清空）。 */
  drainChangeLog(): ChangeEvent[] {
    const drained = [...this.log];
    this.log.length = 0;
    return drained;
  }

  clear(): void {
    this.nodes.clear();
    this.outAdj.clear();
    this.inAdj.clear();
    this.edgeMap.clear();
    this.log.length = 0;
    this._version = 0;
  }

  private filtered(
    adj: Map<NodeId, Map<EdgeType, NodeId[]>>,
    node: NodeId,
    types: ReadonlySet<EdgeType>,
  ): NodeId[] {
    const byType = adj.get(node);
    if (!byType || types.size === 0) return [];
    const seen = new Set<NodeId>();
    const result: NodeId[] = [];
    for (const type of types) {
      const list = byType.get(type);
      if (!list) continue;
      for (const target of list) {
        if (seen.has(target)) continue;
        seen.add(target);
        result.push(target);
      }
    }
    return result;
  }

  private pushAdj(
    adj: Map<NodeId, Map<EdgeType, NodeId[]>>,
    node: NodeId,
    type: EdgeType,
    other: NodeId,
  ): void {
    let byType = adj.get(node);
    if (!byType) {
      byType = new Map();
      adj.set(node, byType);
    }
    let list = byType.get(type);
    if (!list) {
      list = [];
      byType.set(type, list);
    }
    if (!list.includes(other)) list.push(other);
  }

  private popAdj(
    adj: Map<NodeId, Map<EdgeType, NodeId[]>>,
    node: NodeId,
    type: EdgeType,
    other: NodeId,
  ): void {
    const byType = adj.get(node);
    if (!byType) return;
    const list = byType.get(type);
    if (!list) return;
    const idx = list.indexOf(other);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) byType.delete(type);
    if (byType.size === 0) adj.delete(node);
  }
}
