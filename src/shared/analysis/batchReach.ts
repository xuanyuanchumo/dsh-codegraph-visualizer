/**
 * 批量可达计数：Tarjan SCC 缩点 + 逆拓扑序 bitset 传递闭包。
 *
 * 璇玑图原型：一方锦缎里每个字能顺读到的字数，不是从每个字各跑一遍水磨工夫，
 * 而是先把「互相能绕回来」的字块（强连通分量）压成一个点，再沿缩点图的逆拓扑序
 * 把可达集合当作 bitset 向上合并——一次算完整张图。
 *
 * 复杂度：O((V+E)·V/32) 时间、O(V²/32) 空间（每个 SCC 一个 `Uint32Array`）。
 * 对 V = 600 的调用链，旧逐点 BFS 约为 O(V²)，本实现约为 19 个 machine word 的按位合并。
 *
 * ## 与旧实现（`bfsReachCount`，见 GraphBFS.ts）的语义差异（必须如实告知调用方）
 *
 * 旧实现带 `MAX_BFS_NODES = 500` 的**上界截断**，而且截断发生在「队列取出下一个节点之前」：
 * 它可能一口气把某个大出度节点的邻居全部标记，因此返回值**并不被 500 严格约束**，
 * 具体停在哪里取决于 BFS 的邻居顺序，本质上是一个顺序相关的近似值。可以证明：
 *
 * - 旧值 ≤ 精确值（它只统计已发现的节点，绝不虚构节点）；
 * - 当精确值 < 500 时，旧值与精确值**逐节点相等**（此时发现集合还没触及截断阈值）；
 * - 当精确值 ≥ 500 时，旧值可能明显小于精确值（长链 0→1→…→600 上恰好返回 499），
 *   且对同一张图改变边序就能得到不同的旧值；本实现返回**精确值**，不受顺序影响。
 *
 * `tests/unit/batchReach.test.ts` 对「精确值 < 500 必须与旧值逐节点相等」做了 300 组
 * 随机图对照，并对 >500 的链图分别断言精确值与「旧值 ≤ 新值」。
 *
 * @module shared/analysis/batchReach
 */

/**
 * 计算 `nodes` 中每个节点能到达的**不同节点个数**（不含自身）。
 *
 * - 自环 / 重复边不重复计数（集合语义）；
 * - 强连通分量内的节点互为可达，因此同 SCC 的每个节点得到同一个计数；
 * - `outEdges` 里指向 `nodes` 之外端点的边被忽略（可达性只在给定节点集上定义）；
 * - `nodes` 中重复出现的 id 只计一次；不在 `outEdges` 的节点计 0。
 */
export function computeReachCounts(
  outEdges: ReadonlyMap<string, readonly string[]>,
  nodes: readonly string[],
): Map<string, number> {
  const result = new Map<string, number>();
  if (nodes.length === 0) return result;

  // 0) 节点去重 + 位号分配（bitset 的第 i 位 == ids[i]）
  const ids: string[] = [];
  const index = new Map<string, number>();
  for (const id of nodes) {
    if (index.has(id)) continue;
    index.set(id, ids.length);
    ids.push(id);
  }
  const nodeCount = ids.length;
  const words = (nodeCount + 31) >>> 5;

  // 1) 邻接表（整数下标；未知端点丢弃）
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => [] as number[]);
  for (const [source, targets] of outEdges) {
    const u = index.get(source);
    if (u === undefined) continue;
    const list = adjacency[u]!;
    for (const target of targets) {
      const v = index.get(target);
      if (v !== undefined) list.push(v);
    }
  }

  // 2) Tarjan SCC（迭代式：600+ 的长链不能让递归爆栈）
  const discovery = new Int32Array(nodeCount).fill(-1);
  const low = new Int32Array(nodeCount);
  const onStack = new Uint8Array(nodeCount);
  const component = new Int32Array(nodeCount).fill(-1);
  const stack: number[] = [];
  const frameNode: number[] = [];
  const frameNext: number[] = [];
  let clock = 0;
  let componentCount = 0;

  for (let start = 0; start < nodeCount; start++) {
    if (discovery[start] !== -1) continue;

    discovery[start] = clock;
    low[start] = clock;
    clock++;
    stack.push(start);
    onStack[start] = 1;
    frameNode.push(start);
    frameNext.push(0);

    while (frameNode.length > 0) {
      const top = frameNode.length - 1;
      const u = frameNode[top]!;
      const next = frameNext[top]!;
      const neighbors = adjacency[u]!;

      if (next < neighbors.length) {
        frameNext[top] = next + 1;
        const v = neighbors[next]!;
        if (discovery[v] === -1) {
          discovery[v] = clock;
          low[v] = clock;
          clock++;
          stack.push(v);
          onStack[v] = 1;
          frameNode.push(v);
          frameNext.push(0);
        } else if (onStack[v] === 1 && discovery[v]! < low[u]!) {
          low[u] = discovery[v]!;
        }
        continue;
      }

      // u 的所有后代处理完毕
      if (low[u] === discovery[u]) {
        let member: number;
        do {
          member = stack.pop()!;
          onStack[member] = 0;
          component[member] = componentCount;
        } while (member !== u);
        componentCount++;
      }
      frameNode.pop();
      frameNext.pop();
      if (frameNode.length > 0) {
        const parent = frameNode[frameNode.length - 1]!;
        if (low[u]! < low[parent]!) low[parent] = low[u]!;
      }
    }
  }

  // 3) 缩点：同 SCC 内部的边（含自环）对可达集合没有贡献，直接跳过
  const members: number[][] = Array.from({ length: componentCount }, () => [] as number[]);
  for (let u = 0; u < nodeCount; u++) members[component[u]!]!.push(u);

  const successors: Array<Set<number>> = Array.from(
    { length: componentCount },
    () => new Set<number>(),
  );
  for (let u = 0; u < nodeCount; u++) {
    const cu = component[u]!;
    for (const v of adjacency[u]!) {
      const cv = component[v]!;
      if (cu !== cv) successors[cu]!.add(cv);
    }
  }

  // 4) Kahn 求缩点图的拓扑序（不依赖 Tarjan 的产出顺序，避免隐式假设）
  const indegree = new Int32Array(componentCount);
  for (const set of successors) for (const target of set) indegree[target]!++;
  const queue: number[] = [];
  for (let c = 0; c < componentCount; c++) if (indegree[c] === 0) queue.push(c);
  const topo: number[] = [];
  let head = 0;
  while (head < queue.length) {
    const c = queue[head++]!;
    topo.push(c);
    for (const target of successors[c]!) {
      if (--indegree[target]! === 0) queue.push(target);
    }
  }

  // 5) 逆拓扑序合并 bitset：closure[c] = SCC c 的成员 ∪ 所有后继的 closure
  const closure: Array<Uint32Array | undefined> = Array.from(
    { length: componentCount },
    () => undefined,
  );
  for (let i = topo.length - 1; i >= 0; i--) {
    const c = topo[i]!;
    const bits = new Uint32Array(words);
    for (const member of members[c]!) bits[member >>> 5]! |= 1 << (member & 31);
    for (const target of successors[c]!) {
      const targetBits = closure[target]!;
      for (let w = 0; w < words; w++) bits[w]! |= targetBits[w]!;
    }
    closure[c] = bits;

    let reachable = 0;
    for (let w = 0; w < words; w++) reachable += popcount32(bits[w]!);
    // bits 含自身所在 SCC 的成员：减去自身即「能到达的其它节点数」
    const count = reachable - 1;
    for (const member of members[c]!) result.set(ids[member]!, count);
  }

  return result;
}

/** 32 位 popcount（Hacker's Delight 的经典 SWAR 写法）。 */
function popcount32(value: number): number {
  let v = value >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return ((v * 0x01010101) >>> 24);
}
