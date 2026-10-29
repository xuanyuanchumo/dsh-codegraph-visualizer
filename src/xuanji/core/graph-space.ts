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
 * - changeLog **有界环形**（`MAX_CHANGE_LOG`），供增量引擎消费。
 *
 * ## 为什么 changeLog 必须有上界（cycle-111 / N-1）
 *
 * 旧注释写的是「changeLog append-only」，实现也确实只 push 不 pop。在 cycle-107～108 的
 * 生命周期下这是**无害**的：`XuanjiAdapter` 每次工具调用都 `new` 一次，日志随对象一起被 GC。
 * cycle-109 把 `XuanjiAdapterPool` 接进 `src/tools.ts` 之后，同一个 `GraphSpace` 改为
 * **按 repoId 常驻**，而唯一消费入口 `drainChangeLog()` 在生产侧 0 调用点——日志只进不出，
 * 随进程运行时长线性增长。同一段代码，换一个生命周期就从无害变成泄漏。
 *
 * 修法选择「加上界」而不是「让适配层 drain 后丢弃」：
 * - drain 并丢弃会把**内存缺陷换成数据丢失缺陷**——将来的真正消费者（增量重放 / 审计）
 *   会看到一份「看起来完整、其实开头被吃掉」的日志，而且没有任何信号；
 * - 加上界则保留 `drainChangeLog()` 的语义（返回自上次 drain 以来的事件），只是当未消费
 *   事件超过上界时丢弃**最旧**的，并用 {@link GraphSpace.droppedChangeEvents} 把丢弃量
 *   显式暴露出来——截断可见，与仓库「降级必须可观测」的纪律一致。
 *
 * 上界的作用域是**单个实例**：库不假设调用方会 drain，也不假设实例是短命的。
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

/**
 * 变更日志的**实例级**上限（未消费事件条数）。
 *
 * 标定依据：日志只服务增量重放与审计，没有「保留全部历史」的调用方；而池化后实例常驻，
 * 不设界就是无界增长。10 000 条足以覆盖「一次批量装载 + 若干次 delta」的重放窗口
 * （宿主一次 `graph_data` 装载的边数在千级，见 `PATH_FINDER.MAX_NODES_FOR_BFS` 的量级），
 * 又能在病态长跑下把内存钉在常数。
 *
 * 注意这是**常量而不是可选项**：让调用方自行配置上界等于允许传 `Infinity`，
 * 而那正是本项要修掉的缺陷形态。
 */
export const MAX_CHANGE_LOG = 10_000;

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
  /**
   * 未消费的变更事件。物理长度最多 `MAX_CHANGE_LOG`；`logHead` 是逻辑起点的偏移。
   *
   * 用「覆盖式环形」而不是 `push` + `splice(0, over)`：满之后每次写入都要搬动整个数组，
   * 10 000 条时单次开销已可测（本文件的首版实现就是这样，一次批量装载实测 350 ms）。
   * 环形下 record 是 O(1)，只有 drain 需要 O(n)——而 drain 本来就要复制整份结果。
   */
  private readonly log: ChangeEvent[] = [];
  /** 逻辑起点在 `log` 中的物理偏移；只在写满之后才非零。 */
  private logHead = 0;
  private _droppedChangeEvents = 0;
  private _version = 0;

  get version(): number {
    return this._version;
  }

  /**
   * 因超出 {@link MAX_CHANGE_LOG} 而被丢弃的最旧事件数（自构造/clear 起累计）。
   *
   * 存在理由：截断本身是正确性上的让步（重放窗口变小），**静默截断**会让将来的消费者
   * 把「被吃掉的日志」当成「没发生过的事」。计数必须可读：`XuanjiAdapter.stats()`
   * 把它透出到宿主面，测试也直接断言它。
   * `drainChangeLog()` 不清零它——清零会掩盖「这条适配层从未被消费过」的事实。
   */
  get droppedChangeEvents(): number {
    return this._droppedChangeEvents;
  }

  /** 当前未消费的事件条数（有界，≤ {@link MAX_CHANGE_LOG}）。 */
  get pendingChangeEvents(): number {
    return this.log.length;
  }

  /** 追加一条事件并维持上界：写满后覆盖最旧的一条。 */
  private record(event: ChangeEvent): void {
    if (this.log.length < MAX_CHANGE_LOG) {
      this.log.push(event);
      return;
    }
    // 已满：head 指向最旧的一条，就地覆盖并把它挪到下一位。
    this.log[this.logHead] = event;
    this.logHead = (this.logHead + 1) % MAX_CHANGE_LOG;
    this._droppedChangeEvents += 1;
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
      this.record({ kind: 'add-node', node: { id, attrs }, version: this._version });
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
    this.record({ kind: 'remove-node', node: { id, attrs: { label: id } }, version: this._version });
  }

  /** 幂等：同 (source,target,type) 只保留第一条。 */
  addEdge(edge: XJEdge): boolean {
    const key = edgeKey(edge.source, edge.target, edge.type);
    if (this.edgeMap.has(key)) return false;
    this.edgeMap.set(key, edge);
    this.pushAdj(this.outAdj, edge.source, edge.type, edge.target);
    this.pushAdj(this.inAdj, edge.target, edge.type, edge.source);
    this._version++;
    this.record({ kind: 'add-edge', edge, version: this._version });
    return true;
  }

  removeEdge(edge: XJEdge): boolean {
    const key = edgeKey(edge.source, edge.target, edge.type);
    if (!this.edgeMap.has(key)) return false;
    this.edgeMap.delete(key);
    this.popAdj(this.outAdj, edge.source, edge.type, edge.target);
    this.popAdj(this.inAdj, edge.target, edge.type, edge.source);
    this._version++;
    this.record({ kind: 'remove-edge', edge, version: this._version });
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

  /**
   * 消费变更日志（增量引擎接管后清空）。
   *
   * 语义保持不变：返回**自上次 drain 以来仍保留**的事件，顺序即写入序，`version` 严格递增。
   * 唯一的差异是日志有上界——若期间发生溢出，返回数组会比「事件真实条数」短，
   * 差额由 {@link droppedChangeEvents} 给出（截断可见，不静默）。
   * 被丢弃的**只会是最旧的**事件，所以返回序列本身仍是连续且单调的。
   */
  drainChangeLog(): ChangeEvent[] {
    // 环形的逻辑序 = [head..末尾] + [0..head)：复制时一次性拉直，调用方拿到的仍是普通数组。
    const drained =
      this.logHead === 0
        ? [...this.log]
        : [...this.log.slice(this.logHead), ...this.log.slice(0, this.logHead)];
    this.log.length = 0;
    this.logHead = 0;
    return drained;
  }

  clear(): void {
    this.nodes.clear();
    this.outAdj.clear();
    this.inAdj.clear();
    this.edgeMap.clear();
    this.log.length = 0;
    this.logHead = 0;
    // 丢弃计数随图本身归零：clear 之后这个实例等于新建，旧实例的截断历史不再属于它。
    this._droppedChangeEvents = 0;
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
