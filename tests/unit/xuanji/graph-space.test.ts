/**
 * GraphSpace 变更日志契约（cycle-111 / N-1）。
 *
 * ## 为什么需要这个文件
 *
 * `GraphSpace` 是库里被引用最多的类，但此前**没有任何一个专属测试文件**——它的行为只是
 * 被 query / incremental / invariants 间接覆盖，于是「日志只有入口没有出口」这条缺陷
 * 从来没有一个断言能看见：230+ 个用例全绿，而每次增删都在 push 一个永不被读的数组。
 *
 * 缺陷的性质**由生命周期决定**：
 * - cycle-107～108：`XuanjiAdapter` 每次工具调用都新建，日志随对象被 GC ⇒ 无害；
 * - cycle-109 把 `XuanjiAdapterPool` 接进 `src/tools.ts` 后同名实例按 repoId 常驻
 *   ⇒ 同一个 push 变成**随进程时长线性增长**。
 *
 * 因此本文件钉住三件事，缺一不可：
 * 1. **有界**：任意多次增删之后未消费事件数 ≤ `MAX_CHANGE_LOG`；
 * 2. **语义不变**：`drainChangeLog()` 仍返回自上次 drain 以来的事件，`version` 严格递增；
 * 3. **截断可见**：被丢弃的最旧事件数由 `droppedChangeEvents` 如实报出，
 *    而不是无声无息地少几条（静默截断 = 将来的消费者拿到一份「看起来完整」的假日志）。
 *
 * 上界是常量而非选项：允许调用方传上界就等于允许传 `Infinity`，那正是被修的缺陷形态。
 */
import { describe, expect, it } from 'vitest';
import { GraphSpace, MAX_CHANGE_LOG, type XJEdge } from '../../../src/xuanji/core/graph-space.ts';

/** 造一批边：source/target 都在 graph 里，type 固定。 */
function seedEdges(graph: GraphSpace, count: number): void {
  for (let i = 0; i < count; i++) {
    graph.addNode(`n${i}`, { label: `n${i}` });
    graph.addNode(`m${i}`, { label: `m${i}` });
  }
  for (let i = 0; i < count; i++) {
    graph.addEdge({ id: `e${i}`, source: `n${i}`, target: `m${i}`, type: 'call' });
  }
}

function edge(i: number): XJEdge {
  return { id: `x${i}`, source: `a`, target: `b${i}`, type: 'call' };
}

describe('N-1 GraphSpace 变更日志有界：上限是常量而不是可选项', () => {
  it('MAX_CHANGE_LOG 是有限正整数（上界本身不得是 Infinity）', () => {
    expect(Number.isFinite(MAX_CHANGE_LOG)).toBe(true);
    expect(Number.isInteger(MAX_CHANGE_LOG)).toBe(true);
    expect(MAX_CHANGE_LOG).toBeGreaterThan(0);
  });

  it('恰好写满上界时不丢事件（边界不提前触发）', () => {
    // 每个 addNode 是 1 条事件、每个 addEdge 是 1 条：用 addEdge 精确控制条数。
    const graph = new GraphSpace();
    graph.addNode('a', { label: 'a' });
    const nodeEvents = graph.pendingChangeEvents; // = 1
    for (let i = 0; i < MAX_CHANGE_LOG - nodeEvents; i++) {
      graph.addNode(`b${i}`, { label: `b${i}` });
    }
    expect(graph.pendingChangeEvents).toBe(MAX_CHANGE_LOG);
    expect(graph.droppedChangeEvents).toBe(0);
  });

  it('超过上界后未消费事件数被钉在 MAX_CHANGE_LOG，丢弃数如实累计', () => {
    const graph = new GraphSpace();
    const pairCount = Math.floor(MAX_CHANGE_LOG / 2);
    const overflow = 250;
    // seedEdges 写 2·pairCount 个节点 + pairCount 条边 = 3·pairCount 条事件；
    // 再加 overflow 条边 ⇒ 总事件数 3·pairCount + overflow，必超上界。
    seedEdges(graph, pairCount);
    for (let i = 0; i < overflow; i++) graph.addEdge(edge(i));

    expect(graph.pendingChangeEvents).toBe(MAX_CHANGE_LOG);
    const totalEvents = 3 * pairCount + overflow;
    expect(graph.droppedChangeEvents).toBe(totalEvents - MAX_CHANGE_LOG);
  });

  it('N 次 addEdge 后日志长度 ≤ 上界（本项的验收断言）', () => {
    const graph = new GraphSpace();
    const N = MAX_CHANGE_LOG * 2;
    // 每条边用**不同的** source：同 source 的高出度会命中邻接去重的 O(n²)
    // （`pushAdj` 的 `list.includes`），那是 GraphSpace 的另一处已知特性，与日志无关，
    // 混进来只会让本用例测到别的东西、还把耗时放大到数秒。
    for (let i = 0; i < N; i++) {
      graph.addNode(`t${i}`, { label: `t${i}` });
      graph.addNode(`u${i}`, { label: `u${i}` });
      graph.addEdge({ id: `e${i}`, source: `t${i}`, target: `u${i}`, type: 'call' });
    }
    expect(graph.pendingChangeEvents).toBeLessThanOrEqual(MAX_CHANGE_LOG);
    // 真的写进去了 N 条（不是「没记录」）：丢弃计数必须与超额一致。
    expect(graph.droppedChangeEvents).toBe(N * 3 - MAX_CHANGE_LOG);
  });
});

describe('N-1 drainChangeLog 语义不变：返回自上次 drain 以来的事件且版本号单调', () => {
  it('drain 返回自上次 drain 以来的事件，版本号严格递增', () => {
    const graph = new GraphSpace();
    graph.addNode('a', { label: 'a' });
    graph.addNode('b', { label: 'b' });
    graph.addEdge({ id: 'e1', source: 'a', target: 'b', type: 'call' });

    const first = graph.drainChangeLog();
    expect(first.map((event) => event.kind)).toEqual(['add-node', 'add-node', 'add-edge']);
    expect(first.map((event) => event.version)).toEqual([1, 2, 3]);

    // drain 之后新增的事件不会混进已经交出去的数组
    graph.addNode('c', { label: 'c' });
    expect(first).toHaveLength(3);

    const second = graph.drainChangeLog();
    expect(second.map((event) => event.kind)).toEqual(['add-node']);
    // 版本号跨 drain 继续单调（drain 不重置 version）
    expect(second[0]!.version).toBe(4);
  });

  it('drain 后未消费数归零，但丢弃计数不清零（掩盖「从未被消费」才是真缺陷）', () => {
    const graph = new GraphSpace();
    seedEdges(graph, MAX_CHANGE_LOG);
    for (let i = 0; i < 10; i++) graph.addEdge(edge(i));
    expect(graph.pendingChangeEvents).toBe(MAX_CHANGE_LOG);
    const dropped = graph.droppedChangeEvents;
    expect(dropped).toBeGreaterThan(0);

    graph.drainChangeLog();
    expect(graph.pendingChangeEvents).toBe(0);
    expect(graph.droppedChangeEvents).toBe(dropped);
  });

  it('溢出之后 drain 到的仍是连续且单调的事件（丢的是最旧的，不是随机的）', () => {
    const graph = new GraphSpace();
    // 先写 2 个节点 → 2 条事件，它们必须是被丢掉的那两条（最旧）
    graph.addNode('a', { label: 'a' });
    graph.addNode('b', { label: 'b' });
    const overflow = 5;
    for (let i = 0; i < MAX_CHANGE_LOG + overflow; i++) {
      graph.addNode(`p${i}`, { label: `p${i}` });
    }
    const drained = graph.drainChangeLog();
    expect(drained).toHaveLength(MAX_CHANGE_LOG);
    expect(graph.droppedChangeEvents).toBe(2 + overflow);

    // 单调：相邻事件版本差恒为 1（连续），且首条正好是被保留下来的那一条——
    // 前 2 + overflow 条事件（a、b、p0..p{overflow-1}）被丢弃，故首条应是 p{overflow}。
    for (let i = 1; i < drained.length; i++) {
      expect(drained[i]!.version).toBe(drained[i - 1]!.version + 1);
    }
    expect(drained[0]!.node?.id).toBe(`p${overflow}`);
    expect(drained[drained.length - 1]!.node?.id).toBe(`p${MAX_CHANGE_LOG + overflow - 1}`);
  });

  it('环形覆盖不改变「顺序 = 写入序」（多次溢出后仍然连续单调）', () => {
    // 环形实现最容易错的地方：第一次溢出后 head 回绕，逻辑序会变成两段。
    // 这里溢出 2.5 轮，断言 drain 出来的版本号仍严格连续——splice 版与环形版都能过，
    // 但「head 忘记挪动」或「回绕后先取后段」的实现会红。
    const graph = new GraphSpace();
    const rounds = 2.5;
    const total = MAX_CHANGE_LOG * rounds;
    for (let i = 0; i < total; i++) graph.addNode(`q${i}`, { label: `q${i}` });

    const drained = graph.drainChangeLog();
    expect(drained).toHaveLength(MAX_CHANGE_LOG);
    expect(graph.droppedChangeEvents).toBe(total - MAX_CHANGE_LOG);
    for (let i = 1; i < drained.length; i++) {
      expect(drained[i]!.version).toBe(drained[i - 1]!.version + 1);
    }
    expect(drained[0]!.node?.id).toBe(`q${total - MAX_CHANGE_LOG}`);
    expect(drained[drained.length - 1]!.node?.id).toBe(`q${total - 1}`);
    // drain 之后环头归零，下一次写入从干净状态开始
    expect(graph.pendingChangeEvents).toBe(0);
    graph.addNode('after', { label: 'after' });
    expect(graph.drainChangeLog().map((event) => event.node?.id)).toEqual(['after']);
  });

  it('drain 之后环头必须归零：紧接着写入的少量事件顺序正确（M3 抓出的缺口）', () => {
    // 第一个版本只写「drain 后加 1 条再 drain」——那条用例**抓不住**「drain 忘记重置环头」：
    // 设溢出让 logHead = 3，drain 后 logHead 仍为 3，此时 log.length = 1 < 3，
    // 拉直式 `[...slice(3), ...slice(0,3)]` 恰好还原成同一个单元素数组，顺序看起来是对的。
    // 缺陷只在「写入条数跨过残留的 logHead」时才显形：所以这里必须先让 head 停在 3，
    // 再写入 5 条（> 3），拉直顺序才会错位。
    const graph = new GraphSpace();
    const total = MAX_CHANGE_LOG + 3; // 溢出 3 条 ⇒ drain 后 head 应为 3（若忘记归零）
    for (let i = 0; i < total; i++) graph.addNode(`r${i}`, { label: `r${i}` });
    graph.drainChangeLog();

    const after = 5;
    for (let i = 0; i < after; i++) graph.addNode(`s${i}`, { label: `s${i}` });
    // 顺序必须是纯写入序：任何「从残留 head 处切开再拼接」的实现都会把 s4 排到最前。
    expect(graph.drainChangeLog().map((event) => event.node?.id)).toEqual([
      's0',
      's1',
      's2',
      's3',
      's4',
    ]);
  });

  it('clear 把日志、版本与丢弃计数一起归零（新实例语义）', () => {
    const graph = new GraphSpace();
    seedEdges(graph, MAX_CHANGE_LOG);
    graph.addEdge(edge(0));
    expect(graph.droppedChangeEvents).toBeGreaterThan(0);

    graph.clear();
    expect(graph.pendingChangeEvents).toBe(0);
    expect(graph.droppedChangeEvents).toBe(0);
    expect(graph.version).toBe(0);
    expect(graph.drainChangeLog()).toEqual([]);
  });
});
