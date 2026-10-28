/**
 * 路径索引：起点桶 / 终点桶 / 边对倒排 / hash 去重 / 惰性失效计数。
 *
 * 璇玑图原型：一方锦缎上已经物化的「读法产物」按起点、终点、边数分桶，
 * 查询按边数升序读回，**不再**假设「增量只需触碰与新边相邻的桶」。
 *
 * 关键契约（cycle-107 任务 A + cycle-110 XJ-06 / XJ-09）：
 * - 桶键是**边数**（nodes.length - 1）。分桶**只服务查询**（`queryByStart` /
 *   `queryByEnd` 的边数升序返回、`getStartBuckets` 供 `query()` 取分母）。
 *   **分桶不服务增量**：增量引擎已改为「旧图反向 DFS 前缀 × 新图正向 DFS 后缀」
 *   （`incremental.ts` 模块头、设计方案 §12.2），它不读桶、不做桶配对；
 *   规范 §4.2「onEdgeAdded 需要按 len(pre)+1+len(suf) 配对」的表述已作废。
 *   Λ 长度剪枝也不落在桶上——它在 `isLegalPath`（`path-rule.ts`）里逐条精确判定，
 *   桶只在查询侧决定**返回顺序**。这条区分是有意为之：桶是查询优化，不是正确性依据。
 * - hash 去重：同 hash 的条目只入桶一次，add 返回 false（不重复入桶、不改计数）；
 * - edgeToPaths 键是 `${u}->${v}`（**不含 type**）：删除任一类型的一条边都要保守失效；
 * - stale 是惰性失效标记：置位后 queryByStart / queryByEnd / sample 不再返回它，
 *   liveCount = total - stale 是 O(1) 的；
 * - 零长度条目（单节点、边数 0，lMin = 0 的规则）同样入桶，但没有边对登记。
 *
 * @module xuanji/index/path-index
 */

import type { NodeId } from '../core/graph-space.ts';
import type { PathEntry } from '../core/path-entry.ts';

/** 索引计数器：total 为入桶条目总数，stale 为其中被标记失效的条数。 */
export interface IndexCounters {
  total: number;
  stale: number;
}

/** 边对键：与 GraphSpace 的 `source->target->type` 不同，这里刻意**不含类型**。 */
export function edgePairKey(source: NodeId, target: NodeId): string {
  return `${source}->${target}`;
}

type LengthBuckets = Map<number, PathEntry[]>;

/** 取（必要时创建）某节点某长度的桶。 */
function bucketFor(
  index: Map<NodeId, LengthBuckets>,
  node: NodeId,
  edgeCount: number,
): PathEntry[] {
  let byLength = index.get(node);
  if (!byLength) {
    byLength = new Map();
    index.set(node, byLength);
  }
  let bucket = byLength.get(edgeCount);
  if (!bucket) {
    bucket = [];
    byLength.set(edgeCount, bucket);
  }
  return bucket;
}

/** 按边数升序收集未失效条目（桶内保持插入序，结果确定）。 */
function collectLive(byLength: LengthBuckets | undefined): PathEntry[] {
  if (!byLength) return [];
  const lengths = [...byLength.keys()].sort((a, b) => a - b);
  const result: PathEntry[] = [];
  for (const length of lengths) {
    const bucket = byLength.get(length);
    if (!bucket) continue;
    for (const entry of bucket) {
      if (!entry.stale) result.push(entry);
    }
  }
  return result;
}

/**
 * 路径索引。
 *
 * 三条倒排共享同一批 PathEntry 对象（引用相等），所以置 stale 只需改一处。
 */
export class PathIndex {
  /** 起点 → 边数 → 条目。 */
  readonly startIndex = new Map<NodeId, Map<number, PathEntry[]>>();
  /** 终点 → 边数 → 条目。 */
  readonly endIndex = new Map<NodeId, Map<number, PathEntry[]>>();
  /** Δ-规范 hash → 条目（去重与 O(1) 存在性判定）。 */
  readonly hashIndex = new Map<string, PathEntry>();
  /** `${u}->${v}` → 经过该边对的条目 hash 集合。 */
  readonly edgeToPaths = new Map<string, Set<string>>();
  readonly counters: IndexCounters = { total: 0, stale: 0 };

  /**
   * 入桶。同 hash 已存在时返回 false 且**不重复入桶、不递增计数**。
   *
   * 空节点序列没有可索引的起点/终点，直接拒绝（返回 false）。
   */
  add(entry: PathEntry): boolean {
    if (entry.nodes.length === 0) return false;
    if (this.hashIndex.has(entry.hash)) return false;

    this.hashIndex.set(entry.hash, entry);
    const edgeCount = entry.nodes.length - 1;
    bucketFor(this.startIndex, entry.nodes[0]!, edgeCount).push(entry);
    bucketFor(this.endIndex, entry.nodes[entry.nodes.length - 1]!, edgeCount).push(entry);

    for (let i = 0; i + 1 < entry.nodes.length; i++) {
      const key = edgePairKey(entry.nodes[i]!, entry.nodes[i + 1]!);
      let hashes = this.edgeToPaths.get(key);
      if (!hashes) {
        hashes = new Set();
        this.edgeToPaths.set(key, hashes);
      }
      hashes.add(entry.hash);
    }

    this.counters.total++;
    if (entry.stale) this.counters.stale++;
    return true;
  }

  /**
   * 保守失效：把经过边对 `edgePair` 的全部条目置 stale。
   * 返回**本次新置**的条数（幂等：重复调用返回 0）。
   */
  markStale(edgePair: string): number {
    const hashes = this.edgeToPaths.get(edgePair);
    if (!hashes) return 0;
    let count = 0;
    for (const hash of hashes) {
      const entry = this.hashIndex.get(hash);
      if (!entry || entry.stale) continue;
      entry.stale = true;
      this.counters.stale++;
      count++;
    }
    return count;
  }

  /**
   * 保守失效：起点**或**终点落在 nodes 里的条目全部置 stale。
   * 返回本次新置的条数（同一条目在起点桶与终点桶各出现一次时只计一次）。
   */
  markStaleForNodes(nodes: Iterable<NodeId>): number {
    let count = 0;
    for (const node of nodes) {
      for (const index of [this.startIndex, this.endIndex]) {
        const byLength = index.get(node);
        if (!byLength) continue;
        for (const bucket of byLength.values()) {
          for (const entry of bucket) {
            if (entry.stale) continue;
            entry.stale = true;
            this.counters.stale++;
            count++;
          }
        }
      }
    }
    return count;
  }

  /** 从某节点出发的未失效条目（边数升序）。 */
  queryByStart(start: NodeId): PathEntry[] {
    return collectLive(this.startIndex.get(start));
  }

  /** 终止于某节点的未失效条目（边数升序）。 */
  queryByEnd(end: NodeId): PathEntry[] {
    return collectLive(this.endIndex.get(end));
  }

  /** 起点桶（可能为空 Map；调用方不要原地修改）。 */
  getStartBuckets(node: NodeId): Map<number, PathEntry[]> {
    return this.startIndex.get(node) ?? new Map();
  }

  /** 终点桶（可能为空 Map；调用方不要原地修改）。 */
  getEndBuckets(node: NodeId): Map<number, PathEntry[]> {
    return this.endIndex.get(node) ?? new Map();
  }

  /**
   * 抽取至多 n 条未失效条目做抽样体检（I5 用）。
   *
   * 契约（XJ-06，修的是 I5 的抽样偏差）：**均匀铺满 + 必含尾部**。
   *
   * 旧实现按 `hashIndex` 插入序取前 n 条，条目数超过 n 之后新条目永不入样——
   * 而 I5 要抓的恰恰是「新写入的坏条目」（version > graph.version、相邻边已删），
   * 抽样偏差方向与风险方向完全相反。现在的取法：
   * - 全部 live 条目按插入序排开（插入序 = 写入序，确定）；
   * - 保留末尾 `max(1, floor(n/4))` 条（最新写入的条目必入样）；
   * - 剩余额度在前段 `live.length - tailCount` 条里按等步长均匀取，首条必入样；
   * - 前段与尾段下标区间不相交，因此结果无重复且严格递增（顺序确定）；
   * - `n <= 0` 返回 `[]`；`live.length <= n` 返回全部 live 的副本。
   *
   * 返回的是新数组：调用方修改它不影响索引（I5 只读）。
   */
  sample(n: number): PathEntry[] {
    const limit = Number.isFinite(n) ? Math.floor(n) : Number.POSITIVE_INFINITY;
    if (limit <= 0) return [];
    const live: PathEntry[] = [];
    for (const entry of this.hashIndex.values()) {
      if (!entry.stale) live.push(entry);
    }
    if (live.length <= limit) return live;
    if (!Number.isFinite(limit)) return live;

    // 尾部配额：至少 1 条（「必含尾部」是硬要求，n < 4 时配额就是 1，不是 0）。
    const tailCount = Math.max(1, Math.floor(limit / 4));
    const headQuota = limit - tailCount;
    const headRegion = live.length - tailCount;
    const result: PathEntry[] = [];

    if (headQuota > 0 && headRegion > 0) {
      // 步长按「前段长度 / 前段额度」取整，至少 1，保证下标严格递增且不越界。
      const step = Math.max(1, Math.floor(headRegion / headQuota));
      for (let i = 0; i < headQuota; i++) {
        const index = Math.min(i * step, headRegion - 1);
        const entry = live[index];
        if (entry && result[result.length - 1] !== entry) result.push(entry);
      }
    }
    for (let i = live.length - tailCount; i < live.length; i++) {
      const entry = live[i];
      if (entry) result.push(entry);
    }
    return result.slice(0, limit);
  }

  /** 未失效条目数（O(1)）。 */
  liveCount(): number {
    return Math.max(0, this.counters.total - this.counters.stale);
  }

  clear(): void {
    this.startIndex.clear();
    this.endIndex.clear();
    this.hashIndex.clear();
    this.edgeToPaths.clear();
    this.counters.total = 0;
    this.counters.stale = 0;
  }
}

/**
 * 契约扩展（非 §任务A 必需成员）：把一条**仍然合法**的 stale 条目恢复为 live。
 *
 * 存在理由：`markStale` 的边对键不含 type，删除「a->b (call)」会把仍由
 * 「a->b (data)」支撑的条目一并置 stale；增量/重组重新枚举到同一 hash 时，
 * 只要条目本身仍满足 isLegalPath，就应当恢复而不是永久丢失。
 * 合法性由调用方判定（本函数不碰图）。
 *
 * 返回是否发生了恢复。
 */
export function reviveEntry(index: PathIndex, entry: PathEntry): boolean {
  if (!entry.stale) return false;
  if (index.hashIndex.get(entry.hash) !== entry) return false;
  entry.stale = false;
  if (index.counters.stale > 0) index.counters.stale--;
  return true;
}
