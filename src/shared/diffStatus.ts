/**
 * 图差异（diff）状态的**唯一真源**。
 *
 * 背景（研究报告 §六 #13）：数据层早已存在——`src/merger/DiffEngine.ts` 的
 * `diffToGraphData()` 会给节点与边写上 `properties.diffStatus`，宿主 `/diff` 路由也把它
 * 原样返回；但 `src/client` 里对这个字段的消费者**长期为零**，也就是说「版本对比」这个
 * 能力只有出口没有入口，用户永远看不到任何差异标记。本模块是补上渲染层时的共用词汇表。
 *
 * 三条设计约束：
 *
 * 1. **只允许三个值**。`diffStatus` 是封闭联合，不是自由字符串。写入侧（宿主 DiffEngine）
 *    与读取侧（客户端渲染、面板统计）必须共用同一份清单，否则某一侧新增一个值时另一侧会
 *    静默忽略它——标记不出现，且没有任何错误可见。
 * 2. **纯函数、零依赖**。本文件不 import React、不 import cytoscape、不读 DOM，因此可以在
 *    node 环境的单元测试里直接跑，也可以被宿主与客户端两侧同时引用。
 * 3. **`unknown` 不是错误而是事实**。当前图里可能根本没有某个 diff 节点（用户只展开了部分
 *    目录，或该节点在旧版本已被删除），这不是数据错误。`summarizeDiff` 必须把这个差额如实
 *    报出来，而不是假装「全部标记成功」。
 */

/** 一个元素相对基线版本的变更类型。 */
export type DiffStatus = 'added' | 'modified' | 'removed';

/**
 * 全部合法状态值的**运行期**清单（与 `DiffStatus` 类型同源，改一处必须改两处）。
 *
 * 之所以需要运行期清单：从网络负载读到的 `properties.diffStatus` 是 `unknown`，
 * 判断它是否合法只能靠运行时比对；TypeScript 的联合类型在擦除后不留下任何痕迹。
 */
export const DIFF_STATUSES: readonly DiffStatus[] = Object.freeze(['added', 'modified', 'removed']);

/**
 * 状态 → 渲染类名。
 *
 * 刻意用 **cytoscape class** 而不是数据属性选择器：
 * `[diffStatus="added"]` 在本例里其实能工作（写入侧确实是字符串），但同一仓库里已经因为
 * 「布尔属性被写成字符串比较」死过 24 条样式规则（见 `tests/unit/styleSelectorContract.test.ts`）。
 * class 不参与数据属性的类型推断，写入侧与样式侧只有「同一个字符串」这一条契约，由
 * `tests/unit/diffStatusContract.test.ts` 的源码扫描兜底。
 */
export const DIFF_STATUS_CLASS: Record<DiffStatus, string> = Object.freeze({
  added: 'diff-added',
  modified: 'diff-modified',
  removed: 'diff-removed',
});

/** 按固定顺序给出全部渲染类名，供「清除标记」遍历。 */
export const DIFF_STATUS_CLASSES: readonly string[] = Object.freeze(
  DIFF_STATUSES.map((s) => DIFF_STATUS_CLASS[s]),
);

/**
 * 判断一个来自网络负载的值是否是合法 `DiffStatus`。
 *
 * 刻意不做 `String(value)` 之类的宽容转换：`null`、`''`、`0` 都不是「恰好等于某个合法值」，
 * 把它们强转成字符串只会让非法数据悄悄通过。宁可返回 `null` 让调用方跳过该元素。
 */
export function asDiffStatus(value: unknown): DiffStatus | null {
  if (typeof value !== 'string') return null;
  return (DIFF_STATUSES as readonly string[]).includes(value) ? (value as DiffStatus) : null;
}

/** 带 `diffStatus` 的最小结构（节点与边都满足）。 */
export interface DiffTagged {
  id: string;
  properties?: Record<string, unknown> | undefined;
}

/** 读取一个元素身上的合法 diff 状态；无标记或非法值时返回 `null`。 */
export function readDiffStatus(element: DiffTagged): DiffStatus | null {
  const raw = element.properties?.['diffStatus'];
  return asDiffStatus(raw);
}

/**
 * 一次 diff 负载里各状态的**元素 id 集合**。
 *
 * 节点与边**分开**保存：同一个 id 可能同时是节点与边的 id（不同命名空间），合并成一个 Set
 * 会让「标记节点」时误标记同 id 的边。这是两个不同的渲染对象，必须分账。
 */
export interface DiffIndex {
  nodes: Record<DiffStatus, Set<string>>;
  edges: Record<DiffStatus, Set<string>>;
}

export function emptyDiffIndex(): DiffIndex {
  return {
    nodes: { added: new Set(), modified: new Set(), removed: new Set() },
    edges: { added: new Set(), modified: new Set(), removed: new Set() },
  };
}

/**
 * 把一份 diff 图负载（`{ nodes, edges }`，与 `/diff` 响应同形）索引成按状态分组的 id 集合。
 *
 * 不抛错、不丢元素：没有 `diffStatus` 的元素会被**忽略**（它们不是变更项），非法状态值同样
 * 被忽略——但两种情况都在 `unclassified` 计数里如实报出，调用方可以据此判断「服务端是不是
 * 换了词汇表」，而不是看到一个静默变小的数字。
 */
export function buildDiffIndex(
  nodes: readonly DiffTagged[],
  edges: readonly DiffTagged[],
): DiffIndex & { unclassified: { nodes: number; edges: number } } {
  const index = emptyDiffIndex();
  let unclassifiedNodes = 0;
  let unclassifiedEdges = 0;

  for (const node of nodes) {
    const status = readDiffStatus(node);
    if (status === null) {
      unclassifiedNodes += 1;
      continue;
    }
    index.nodes[status].add(node.id);
  }
  for (const edge of edges) {
    const status = readDiffStatus(edge);
    if (status === null) {
      unclassifiedEdges += 1;
      continue;
    }
    index.edges[status].add(edge.id);
  }

  return { ...index, unclassified: { nodes: unclassifiedNodes, edges: unclassifiedEdges } };
}

/** 一次标记操作的统计结果。 */
export interface DiffMarkStats {
  /** 三个状态各自的元素数（节点 + 边合计），用于面板显示「新增 3 / 修改 1 / 删除 2」。 */
  counts: Record<DiffStatus, number>;
  /** diff 里有、但当前渲染图里找不到的元素数。 */
  missing: number;
  /** 实际被标记的元素总数。 */
  marked: number;
}

/**
 * 计算「这份 diff 在当前图上能标记多少」。
 *
 * `presentNodeIds` / `presentEdgeIds` 由渲染器给出（当前 cytoscape 实例里真实存在的元素）。
 * `missing > 0` 是**正常且必须披露**的状态：用户只展开了部分目录时，diff 覆盖的其余节点不在
 * 画布上。若面板只说「共 6 处变更」而画布只亮了 2 处，用户会以为功能坏了。
 */
export function summarizeDiff(
  index: DiffIndex,
  presentNodeIds: ReadonlySet<string>,
  presentEdgeIds: ReadonlySet<string>,
): DiffMarkStats {
  const counts: Record<DiffStatus, number> = { added: 0, modified: 0, removed: 0 };
  let missing = 0;
  let marked = 0;

  for (const status of DIFF_STATUSES) {
    for (const id of index.nodes[status]) {
      counts[status] += 1;
      if (presentNodeIds.has(id)) marked += 1;
      else missing += 1;
    }
    for (const id of index.edges[status]) {
      counts[status] += 1;
      if (presentEdgeIds.has(id)) marked += 1;
      else missing += 1;
    }
  }

  return { counts, missing, marked };
}

/** 一次 diff 是否为空（三个状态都没有元素）。 */
export function isDiffEmpty(index: DiffIndex): boolean {
  return DIFF_STATUSES.every((s) => index.nodes[s].size === 0 && index.edges[s].size === 0);
}
