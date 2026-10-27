# xuanji 库 API 契约（cycle-107 实施基准）

> 本文件是并行开发的**唯一接口事实源**。Lead 已实现 `src/xuanji/ops/{booth,rolling-hash}.ts` 与
> `src/xuanji/core/{graph-space,path-rule,path-entry}.ts`（只读）。以下模块由并行任务实现。

## 已存在（只读，不得修改）

```ts
// src/xuanji/ops/booth.ts
export function minimalRotationIndex<T extends string>(arr: readonly T[]): number
export function boothMinimalRotation<T extends string>(arr: readonly T[]): T[]
export function isMinimalRotation<T extends string>(arr: readonly T[]): boolean

// src/xuanji/ops/rolling-hash.ts
export interface HashPart { readonly hash: bigint; readonly len: number }
export function hashNode(id: string): HashPart
export const EMPTY_HASH: HashPart
export function concatHash(a: HashPart, b: HashPart): HashPart
export function sequenceHashParts(nodes: readonly string[]): HashPart
export function hashToHex(part: HashPart): string
export class RollingHash { hashSequence, parts, combine, empty }

// src/xuanji/core/graph-space.ts
export type NodeId = string; EdgeId = string; EdgeType = string;
export interface NodeAttrs { label; role?; tags?; [k:string]: unknown }
export interface XJEdge { id; source; target; type; weight? }
export interface ChangeEvent { kind; edge?; node?; version }
export function edgeKey(source, target, type): string
export class GraphSpace {
  version; nodeCount; edgeCount;
  addNode(id, attrs): void; removeNode(id): void;
  addEdge(edge): boolean; removeEdge(edge): boolean;
  hasNode(id): boolean; hasEdge(s,t,type): boolean; getEdge(s,t,type): XJEdge|undefined;
  hasEdgeOfType(s,t,types: ReadonlySet<EdgeType>): boolean;
  getNodeAttrs(id): NodeAttrs|undefined;
  nodeIds(): IterableIterator<NodeId>; edges(): IterableIterator<XJEdge>;
  edgeTypes(): ReadonlySet<EdgeType>;
  outNeighbors(node, types): NodeId[]; inNeighbors(node, types): NodeId[];
  drainChangeLog(): ChangeEvent[]; clear(): void;
}

// src/xuanji/core/path-rule.ts
export type StartPredicate = (node, attrs) => boolean
export type NodePredicate = (node, attrs) => boolean
export type EndPredicate = (node, attrs, start) => boolean
export type PathPredicate = (nodes: readonly NodeId[], graph: GraphSpace) => boolean
export type OutputMapper = (nodes: readonly NodeId[]) => unknown
export type NormalizeStrategy = 'none' | 'reverse' | 'canonical'
export interface PathRule { name; version; start; edgeTypes; lMin; lMax; nodeConstraint?; end?; closed?; simple?; pathConstraint?; output?; normalize }
export interface RuleValidation { errors: readonly string[]; warnings: readonly string[] }
export function validateRule(rule, knownEdgeTypes, nodeCount?): RuleValidation
export function unionRules(r1, r2): PathRule
export function intersectRules(r1, r2): PathRule   // 长度区间不相交时抛 RuleCompositionError
export function concatRules(r1, r2): PathRule
export function repeatRule(rule, times): PathRule
export function differenceRules(r1, r2): PathRule
export function hasDuplicateNodes(nodes, allowClosedReturn): boolean
export function isLegalPath(rule, nodes, graph): boolean   // C1 精确判据

// src/xuanji/core/path-entry.ts
export interface PathEntry { readonly nodes: NodeId[]; readonly hash: string; readonly version: number; stale: boolean; labels?: unknown }
export function compareNodeSequences(a, b): number
export function canonicalNodes(rule: Pick<PathRule,'normalize'|'closed'>, nodes): NodeId[]  // closed 时对开核旋转
export function makeEntry(rule, nodes, graphVersion): PathEntry
export function entryLabels(entry, rule): unknown
export function isLiveEntry(entry, graph, rule): boolean
```

## 补充：环存在性已由 Lead 实现（只读）

`src/xuanji/ops/cycle-existence.ts` 导出 `hasCycleInAdjacency(adjacency: ReadonlyMap<string, readonly string[]>): boolean`
与 `hasDirectedCycle(graph, types): boolean`。任务 C 直接使用；任务 B 可在 query-engine 中 re-export 同一实现，**不要重复实现**。

## 任务 A：`src/xuanji/index/*`（写作用域：src/xuanji/index/、tests/unit/xuanji/index*.test.ts、incremental*.test.ts）

```ts
// src/xuanji/index/path-index.ts
export interface IndexCounters { total: number; stale: number }
export class PathIndex {
  readonly startIndex: Map<NodeId, Map<number, PathEntry[]>>; // 起点 → 边数 → entries
  readonly endIndex: Map<NodeId, Map<number, PathEntry[]>>;
  readonly hashIndex: Map<string, PathEntry>;
  readonly edgeToPaths: Map<string, Set<string>>;             // key: `${u}->${v}`（不含 type）
  readonly counters: IndexCounters;
  add(entry: PathEntry): boolean;          // 已存在同 hash 返回 false（不重复入桶）
  markStale(edgePair: string): number;     // `${u}->${v}`，返回本次新置 stale 的条数
  markStaleForNodes(nodes: Iterable<NodeId>): number; // 保守失效：起点或终点落在 nodes 的条目
  queryByStart(start: NodeId): PathEntry[];   // 含 stale？不——只返回未 stale
  queryByEnd(end: NodeId): PathEntry[];
  getStartBuckets(node): Map<number, PathEntry[]>;
  getEndBuckets(node): Map<number, PathEntry[]>;
  sample(n: number): PathEntry[];
  liveCount(): number;
  clear(): void;
}
```

```ts
// src/xuanji/index/incremental.ts
export function onEdgeAdded(edge: XJEdge, rule: PathRule, graph: GraphSpace, index: PathIndex): PathEntry[];
export function onEdgeRemoved(edge: XJEdge, rule: PathRule, index: PathIndex): number;
```

**onEdgeAdded 正确性（C3）关键**：doc 原稿有双重拼接 bug——`pre.nodes` 已含 u，`suf.nodes` 已含 v，
组合应为 `pre.nodes.concat(suf.nodes)`；零长度前缀 [u] / 后缀 [v] 必须**虚拟补充**（索引只存 len ≥ lMin 的条目，
否则单边新环永远发现不了）。合法判定一律走 `isLegalPath`（精确），剪枝可用超集。

```ts
// src/xuanji/index/rebalance.ts
export function rebalance(node: NodeId, rule: PathRule, graph: GraphSpace, index: PathIndex): number;
// 1) 用 incident edges 的 `${u}->${v}` 键 markStale；2) 1-hop 邻域内按 rule.start 重新 enumerate；
// 3) 返回新增物化条数。不得清理全索引。
```

## 任务 B：`src/xuanji/query/*` + `registry/` + `ops/invariants.ts` + `core/nfa.ts` + `src/xuanji/index.ts`

```ts
// src/xuanji/query/query-engine.ts
export interface EnumerateOptions { maxPaths?: number }
export function enumerate(graph: GraphSpace, rule: PathRule, starts: Iterable<NodeId>, index: PathIndex, options?: EnumerateOptions): PathEntry[];
// 从每个 start 出发 DFS；剪枝用 rule.start / nodeConstraint / simple / 长度；
// 终判一律 isLegalPath；hash 去重（index.hashIndex 已存在则跳过并**不返回**）；
// maxPaths 达到即停止（确定性插入序）。

export function query(rule: PathRule, start: NodeId, index: PathIndex, graph: GraphSpace, fallback?: () => PathEntry[]): PathEntry[] | null;
// 返回未 stale 且 isLiveEntry 的条目；空或 stale 比例 > 0.3 → fallback() ?? null；**永不返回 stale**。

export function existsWalk(graph: GraphSpace, rule: PathRule, start: NodeId, target?: NodeId): boolean;
// (node, depth) 乘积状态 BFS，O(V·lMax)；忽略 simple 的重复约束（只回答「存在 walk」）。

export function hasDirectedCycle(graph: GraphSpace, types: ReadonlySet<EdgeType>): boolean; // O(V+E) 早终止

// src/xuanji/query/topk.ts
export function topK<T>(items: readonly T[], k: number, score?: (item: T) => number): T[];

// src/xuanji/registry/rule-registry.ts
export class RuleRegistry {
  constructor(knownEdgeTypes: ReadonlySet<EdgeType>);
  register(rule: PathRule, options?: { eager?: boolean }): RuleValidation; // 校验失败不注册
  get(name: string): PathRule | undefined;
  getVersion(name: string): number | undefined;
  list(): PathRule[];
  /** 同名新版本：旧版本标记 deprecated，无引用后由 GC 回收 */
  replace(rule: PathRule): { previous: PathRule | undefined };
  deprecate(name: string): boolean;
  gc(): string[];                      // 回收无引用的 deprecated 规则名
  isDeprecated(name: string): boolean;
  index(name: string): PathIndex | undefined;   // 惰性创建
}

// src/xuanji/ops/invariants.ts
export interface InvariantThresholds { thetaStale?: number; thetaDepth?: number }
export interface InvariantResult { id: 'I1'|'I2'|'I3'|'I4'|'I5'; ok: boolean; detail: string; violations: number }
export class InvariantChecker {
  constructor(thresholds?: InvariantThresholds);
  checkI1(index, rule, graph): InvariantResult;  // Σ_R 每类边至少出现在一条 live 物化路径
  checkI2(index, rule, graph): InvariantResult;  // nodeConstraint 的角色覆盖（用节点 attrs.role / tags）
  checkI3(index, rule, graph): InvariantResult;  // 各边类型平均路径长度差 ≤ thetaDepth
  checkI4(index): InvariantResult;               // stale/total ≤ thetaStale，O(1)
  checkI5(index, rule, graph): InvariantResult;  // version ≤ graph.version 且非 stale 路径的边仍存在（用 isLiveEntry 的边检查）
  checkAll(index, rule, graph): InvariantResult[];
}

// src/xuanji/core/nfa.ts
export interface NfaCompileResult { states: number; accepting: number }
export function compileLengthNfa(rule: PathRule): NfaCompileResult;  // |Q| = lMax-lMin+1 级；∞ 视为 |V| 由调用方传入

// src/xuanji/index.ts —— 汇总导出上面全部公共 API（含 core/ops 既有模块）
```

## 任务 C：宿主集成（写作用域：src/client/renderer/AdjacencyCache.ts、src/shared/analysis/{RuleEngine,CoreFunctionAnalyzer,CycleDFS,AdjacencyList}.ts + 对应 tests）

1. **CycleDFS.ts**：`boothMinimalRotation`/`hasCycle` 改为从 `../../xuanji/ops/booth.ts` / `../../xuanji/query/query-engine.ts` 导入或 re-export
   （库必须真正被执行，不许复制实现）。
2. **AdjacencyCache.ts**：`edgeIdMap` 键改 `${s}->${t}->${etype}`；新增 `addEdge(source,target,edgeId,etype)` / `removeEdge(...)` 增量 patch（不设 valid=false）
   + `version` 计数器；保留 `invalidate()` 全量重建作为降级；`getEdgeIdMap` 语义变更需同步 CycleDetector 的查找键。
   兼容性：既有无类型参数调用方（`getEdgeIdMap(cy).get('a->b')`）必须继续可用——提供 `getEdgeIdMap(cy)` 的**双键**（旧键 `a->b` 指向第一条，新键 `a->b->call` 精确），并在 JSDoc 说明。
3. **RuleEngine.ts**：一次 `check()` 内按 edgeTypes 组合缓存邻接表（同键复用），`ForbiddenEdgeDetector` 先 `hasCycle` 早退再枚举细节。
4. **CoreFunctionAnalyzer.ts**：`computeInfluenceReach` 改为 SCC 缩点 + bitset 传递闭包（新文件 `src/shared/analysis/batchReach.ts`），
   与旧 `bfsReachCount` 的**上界截断语义**对齐：旧实现的返回值可能 > MAX_BFS_NODES（受 BFS 顺序影响），
   新实现返回**精确可达节点数**，并在 JSDoc 与测试中声明「当精确值 ≥ MAX_BFS_NODES 时旧值随顺序抖动、新值更准确」；
   对精确值 < MAX_BFS_NODES 的节点必须与旧实现逐节点一致（测试用随机图 + 小图穷举）。

## 通用约束

- ESM + `.ts` 扩展名导入；`noUncheckedIndexedAccess`（索引访问要 `!` 或判空）。
- 库内（src/xuanji/**）**只允许相对导入 src/xuanji 内部文件**，禁止 import 宿主（src/client、src/shared、src/types）或第三方包。
- 测试放 `tests/unit/xuanji/`，命名 `*.test.ts`；每文件 ≥ 15 个用例，覆盖正常/边界/退化/幂等。
- 只跑自己作用域内的测试与 `npx tsc -p tsconfig.test.json`；不要跑全量 suite（Lead 统一跑）。
- 不要修改 package.json / vitest.config.ts / tsconfig。
