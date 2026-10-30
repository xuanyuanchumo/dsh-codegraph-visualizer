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
 * cycle-109（XJ-02 / XJ-04 / XJ-05）在这一层补上三件事：
 * 1. {@link XuanjiAdapterPool}：按 repoId 缓存 adapter（LRU），让「同一个图空间」能被
 *    反复查询而不是每次重建；{@link XuanjiAdapter.syncGraph} 给出 `'full' | 'delta' | 'none'`
 *    的判定（判定结果作为返回值暴露，便于测试与观测）。
 *    判定原则：**不确定就全量重建**——缓存陈旧会直接返回过期路径，宁可慢不可错。
 * 2. `applyDelta` 在 stale 比例超阈值时清空该规则的索引并把它写进 `degradedRules`，
 *    「需全量重枚举」从一句注释变成一个可观测的返回值。
 * 3. 静态校验落地在一条**公共**的 {@link XuanjiAdapter.validateRule} 上：
 *    `registerRule` 用它做注册闸门（errors 非空 ⇒ 不注册，返回 `{ index, validation }`），
 *    两条内联读法规则用它做**每次枚举都执行**的闸门（`findPathsBetween` / `cycles` →
 *    {@link XuanjiAdapter.assertRule}）。生产环境（`src/` 内）的必然校验调用是后者；
 *    `registerRule` 目前没有生产调用点，保留给宿主程序化注册/测试，不当成「唯一入口」。
 *
 * @module shared/analysis/XuanjiAdapter
 */

import type { GraphData, GraphDelta, GraphEdge, GraphNode } from '../../types/index.ts';
import { GraphSpace, type NodeAttrs, type XJEdge } from '../../xuanji/core/graph-space.ts';
import type { PathRule, RuleValidation } from '../../xuanji/core/path-rule.ts';
import { RuleCompositionError, validateRule as validateRuleSpec } from '../../xuanji/core/path-rule.ts';
import { PathIndex } from '../../xuanji/index/path-index.ts';
import {
  DEFAULT_THETA_STALE,
  onEdgeAdded,
  onEdgeRemovedDetailed,
  wasLastIncrementalDegraded,
} from '../../xuanji/index/incremental.ts';
import {
  InvariantChecker,
  type InvariantResult,
  type InvariantThresholds,
} from '../../xuanji/ops/invariants.ts';
import { enumerate, readPathPage } from '../../xuanji/query/query-engine.ts';

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
  /** 分页游标（已返回条数；缺省 0）。XJ-03：翻页用上一页的 `nextCursor`。 */
  readonly cursor?: number;
  /** 每页条数（缺省等于 `limit`）。 */
  readonly pageSize?: number;
  /**
   * 截断策略（cycle-112 继承项 A：`top-k-weight` 此前只有单元测试可达——
   * `grep -rn truncation src/ | grep -v xuanji` = 0，生产两处 `enumerate` 都只传
   * `{maxPaths}`）。透传给库的 `EnumerateOptions.truncation`：
   * - `'dfs-order'`（缺省）：达到条数上限即停，按 DFS 序（确定、可复现）；
   * - `'top-k-weight'`：先枚举全部候选再按**边权重之和**降序取前 k——
   *   注意它必须**看完所有候选**才知道哪 k 条最高（候选集超 `TOP_K_CANDIDATE_BUDGET`
   *   时库会抛 `RuleCompositionError`），大图上显著更慢，调用方应缩小 `lMax` 或边类型
   *   集合后再用。
   */
  readonly truncation?: 'dfs-order' | 'top-k-weight';
}

/** 路径枚举结果。 */
export interface PathEnumerationResult {
  /** 每条路径是节点 id 序列（含首尾）。 */
  readonly paths: string[][];
  /** 是否因 limit 截断。 */
  readonly truncated: boolean;
  /** 实际返回条数。 */
  readonly total: number;
  /**
   * Ω 惰性输出：本页每条路径经过规则 `output` 映射后的值（XJ-03）。
   * 只对**当前页**求值；旧调用方可以完全忽略这个字段（可选）。
   */
  readonly labels?: readonly unknown[];
  /** 下一页游标；`null` 表示没有更多（XJ-03）。不传分页参数时也会给出。 */
  readonly nextCursor?: number | null;
}

/** 环枚举参数。 */
export interface CycleEnumerationOptions {
  readonly edgeTypes?: readonly AdapterEdgeType[];
  /** 环的最大长度（边数），默认 6。 */
  readonly maxLength?: number;
  /** 最多返回多少条环，默认 100。 */
  readonly limit?: number;
  /** 分页游标（已返回条数；缺省 0）。 */
  readonly cursor?: number;
  /** 每页条数（缺省等于 `limit`）。 */
  readonly pageSize?: number;
}

/**
 * `syncGraph` 能接受的图数据：`GraphData` 的子集 + 可选的 metadata。
 * 写成结构子集而不是 `GraphData`，是为了让只关心 nodes/edges 的调用方（测试、增量重放）
 * 不必伪造 `repoId` / `nodeCount` 等字段。
 */
export type SyncGraphInput = Pick<GraphData, 'nodes' | 'edges'> & {
  readonly metadata?: { readonly timestamp?: number };
};

/**
 * `syncGraph` 的判定结果：
 * - `'none'`：适配层已持有同一个图（结构逐节点/逐边一致），既不重载也不动索引；
 * - `'delta'`：新图是当前图的**纯增补**（旧节点/边全在，且属性未变），只应用增量；
 * - `'full'`：其余一切情况（首次装载、删除、属性变化、无法确认）——全量重建。
 *
 * 三种结果的正确性一律优先于性能：只有能**证明**增量等价时才走 `'delta'`/`'none'`。
 */
export type SyncGraphOutcome = 'full' | 'delta' | 'none';

/** `registerRule` 的返回：索引（未注册时为 null）与静态校验结果。 */
export interface RuleRegistration {
  /** 索引实例；`validation.errors` 非空时为 null（规则未被注册）。 */
  readonly index: PathIndex | null;
  readonly validation: RuleValidation;
}

/** `applyDelta` 的结果（XJ-04：`degradedRules` 是本轮被降级重建的规则名）。 */
export interface DeltaApplicationResult {
  readonly addedPaths: number;
  readonly stalePaths: number;
  /** stale 超阈值 / 增量超预算而**被清空**的规则名：这些索引需全量重枚举。 */
  readonly degradedRules: readonly string[];
  /** 本轮 I4 体检的逐规则结论（XJ-04 第 3 步 / D-10）。 */
  readonly invariants: DeltaInvariantReport;
}

/** {@link XuanjiAdapterPool.applyDelta} 的结果。 */
export interface PoolDeltaResult extends DeltaApplicationResult {
  /** delta 是否真的被应用到缓存的适配层（基线不匹配 / 尚未装载时为 false）。 */
  readonly applied: boolean;
}

/**
 * 本轮 `applyDelta` 跑到的 I4 不变量结论（XJ-04 第 3 步 / D-10）。
 *
 * 为什么把结论**返回**而不是只写日志：`degradedRules` 只能回答「最后有没有被降级」，
 * 无法区分「规则本来就没有条目（total=0）」与「有 40% 失效但阈值仍放行」。
 * 两者对调用方的意义完全不同，而 `InvariantResult.detail` 里恰好带着
 * `stale/total = 3/10 = 0.300` 这种可直接内省的事实。
 */
export interface DeltaInvariantReport {
  /** 规则名 → I4 结论（按规则首次注册序）。 */
  readonly byRule: ReadonlyMap<string, InvariantResult>;
  /** I4 判为不达标的规则名（它们同时也是 elapsed 的 `degradedRules` 成员）。 */
  readonly violated: readonly string[];
}

/** 未应用 delta 的固定返回（不可变，避免调用方误改共享对象）。 */
const DELTA_SKIPPED: PoolDeltaResult = Object.freeze({
  applied: false,
  addedPaths: 0,
  stalePaths: 0,
  degradedRules: Object.freeze([]) as readonly string[],
  // 没跑过就没有结论：空 map 而不是「全 ok」，否则调用方无法区分
  // 「体检通过」与「根本没体检」（本项目反复出现的「空集冒充全绿」形态）。
  invariants: Object.freeze({
    byRule: new Map<string, InvariantResult>(),
    violated: Object.freeze([]) as readonly string[],
  }) as DeltaInvariantReport,
});

/** 空枚举结果的固定返回。 */
const EMPTY_PATH_RESULT: PathEnumerationResult = Object.freeze({
  paths: [] as string[][],
  truncated: false,
  total: 0,
});

/** 一次装载的结构戳：只用于**快路径**，真正的等价判定见 `diffAgainstSpace`。 */
interface SyncStamp {
  readonly timestamp: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
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

/** 图空间里已存的属性与新节点的属性是否一致（不一致就不能走增量：属性参与规则谓词）。 */
function attrsEqual(stored: NodeAttrs, next: NodeAttrs): boolean {
  if (
    stored.label !== next.label ||
    stored.role !== next.role ||
    stored.filePath !== next.filePath ||
    stored.isExported !== next.isExported ||
    stored.layer !== next.layer
  ) {
    return false;
  }
  const a = stored.tags ?? [];
  const b = next.tags ?? [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 结构戳；没有可用 timestamp 时返回 null（快路径失效，只能走结构比较）。 */
function stampOf(data: SyncGraphInput): SyncStamp | null {
  const timestamp = data.metadata?.timestamp;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  return { timestamp, nodeCount: data.nodes.length, edgeCount: data.edges.length };
}

/**
 * 与当前图空间的三向结构比较结果：
 * - `identical`：逐节点属性 + 逐边三元组完全一致；
 * - `additive`：旧节点/边全都还在且属性未变，只是多出了新节点/新边；
 * - `incompatible`：删除了节点或边、或有关键属性变化 —— 只能全量重建。
 */
type SpaceDiff =
  | { kind: 'identical' }
  | { kind: 'additive'; addedNodes: GraphNode[]; addedEdges: GraphEdge[] }
  | { kind: 'incompatible' };

/**
 * 结点集合与边集合的图空间视图。
 *
 * ## XJ-04 第 3 步 / D-10：`InvariantChecker` 在本层的接线点（cycle-111）
 *
 * `applyDelta` 末尾对**每条已注册规则**跑 I4（stale 比例），不达标即入 `degradedRules`
 * 并清空该索引。这不是「为了花掉一个死符号」的仪式：接线前必须先修一条真缺陷——
 *
 * **删节点从来没有在索引上留下任何痕迹**。旧实现只做 `space.removeNode(id)`，而
 * `removeNode` 内部删掉的相邻边**不经过** `dropEdge`，于是 `index.counters.stale` 纹丝不动。
 * 实测（3 节点 a→b→c、物化 2 条路径后删 b）：`counters = {total: 2, stale: 0}`，
 * 而索引里两条条目都指向已不存在的 b。I4 读的正是这两个计数，所以它会对一个**全线失效**
 * 的索引给出 `ok: true`——分母含 stale 却看不出失效，与 `incremental.ts` 里
 * 「用过滤后的 live 当分母，于是 0% 失效」是同一个坑的镜像。
 *
 * 因此这里的删节点分支改成：先按真实邻接**逐边走 `dropEdge`**（与删边同一条 stale 通道），
 * 再删节点。I4 随后读到的是全量口径（`counters.total` 做分母，含已 stale 的条目），
 * 与 `onEdgeRemovedDetailed` 同源。
 *
 * 与 `onEdgeRemovedDetailed` 的关系要说清楚，否则会觉得这道检查是重复的：两者阈值同为
 * `0.3`，在**纯删边**的 delta 上判定等价；I4 真正多覆盖的是「删/改节点」以及
 * 「一次 delta 里多种变更叠加后的终态」——那时的失效不是任何单条边删除的结论。
 */
export class XuanjiAdapter {
  private space = new GraphSpace();
  /** 已注册规则名 → 索引（增量维护）。 */
  private readonly indexes = new Map<string, PathIndex>();
  private readonly rules = new Map<string, PathRule>();
  /** 是否装载过图（首次装载必须全量，不能只靠 delta 拼出来）。 */
  private loaded = false;
  /** 最近一次「适配层 == 某份图数据」的结构戳；applyDelta 后必然作废。 */
  private lastSyncStamp: SyncStamp | null = null;
  /** 最近一次 `applyDelta` 的 I4 结论（见 {@link lastInvariantReport}）。 */
  private lastInvariants: DeltaInvariantReport | null = null;
  /** I4 的阈值。缺省 `thetaStale` 与增量引擎的 `DEFAULT_THETA_STALE` 取同一个常量。 */
  private readonly invariantThresholds: InvariantThresholds;

  /**
   * @param thresholds I4/I3 阈值；`thetaStale` 缺省复用 `DEFAULT_THETA_STALE`（0.3）。
   * 复用而非另写字面量：两处阈值一旦分叉，就会出现「增量引擎说该重建、不变量说还健康」
   * 的自相矛盾，而两者都自称是 stale 比例的判据。
   */
  constructor(thresholds: InvariantThresholds = {}) {
    this.invariantThresholds = {
      thetaStale: thresholds.thetaStale ?? DEFAULT_THETA_STALE,
      ...(thresholds.thetaDepth === undefined ? {} : { thetaDepth: thresholds.thetaDepth }),
    };
  }

  /** 图空间是否已装载过。未装载时 delta 无基线可依，池层必须拒绝应用。 */
  get isReady(): boolean {
    return this.loaded;
  }

  /**
   * 用完整图装载（重建图空间；已注册规则的索引全部清空）。
   *
   * 任何「无法证明与当前图等价」的数据都必须走这里（宁可慢不可错）。
   */
  loadGraph(data: SyncGraphInput): void {
    this.space = new GraphSpace();
    for (const node of data.nodes) this.space.addNode(node.id, nodeAttrs(node));
    for (const edge of data.edges) this.space.addEdge(xjEdge(edge));
    for (const index of this.indexes.values()) index.clear();
    this.loaded = true;
    this.lastSyncStamp = stampOf(data);
  }

  /**
   * 把适配层同步到 `data`，返回实际采取的同步方式（`'full' | 'delta' | 'none'`）。
   *
   * 判定顺序（每一步都要求「能证明等价」，否则落到 `'full'`）：
   * 1. 从未装载 ⇒ `'full'`；
   * 2. 结构戳（timestamp + 规模）相同 ⇒ `'none'`（快路径）；
   * 3. 与图空间逐节点属性、逐边三元组比较：
   *    - 完全一致 ⇒ `'none'`（timestamp 变了但图没变，**不得**因缓存陈旧返回旧路径，
   *      这里因为等价所以复用是安全的）；
   *    - 纯增补 ⇒ 用一条真实 delta（新增节点/新增边）走 `applyDelta` ⇒ `'delta'`；
   *    - 其余（删除 / 属性变化 / 悬空边）⇒ `loadGraph` ⇒ `'full'`。
   *
   * 返回值是给调用方与测试看的**判定证据**：拿不到 `'none'` 就说明每次都在重建。
   */
  syncGraph(data: SyncGraphInput): SyncGraphOutcome {
    if (!this.loaded) {
      this.loadGraph(data);
      return 'full';
    }

    const stamp = stampOf(data);
    if (stamp && this.lastSyncStamp && this.sameStamp(stamp, this.lastSyncStamp)) {
      return 'none';
    }

    const diff = this.diffAgainstSpace(data);
    if (diff.kind === 'identical') {
      // 结构相同 ⇒ 复用现有空间与索引是安全的；只刷新戳，避免下次再付一遍结构比较。
      this.lastSyncStamp = stamp;
      return 'none';
    }

    if (diff.kind === 'additive') {
      this.applyDelta({
        addedNodes: diff.addedNodes,
        removedNodes: [],
        modifiedNodes: [],
        addedEdges: diff.addedEdges,
        removedEdges: [],
        modifiedEdges: [],
      });
      // applyDelta 内部会作废 lastSyncStamp（空间已不再等于任何已知修订），这里重新钉住。
      this.lastSyncStamp = stamp;
      return 'delta';
    }

    this.loadGraph(data);
    return 'full';
  }

  /**
   * 增量应用 GraphDelta（璇玑图「改一字只重读经过该字的诗」）。
   *
   * - 删除边：库的 `onEdgeRemovedDetailed` 只把经过该边的物化路径标记 stale（O(k)），不重建索引；
   * - 新增边：`onEdgeAdded` 用「前缀 × 新边 × 后缀」物化新路径，长度分桶裁剪；
   * - 只有**已注册规则**才承担增量维护成本；
   * - XJ-04：某条规则的 stale 比例 > 0.3（或增量枚举超出工作预算）时，其索引被清空并记入
   *   `degradedRules`，本次 delta 内不再向它增量写入——留一个「空索引」比留一个「看起来完整、
   *   实际只含新边路径」的半成品安全（查询层据此回退全量枚举）。
   */
  applyDelta(delta: GraphDelta): DeltaApplicationResult {
    let addedPaths = 0;
    let stalePaths = 0;
    const degraded = new Set<string>();

    // 增量之后图空间不再等于任何已知修订：快路径戳必须作废，否则 syncGraph 会把旧戳当最新。
    this.lastSyncStamp = null;

    const retire = (name: string, index: PathIndex): void => {
      index.clear();
      degraded.add(name);
    };

    const dropEdge = (ej: XJEdge): void => {
      this.space.removeEdge(ej);
      for (const [name, index] of this.indexes) {
        if (degraded.has(name)) continue;
        const rule = this.rules.get(name);
        if (!rule) continue;
        const outcome = onEdgeRemovedDetailed(ej, rule, index);
        stalePaths += outcome.newlyStale;
        if (outcome.needsRebuild) retire(name, index);
      }
    };

    const addEdge = (ej: XJEdge): void => {
      this.space.addEdge(ej);
      for (const [name, index] of this.indexes) {
        if (degraded.has(name)) continue;
        const rule = this.rules.get(name);
        if (!rule) continue;
        addedPaths += onEdgeAdded(ej, rule, this.space, index).length;
        // 预算降级时 onEdgeAdded 已自行 clear()；这里把它记入 degradedRules 并停止后续写入。
        // XJ-11：读**该索引**的实例态（不是模块级全局），否则两条规则 / 两个仓库并发时
        // A 的降级会被 B 的正常调用清掉。
        if (wasLastIncrementalDegraded(index)) degraded.add(name);
      }
    };

    // 删节点必须**先按真实邻边逐条走 dropEdge**：GraphSpace.removeNode 内部删掉的相邻边
    // 不经过上面那条 stale 通道（实测 counters.stale 纹丝不动），于是索引会留下指向已删
    // 节点的条目而 I4 仍报健康。取删除前的邻接快照，逐条构造出等价的 XJEdge 再走 dropEdge。
    for (const node of delta.removedNodes) {
      for (const ej of this.incidentEdges(node.id)) dropEdge(ej);
      this.space.removeNode(node.id);
    }
    for (const node of delta.addedNodes) this.space.addNode(node.id, nodeAttrs(node));
    for (const node of delta.modifiedNodes) this.space.addNode(node.id, nodeAttrs(node));

    for (const edge of delta.removedEdges) dropEdge(xjEdge(edge));

    for (const edge of delta.modifiedEdges) {
      const ej = xjEdge(edge);
      dropEdge(ej);
      addEdge(ej);
    }

    for (const edge of delta.addedEdges) addEdge(xjEdge(edge));

    // XJ-04 第 3 步：所有变更落地后，用 I4 对自己的索引做一次体检。
    // 放在最后而不是每条边上：I4 问的是「这条规则现在还能不能用」，那是 delta 的**终态**。
    const invariants = this.checkStaleInvariant(degraded);

    return { addedPaths, stalePaths, degradedRules: [...degraded], invariants };
  }

  /** 最近一次 `applyDelta` 的 I4 结论（未跑过时为 null）。 */
  get lastInvariantReport(): DeltaInvariantReport | null {
    return this.lastInvariants;
  }

  /**
   * 对每条已注册规则跑 I4，把不达标者清空并记入 `degraded`。
   *
   * 分母口径：`InvariantChecker.checkI4` 内部用 `index.counters.total`——**含已 stale 的条目**，
   * 与 `incremental.ts` 的 `onEdgeRemovedDetailed` 完全同源。用 `liveCount()` 当分母是这一族
   * 缺陷的复发形态（一个全部失效的索引会被算成 0% 失效，阈值永不触发）。
   *
   * 已被其它原因降级（stale 超阈 / 预算超限）的规则不重复检查：它们的索引已是空的
   * （`retire` 里 `clear()` 过，total=0 ⇒ 比率按 0 处理），再跑一次只会得到一条
   * 无信息的 ok:true，反而稀释了 `byRule` 的可读性。
   */
  private checkStaleInvariant(degraded: Set<string>): DeltaInvariantReport {
    const byRule = new Map<string, InvariantResult>();
    const violated: string[] = [];
    const checker = new InvariantChecker(this.invariantThresholds);
    for (const [name, index] of this.indexes) {
      if (degraded.has(name)) continue;
      const result = checker.checkI4(index);
      byRule.set(name, result);
      if (!result.ok) {
        // 与 stale 超阈走同一个动作：留空索引好过留半成品。
        index.clear();
        degraded.add(name);
        violated.push(name);
      }
    }
    this.lastInvariants = { byRule, violated };
    return this.lastInvariants;
  }

  /**
   * 某个节点当前的**全部**相邻边快照（出边 + 入边），用于「删节点前先逐条失效」。
   *
   * 必须是快照：`dropEdge` 会改动邻接表，边遍历边删会漏掉元素（与 `GraphSpace.removeNode`
   * 里 `Array.from` 的理由相同）。
   */
  private incidentEdges(nodeId: string): XJEdge[] {
    const types = this.space.edgeTypes();
    const edges: XJEdge[] = [];
    for (const target of this.space.outNeighbors(nodeId, types)) {
      for (const type of types) {
        const edge = this.space.getEdge(nodeId, target, type);
        if (edge) edges.push(edge);
      }
    }
    for (const source of this.space.inNeighbors(nodeId, types)) {
      for (const type of types) {
        const edge = this.space.getEdge(source, nodeId, type);
        if (edge) edges.push(edge);
      }
    }
    return edges;
  }

  /**
   * 当前图空间是否**包含** delta 的基线（删除/修改的条目都在，新增边的端点可解析）。
   *
   * 用于池层决定「这条 delta 能不能安全应用到缓存的适配层」：delta 只对它被计算出来的
   * 那个修订有意义，基线不匹配时应用会把两版图混在一起，因此宁可丢弃缓存重建。
   */
  canApplyDelta(delta: GraphDelta): boolean {
    for (const node of delta.removedNodes) if (!this.space.hasNode(node.id)) return false;
    for (const node of delta.modifiedNodes) if (!this.space.hasNode(node.id)) return false;
    for (const edge of delta.removedEdges) {
      if (!this.space.hasEdge(edge.source, edge.target, edge.type)) return false;
    }
    for (const edge of delta.modifiedEdges) {
      if (!this.space.hasEdge(edge.source, edge.target, edge.type)) return false;
    }
    const addedNodeIds = new Set<string>(delta.addedNodes.map((node) => node.id));
    for (const edge of [...delta.addedEdges, ...delta.modifiedEdges]) {
      if (!this.space.hasNode(edge.source) && !addedNodeIds.has(edge.source)) return false;
      if (!this.space.hasNode(edge.target) && !addedNodeIds.has(edge.target)) return false;
    }
    return true;
  }

  /**
   * 用 `validateRule` 校验一条规则（spec §3.4），返回原始 errors / warnings。
   *
   * XJ-05 的**公共校验面**：两处调用者——
   * 1. {@link registerRule}（程序化注册闸门，errors 非空则不注册）；
   * 2. {@link assertRule}（内联读法闸门，`findPathsBetween` / `cycles` 每次调用都走它）。
   *
   * 刻意做成 public 而不是 private：验收断言要能在运行时证明「生产枚举路径上
   * 确实执行了校验」，公共方法可以被 spy，私有方法只能靠猜。
   *
   * @param graph 用于取 Σ 与 |V| 的图空间（缺省为本适配层已装载的空间）
   */
  validateRule(rule: PathRule, graph?: GraphSpace): RuleValidation {
    const space = graph ?? this.space;
    return validateRuleSpec(rule, space.edgeTypes(), space.nodeCount);
  }

  /**
   * 注册一条路径规则（索引惰性创建，与 RuleRegistry 语义一致）。
   *
   * XJ-05：errors 非空 ⇒ 规则不进入规则表、不建索引，`index` 返回 null（warnings 原样透传）。
   * 已存在的同名规则不会被非法注册覆盖。
   *
   * 如实说明：**`registerRule` 目前在 `src/` 内没有生产调用点**（`graph_path_enumerate` /
   * `graph_cycles` 用的是内联读法规则，见 {@link assertRule}），它是保留给宿主程序化注册
   * 与测试的 API。生产上的必然校验关口是 `assertRule`，不要把它当成「唯一入口」。
   *
   * @param graph 用于校验的图空间（缺省为本适配层已装载的空间）
   */
  registerRule(rule: PathRule, graph?: GraphSpace): RuleRegistration {
    const validation = this.validateRule(rule, graph);
    if (validation.errors.length > 0) return { index: null, validation };

    this.rules.set(rule.name, rule);
    let index = this.indexes.get(rule.name);
    if (!index) {
      index = new PathIndex();
      this.indexes.set(rule.name, index);
    }
    return { index, validation };
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
   *
   * XJ-03：返回值经库的 {@link readPathPage} 组装，因此带 `labels`（Ω 惰性输出，
   * 只对当前页求值）与 `nextCursor`（分页）。不传 `cursor`/`pageSize` 时
   * `paths` / `truncated` / `total` 三个旧字段与改造前逐元素一致。
   */
  findPathsBetween(
    source: string,
    target: string,
    options: PathEnumerationOptions = {},
  ): PathEnumerationResult {
    const minHops = Math.max(1, options.minHops ?? 1);
    const maxHops = Math.max(minHops, options.maxHops ?? 5);
    const limit = Math.max(1, options.limit ?? 20);
    const cursor = Math.max(0, Math.floor(options.cursor ?? 0));
    const pageSize = Math.max(1, Math.floor(options.pageSize ?? limit));

    if (!this.space.hasNode(source) || !this.space.hasNode(target)) return EMPTY_PATH_RESULT;

    // 读法只能走图里真实存在的边类型：请求了图中没有的类型（如 'extend'）本来就走不通，
    // 先裁剪掉，既保持结果不变，也让这条内联规则能通过 registerRule 同源的校验闸门。
    const edgeTypes = this.presentEdgeTypes(options.edgeTypes ?? DEFAULT_PATH_EDGE_TYPES);
    if (edgeTypes.size === 0) return EMPTY_PATH_RESULT;

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
    this.assertRule(rule);

    const index = new PathIndex();
    // 多枚举一条用于区分「恰好 limit 条」与「被截断」；分页时窗口终点是 cursor + pageSize。
    // truncation 透传（cycle-112 继承项 A）：`'top-k-weight'` 时库会先收齐全部候选再按
    // 权重取前 k —— `maxPaths` 语义不变（仍是返回条数上限），只是**选择策略**不同。
    const entries = enumerate(this.space, rule, [source], index, {
      maxPaths: cursor + pageSize + 1,
      ...(options.truncation ? { truncation: options.truncation } : {}),
    });
    const truncated = entries.length > cursor + pageSize;
    const page = readPathPage(rule, entries, { cursor, pageSize });
    return {
      paths: page.entries.map((entry) => [...entry.nodes]),
      truncated,
      total: page.entries.length,
      labels: page.labels,
      nextCursor: page.nextCursor,
    };
  }

  /**
   * 枚举图中的简单环（闭合路径 + Booth 规范化去重）。
   * 同一环从不同节点起读只出现一次——「同一首诗从不同字起读仍是同一首」。
   *
   * XJ-03：与 {@link findPathsBetween} 同源，返回值带 `labels` / `nextCursor`。
   */
  cycles(options: CycleEnumerationOptions = {}): PathEnumerationResult {
    const maxLength = Math.max(1, options.maxLength ?? 6);
    const limit = Math.max(1, options.limit ?? 100);
    const cursor = Math.max(0, Math.floor(options.cursor ?? 0));
    const pageSize = Math.max(1, Math.floor(options.pageSize ?? limit));

    const edgeTypes = this.presentEdgeTypes(options.edgeTypes ?? DEFAULT_PATH_EDGE_TYPES);
    if (edgeTypes.size === 0) return EMPTY_PATH_RESULT;

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
    this.assertRule(rule);

    const index = new PathIndex();
    const starts = [...this.space.nodeIds()];
    const entries = enumerate(this.space, rule, starts, index, { maxPaths: cursor + pageSize + 1 });
    const truncated = entries.length > cursor + pageSize;
    const page = readPathPage(rule, entries, { cursor, pageSize });
    return {
      paths: page.entries.map((entry) => [...entry.nodes]),
      truncated,
      total: page.entries.length,
      labels: page.labels,
      nextCursor: page.nextCursor,
    };
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

  /**
   * 内联读法规则的**必然执行**的校验关口：构造错误（lMin/lMax/normalize 非法等）绝不能静默枚举。
   *
   * 与 {@link registerRule} 共用同一个 {@link validateRule}。两条内联读法的合法输入
   * （已把 edgeTypes 裁剪到图中存在者）不会触发它，但**调用本身是每次枚举都执行的**——
   * 验收断言依赖这一点（spy `validateRule` 即可证明），并有一个用例用非法参数
   * （非有限的 minHops/maxLength）证明它确实会拒绝，而不是恒真。
   */
  private assertRule(rule: PathRule): void {
    const validation = this.validateRule(rule);
    if (validation.errors.length > 0) {
      throw new RuleCompositionError(
        `invalid path rule "${rule.name}": ${validation.errors.join('; ')}`,
      );
    }
  }

  private presentEdgeTypes(requested: Iterable<AdapterEdgeType>): Set<AdapterEdgeType> {
    const present = this.space.edgeTypes();
    const result = new Set<AdapterEdgeType>();
    for (const type of requested) if (present.has(type)) result.add(type);
    return result;
  }

  private sameStamp(a: SyncStamp, b: SyncStamp): boolean {
    return (
      a.timestamp === b.timestamp &&
      a.nodeCount === b.nodeCount &&
      a.edgeCount === b.edgeCount
    );
  }

  /** 逐节点（含属性）与逐边（三元组）比较 `data` 与当前图空间。 */
  private diffAgainstSpace(data: SyncGraphInput): SpaceDiff {
    const knownNodes = new Set<string>();
    const addedNodes: GraphNode[] = [];
    for (const node of data.nodes) {
      const stored = this.space.getNodeAttrs(node.id);
      if (stored === undefined) {
        addedNodes.push(node);
        continue;
      }
      // 属性参与规则谓词（role / tags / isExported），变了就不能当作「旧节点还在」。
      if (!attrsEqual(stored, nodeAttrs(node))) return { kind: 'incompatible' };
      knownNodes.add(node.id);
    }
    // 图空间里还有 data 没提到的节点 ⇒ 这版图删了节点，只能全量重建。
    if (knownNodes.size !== this.space.nodeCount) return { kind: 'incompatible' };

    const knownEdgeKeys = new Set<string>();
    const addedEdges: GraphEdge[] = [];
    for (const edge of data.edges) {
      if (this.space.hasEdge(edge.source, edge.target, edge.type)) {
        knownEdgeKeys.add(`${edge.source}->${edge.target}->${edge.type}`);
        continue;
      }
      addedEdges.push(edge);
    }
    if (knownEdgeKeys.size !== this.space.edgeCount) return { kind: 'incompatible' };

    if (addedNodes.length === 0 && addedEdges.length === 0) return { kind: 'identical' };

    // 新增边必须能解析端点（否则增量后的图与全量装载的图不一致）。
    const addedNodeIds = new Set<string>(addedNodes.map((node) => node.id));
    for (const edge of addedEdges) {
      if (!this.space.hasNode(edge.source) && !addedNodeIds.has(edge.source)) {
        return { kind: 'incompatible' };
      }
      if (!this.space.hasNode(edge.target) && !addedNodeIds.has(edge.target)) {
        return { kind: 'incompatible' };
      }
    }
    return { kind: 'additive', addedNodes, addedEdges };
  }
}

/**
 * 按 repoId 缓存 {@link XuanjiAdapter} 的 LRU 池（XJ-02）。
 *
 * 存在的理由：`graph_path_enumerate` / `graph_cycles` 之前每次调用都 `new XuanjiAdapter()`
 * + `loadGraph()`，于是库里的增量引擎（`onEdgeAdded` / `onEdgeRemovedDetailed`）在生产上
 * 没有任何宿主入口。池化之后同一个图空间被复用，`syncGraph` 才有意义。
 *
 * 容量默认 2（同时挂两个仓库即可覆盖「当前工作区 + 刚切换的工作区」）。
 */
export class XuanjiAdapterPool {
  private readonly adapters = new Map<string, XuanjiAdapter>();
  private readonly capacity: number;

  constructor(capacity = 2) {
    this.capacity = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : 2;
  }

  /** 取（必要时新建）某仓库的适配层；命中即刷新 LRU 顺序。 */
  get(repoId: string): XuanjiAdapter {
    const existing = this.adapters.get(repoId);
    if (existing) {
      // Map 保序：先删后插 = 移到 MRU 端。
      this.adapters.delete(repoId);
      this.adapters.set(repoId, existing);
      return existing;
    }
    const created = new XuanjiAdapter();
    this.adapters.set(repoId, created);
    while (this.adapters.size > this.capacity) {
      const oldest = this.adapters.keys().next().value;
      if (oldest === undefined) break;
      this.adapters.delete(oldest);
    }
    return created;
  }

  /**
   * 把一条真实 delta 应用到该仓库已缓存的适配层。
   *
   * 前置条件（任一不满足就**不应用**，绝不把两版图混在一起）：
   * - 该仓库有缓存且已装载过图；
   * - `canApplyDelta` 认可这条 delta 的基线就在当前图空间里。
   *
   * 基线不匹配时直接丢弃缓存，让下一次 `get` 从零重建（正确性优先于命中率）。
   */
  applyDelta(repoId: string, delta: GraphDelta): PoolDeltaResult {
    const adapter = this.adapters.get(repoId);
    if (!adapter || !adapter.isReady) return DELTA_SKIPPED;
    if (!adapter.canApplyDelta(delta)) {
      this.invalidate(repoId);
      return DELTA_SKIPPED;
    }
    const result = adapter.applyDelta(delta);
    return { applied: true, ...result };
  }

  /**
   * 丢弃某仓库的派生状态（图空间 + 增量索引）。
   *
   * 用于「拿到了没有缓存基线的全新图」：此时适配层手里的可能是另一版修订，
   * 继续复用它虽然会被 `syncGraph` 的结构比较拦下，但先丢掉更直白也更省内存。
   */
  invalidate(repoId: string): void {
    this.adapters.delete(repoId);
  }

  /** 插件卸载时清空所有缓存（`createGraphTools` 的 dispose 调用）。 */
  dispose(): void {
    this.adapters.clear();
  }
}
