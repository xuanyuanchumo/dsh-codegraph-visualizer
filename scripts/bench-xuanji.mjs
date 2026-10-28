#!/usr/bin/env node
/**
 * 璇玑图（xuanji）算法库基准：为 cycle-107 非功能验证提供可复现数字。
 *
 * 运行：node scripts/bench-xuanji.mjs
 *
 * 三个场景对应三份研究文档的核心主张：
 * 1) 输出敏感可达：旧「每节点一次截断 BFS」vs 新「SCC + bitset 精确闭包」；
 * 2) 增量优先：注册规则后「单边 onEdgeAdded」vs「整图重新全量枚举」；
 * 3) 路径读法：适配层 findPathsBetween 在中等图上的吞吐（工具的一次调用成本）；
 * 4) cycle-110 XJ-14：**每次调用重建的成本**——A 组「每次 new 适配层 + loadGraph」
 *    （XJ-02 之前的现状）vs B 组「池化复用 + syncGraph 增量」。ratio 是「XJ-02 值不值」的
 *    决策依据；< 1.5 就说明收益主要不是性能，而是索引正确性 / 增量链路存在性。
 *
 * 结果只用于数量级对照（Windows + Node v24.21.0），不作为门禁。
 */
import { performance } from 'node:perf_hooks';

const { bfsReachCount } = await import('../src/shared/analysis/GraphBFS.ts');
const { computeReachCounts } = await import('../src/shared/analysis/batchReach.ts');
const { GraphSpace } = await import('../src/xuanji/core/graph-space.ts');
const { PathIndex } = await import('../src/xuanji/index/path-index.ts');
const { enumerate } = await import('../src/xuanji/query/query-engine.ts');
const { onEdgeAdded } = await import('../src/xuanji/index/incremental.ts');
const { XuanjiAdapter, XuanjiAdapterPool } = await import('../src/shared/analysis/XuanjiAdapter.ts');

/** 固定种子 LCG：基准必须可复现。 */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function buildCallGraph(nodeCount, extraEdges, seed = 0x51ee7) {
  const rng = makeRng(seed);
  const outEdges = new Map();
  const ids = Array.from({ length: nodeCount }, (_, i) => `f${i}`);
  const push = (s, t) => {
    let list = outEdges.get(s);
    if (!list) outEdges.set(s, (list = []));
    list.push(t);
  };
  // 链：保证长距离可达（旧实现的截断在 >500 时触发）
  for (let i = 0; i + 1 < nodeCount; i++) push(ids[i], ids[i + 1]);
  for (let i = 0; i < extraEdges; i++) {
    push(ids[Math.floor(rng() * nodeCount)], ids[Math.floor(rng() * nodeCount)]);
  }
  return { ids, outEdges };
}

function timeIt(fn) {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
}

const report = { node: process.version, scenarios: {} };

// ── 1) 可达计数：旧逐点截断 BFS vs 新 SCC+bitset ──────────────────────
{
  const N = 3000;
  const { ids, outEdges } = buildCallGraph(N, 3000);
  const legacy = timeIt(() => {
    const map = new Map();
    for (const id of ids) map.set(id, bfsReachCount(outEdges, id, 500));
    return map;
  });
  const modern = timeIt(() => computeReachCounts(outEdges, ids));
  let sumLegacy = 0;
  for (const v of legacy.value.values()) sumLegacy += v;
  let sumModern = 0;
  for (const v of modern.value.values()) sumModern += v;
  report.scenarios.reach = {
    nodes: N,
    edges: [...outEdges.values()].reduce((acc, l) => acc + l.length, 0),
    legacyMs: +legacy.ms.toFixed(1),
    modernMs: +modern.ms.toFixed(1),
    speedup: +(legacy.ms / Math.max(modern.ms, 0.001)).toFixed(2),
    sumLegacy,
    sumModern,
    note: '旧值受 MAX_BFS_NODES=500 截断且与 BFS 顺序相关；新值为精确可达数',
  };
}

// ── 2) 增量维护：单边 onEdgeAdded vs 整图重新枚举 ────────────────────
{
  const N = 800;
  const rng = makeRng(0xbadc0de);
  const space = new GraphSpace();
  for (let i = 0; i < N; i++) space.addNode(`n${i}`, { label: `n${i}`, role: 'fn' });
  const types = ['call'];
  const addRandomEdge = () => {
    const s = `n${Math.floor(rng() * N)}`;
    const t = `n${Math.floor(rng() * N)}`;
    return space.addEdge({ id: `${s}->${t}`, source: s, target: t, type: 'call' });
  };
  let added = 0;
  while (added < 1600) if (addRandomEdge()) added++;

  const rule = {
    name: 'cycles-bench',
    version: 1,
    start: () => true,
    edgeTypes: new Set(types),
    lMin: 1,
    lMax: 4,
    simple: true,
    closed: true,
    normalize: 'canonical',
    output: (nodes) => nodes,
  };

  const full = timeIt(() => {
    const index = new PathIndex();
    enumerate(space, rule, [...space.nodeIds()], index);
    return index;
  });

  // 50 条新边：逐条增量
  const newEdges = [];
  let attempts = 0;
  while (newEdges.length < 50 && attempts < 5000) {
    attempts++;
    const s = `n${Math.floor(rng() * N)}`;
    const t = `n${Math.floor(rng() * N)}`;
    const edge = { id: `${s}->${t}->call`, source: s, target: t, type: 'call' };
    if (space.hasEdge(s, t, 'call')) continue;
    newEdges.push(edge);
  }

  const index = full.value;
  const incremental = timeIt(() => {
    let materialized = 0;
    for (const edge of newEdges) {
      if (!space.addEdge(edge)) continue;
      materialized += onEdgeAdded(edge, rule, space, index).length;
    }
    return materialized;
  });

  // 同样 50 条边之后的整图重新枚举成本
  const rebuild = timeIt(() => {
    const fresh = new PathIndex();
    enumerate(space, rule, [...space.nodeIds()], fresh);
    return fresh;
  });

  report.scenarios.incremental = {
    nodes: N,
    baseEdges: added,
    newEdges: newEdges.length,
    fullEnumerateMs: +full.ms.toFixed(1),
    indexedPaths: full.value.counters.total,
    incrementalMs: +incremental.ms.toFixed(1),
    incrementalPathsAdded: incremental.value,
    reEnumerateMs: +rebuild.ms.toFixed(1),
    speedupVsReEnumerate: +(rebuild.ms / Math.max(incremental.ms, 0.001)).toFixed(2),
    note: '增量成本随「经过新边的路径数」增长，而不是随图规模增长',
  };
}

// ── 3) 路径读法（工具调用成本）────────────────────────────────────────
{
  const N = 1200;
  const rng = makeRng(0xabcdef);
  const adapter = new XuanjiAdapter();
  const nodes = [];
  for (let i = 0; i < N; i++) {
    nodes.push({ id: `n${i}`, label: `n${i}`, type: 'function', filePath: `f${i}.ts`, properties: {} });
  }
  const edges = [];
  // 「梯子」：每层有 +1 / +2 两条前向边，n0→n10 在 5 跳内有多条不同路径
  for (let i = 0; i + 1 < N; i++) {
    edges.push({ id: `e${edges.length}`, source: `n${i}`, target: `n${i + 1}`, type: 'call', properties: {} });
  }
  for (let i = 0; i + 2 < N; i++) {
    edges.push({ id: `e${edges.length}`, source: `n${i}`, target: `n${i + 2}`, type: 'call', properties: {} });
  }
  for (let i = 0; i < 2400; i++) {
    const s = `n${Math.floor(rng() * N)}`;
    const t = `n${Math.floor(rng() * (N - 1)) + 1}`;
    edges.push({ id: `e${edges.length}`, source: s, target: t, type: 'call', properties: {} });
  }
  adapter.loadGraph({ nodes, edges });
  const loadMs = performance.now();
  const result = adapter.findPathsBetween('n0', 'n8', { maxHops: 5, limit: 20 });
  report.scenarios.pathEnumeration = {
    nodes: N,
    edges: edges.length,
    elapsedMs: +(performance.now() - loadMs).toFixed(1),
    paths: result.total,
    truncated: result.truncated,
    note: 'loadGraph 不计入 elapsedMs 之前（adapter 已装载）；一次工具调用的读法成本',
  };
}

// ── 4) XJ-14：每次调用重建（A）vs 池化复用+增量（B）────────────────────
{
  const N = 600;
  const CALLS = 5;
  const baseNodes = [];
  for (let i = 0; i < N; i++) {
    baseNodes.push({ id: `n${i}`, label: `n${i}`, type: 'function', filePath: `f${i}.ts`, properties: {} });
  }
  const baseEdges = [];
  for (let i = 0; i + 1 < N; i++) {
    baseEdges.push({ id: `e${baseEdges.length}`, source: `n${i}`, target: `n${i + 1}`, type: 'call', properties: {} });
  }
  for (let i = 0; i + 2 < N; i++) {
    baseEdges.push({ id: `e${baseEdges.length}`, source: `n${i}`, target: `n${i + 2}`, type: 'call', properties: {} });
  }
  // 少量回边，让 cycles() 有东西可读（否则 B 组测到的只是空枚举）
  for (let i = 0; i + 10 < N; i += 10) {
    baseEdges.push({ id: `e${baseEdges.length}`, source: `n${i + 10}`, target: `n${i}`, type: 'call', properties: {} });
  }

  // A 组：每次调用都 new 适配层 + loadGraph（XJ-02 之前 src/tools.ts 的真实行为）
  const aStart = performance.now();
  const aCounts = [];
  for (let call = 0; call < CALLS; call++) {
    const perCallStart = performance.now();
    const adapter = new XuanjiAdapter();
    adapter.loadGraph({ nodes: baseNodes, edges: baseEdges });
    const cycles = adapter.cycles({ limit: 20 });
    aCounts.push(cycles.total);
    if (call === CALLS - 1) report.__lastACallMs = performance.now() - perCallStart;
  }
  const aTotalMs = performance.now() - aStart;

  // B 组：池化复用（同一 graph 逐轮补一条边 ⇒ syncGraph 判定 'delta'）
  const pool = new XuanjiAdapterPool();
  const bEdges = [...baseEdges];
  const bOutcomes = [];
  const bStart = performance.now();
  let bCount = 0;
  let bLastCallMs = 0;
  for (let call = 0; call < CALLS; call++) {
    const perCallStart = performance.now();
    const adapter = pool.get('bench-repo');
    const outcome = adapter.syncGraph({
      nodes: baseNodes,
      edges: bEdges,
      metadata: { timestamp: 1000 + call },
    });
    bOutcomes.push(outcome);
    const cycles = adapter.cycles({ limit: 20 });
    bCount = cycles.total;
    bLastCallMs = performance.now() - perCallStart;
    // 下一轮的新边（纯增补，因此 syncGraph 应判 'delta'）
    const tail = (call * 3) % (N - 5);
    bEdges.push({
      id: `delta-${call}`,
      source: `n${tail}`,
      target: `n${(tail + 3) % N}`,
      type: 'call',
      properties: {},
    });
  }
  const bTotalMs = performance.now() - bStart;
  pool.dispose();

  const aPerCallMs = aTotalMs / CALLS;
  const bPerCallMs = bTotalMs / CALLS;
  report.scenarios.rebuildPerCall = {
    nodes: N,
    edges: baseEdges.length,
    calls: CALLS,
    aEveryCallRebuildMs: +aPerCallMs.toFixed(2),
    bPooledIncrementalMs: +bPerCallMs.toFixed(2),
    ratio: +(aPerCallMs / Math.max(bPerCallMs, 0.001)).toFixed(2),
    bSyncOutcomes: bOutcomes,
    cyclesA: aCounts.at(-1),
    cyclesB: bCount,
    lastCallAms: +report.__lastACallMs.toFixed(2),
    lastCallBms: +bLastCallMs.toFixed(2),
    note:
      'B 组省下的是 GraphSpace 重建与全量装载；两条读法本身仍是全量枚举（adapter 用独立索引），' +
      '因此 ratio 只反映「每次调用重建」的成本。ratio < 1.5 时 XJ-02 的收益应表述为索引正确性/增量链路，而非性能。',
  };
  delete report.__lastACallMs;
}

console.log(JSON.stringify(report, null, 2));
