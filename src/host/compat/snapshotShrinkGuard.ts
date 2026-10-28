// host 侧快照写入的防缩水守卫（cycle-110 / P0-7，cycle-109 carry-over）。
//
// ## 为什么 host 侧也需要它
//
// `src/shared/graphDelta.ts` 的 `canApplyGraphDelta` 守卫的是「delta 应用**后**的图」，
// 两个调用点（client store `graphDataSlice` / host `incrementalUpdate`）都已接线。但
// **快照落盘**是第三条写路径：`triggerBackgroundBuild` 把一次全量扫描的结果写进
// SQLite 的 `snapshots` 表（`src/host/routes/shared.ts` 的 `saveSnapshot` 调用点）。
// 一次半读（上游重建中途、DB 半写、工作区解析错位）会产出一张断崖式变小的图，而
// **快照一旦落盘就带着"这是该 repo 的最新结构"的身份**——后续的指纹比对、恢复与
// 差分都以它为基线。静默写入一张缩水快照的代价不可见，拒绝写入的代价只是磁盘上的
// 基线晚一轮更新（当前版本里没有任何渲染路径读 snapshots；见下方"诚实边界"）。
//
// ## 为什么不自己发明阈值
//
// 阈值、规模下限、比较方向（`next / current`、严格小于）全部**复用**
// `GRAPH_DELTA_SHRINK`：两条写路径必须用同一组数字，否则「一处拦一处放」只是把问题
// 推到另一条路径上（该常量文件里的注释已写明这条约束）。本模块不定义任何新数字。
//
// ## 与 `canApplyGraphDelta` 的两点刻意差异
//
// 1. **没有 delta 可折叠**：这里比较的是「上一张快照的 node_count/edge_count」与
//    「本次扫描结果」。`getLatestSnapshot()` 返回的记录自带这两个计数，因此不需要
//    反序列化 payload（反序列化 100k 节点的图只为数个数是不可接受的代价）。
// 2. **需要一条"回退通道"**：`canApplyGraphDelta` 返回 false 时调用方落回**全量重取**，
//    重取得到的正确答案仍是那张小图，所以不存在永久拒绝。快照写入没有「重取」这一步：
//    用户真的删掉了 80% 的代码时，此后**每一次**扫描都比基线小，单纯「拒绝写入」
//    会让基线被永久锁死在一张过时的图上——那正是「守卫退化成锁」的经典形态
//    （与 `docs/需求分析.md` §59.25 里 `loaded.length >= knownTotal` 的教训同族）。
//    因此这里采用**两次确认（two-strike）**：同一次缩水的**相同指纹**第一次被拒绝，
//    第二次出现时接受——内容指纹是图结构的确定性函数，连续两轮扫出完全一致的较小图
//    说明缩水是真实改动，而不是一次半读。
//
// ## 诚实边界
//
// - 只防**断崖**，不防渐进缩水（每轮掉 40% 连掉三轮，每轮都在阈值之上）。
// - 小于 `MIN_GUARDED_NODES/EDGES` 的图**完全不设防**：3 个节点删 2 个是 0.33，
//   而这在删掉一个文件的全部符号时再正常不过。这个洞是刻意留的且被用例钉住
//   （"下限以下没有保护"），不是遗漏。
// - 当前没有任何生产代码读 `snapshots` 表做恢复；本守卫保护的是**未来的**恢复路径
//   与指纹基线，请不要据此宣称"用户永远看不到缩水"。

import { GRAPH_DELTA_SHRINK } from '../../shared/graphDelta.ts';

/** 快照的规模视图：`GraphData.metadata` 与 `SnapshotRecord` 都满足它。 */
export interface SnapshotSize {
  readonly nodeCount: number;
  readonly edgeCount: number;
}

/** 判定原因。刻意做成可枚举的字符串，便于日志与用例断言「为什么放/拦」。 */
export type SnapshotShrinkReason =
  /** 没有基线（首次写入、或表为空）—— 无从比较，放行。 */
  | 'no-previous'
  /** 守卫关闭（阈值为 0）。 */
  | 'guard-off'
  /** 两个维度都低于规模下限 —— 比例在极小图上没有意义，放行。 */
  | 'below-floor'
  /** 规模维度通过。 */
  | 'within-budget'
  /** 至少一个维度断崖式缩小 —— 拒绝写入。 */
  | 'shrink-refused';

export interface SnapshotShrinkDecision {
  allowed: boolean;
  reason: SnapshotShrinkReason;
  /** `next / previous`；基线为 0 时记 1（没有可缩水的基数），无基线时为 null。 */
  nodeRatio: number | null;
  edgeRatio: number | null;
}

export interface SnapshotShrinkOptions {
  /** 必须保留的最低比例；0 = 关闭（与 `canApplyGraphDelta` 的默认语义一致）。 */
  minRetainRatio?: number;
}

/** 保留比例：`next / previous`。基线为 0 时返回 1（无基数即无缩水）。 */
function retainedRatio(previousSize: number, nextSize: number): number {
  if (previousSize === 0) return 1;
  return nextSize / previousSize;
}

/**
 * 纯判定：本次扫描结果能否作为新快照落盘。
 *
 * 比较方向与边界语义逐条对齐 `canApplyGraphDelta`：
 * - 比例是 `next / previous`，不是「删掉了多少」；
 * - 判定是**严格小于**阈值（恰好等于阈值放行，由用例在边界上钉住）；
 * - 每个维度各自看自己的规模下限（节点看 `MIN_GUARDED_NODES`、边看 `MIN_GUARDED_EDGES`）。
 *
 * **不含任何状态**：两次确认所需的「上一轮被拒指纹」由调用方持有（见
 * {@link rememberRefusedSnapshot}）。
 */
export function evaluateSnapshotShrink(
  previous: SnapshotSize | null | undefined,
  next: SnapshotSize,
  options: SnapshotShrinkOptions = {},
): SnapshotShrinkDecision {
  if (!previous) {
    return { allowed: true, reason: 'no-previous', nodeRatio: null, edgeRatio: null };
  }

  const nodeRatio = retainedRatio(previous.nodeCount, next.nodeCount);
  const edgeRatio = retainedRatio(previous.edgeCount, next.edgeCount);

  const minRetainRatio = options.minRetainRatio ?? 0;
  if (minRetainRatio <= 0) {
    return { allowed: true, reason: 'guard-off', nodeRatio, edgeRatio };
  }

  const nodeGuarded = previous.nodeCount >= GRAPH_DELTA_SHRINK.MIN_GUARDED_NODES;
  const edgeGuarded = previous.edgeCount >= GRAPH_DELTA_SHRINK.MIN_GUARDED_EDGES;
  if (!nodeGuarded && !edgeGuarded) {
    return { allowed: true, reason: 'below-floor', nodeRatio, edgeRatio };
  }

  const nodeShrunk = nodeGuarded && nodeRatio < minRetainRatio;
  const edgeShrunk = edgeGuarded && edgeRatio < minRetainRatio;
  if (nodeShrunk || edgeShrunk) {
    return { allowed: false, reason: 'shrink-refused', nodeRatio, edgeRatio };
  }

  return { allowed: true, reason: 'within-budget', nodeRatio, edgeRatio };
}

// ── 两次确认的状态 ────────────────────────────────────────────────────
//
// 键 = repoId，值 = **上一次被拒**的内容指纹。调用方在拒绝时登记，在放行（写成功）
// 时清除。指纹由 `computeGraphFingerprint` 生成（`v1:<16 hex>`），所以「同一个指纹
// 再出现」严格等价于「扫出了一模一样的较小图」。
//
// 这是**模块级单例**：必须能被重置，否则用例之间会互相污染（CLAUDE.md 已记录
// 「模块级单例必须成对重置」的教训）。重置点有两个：
//   1. `registerRoutes()` 的 `ctx.effect` 清理（随插件卸载）；
//   2. 用例的 `afterEach`。
const refusedFingerprints = new Map<string, string>();

/** 登记一次被拒的缩水写入，供下一轮判定「是否同一张缩水图」。 */
export function rememberRefusedSnapshot(repoId: string, fingerprint: string): void {
  refusedFingerprints.set(repoId, fingerprint);
}

/** 该指纹是否**正是上一轮被拒**的那一个（= 缩水已连续两轮确认）。 */
export function wasRefusedBefore(repoId: string, fingerprint: string): boolean {
  return refusedFingerprints.get(repoId) === fingerprint;
}

/** 写入成功后清除登记：基线已经前移，上一轮的拒绝不再有参考价值。 */
export function clearRefusedSnapshot(repoId: string): void {
  refusedFingerprints.delete(repoId);
}

/** 重置全部状态（插件卸载 / 用例隔离）。 */
export function resetSnapshotShrinkState(): void {
  refusedFingerprints.clear();
}
