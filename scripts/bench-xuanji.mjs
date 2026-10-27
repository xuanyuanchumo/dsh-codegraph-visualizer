#!/usr/bin/env node
/**
 * 璇玑图（xuanji）算法库基准：为 cycle-107 非功能验证提供可复现数字。
 *
 * 运行：node scripts/bench-xuanji.mjs
 *
 * 三个场景对应三份研究文档的核心主张：
 * 1) 输出敏感可达：旧「每节点一次截断 BFS」vs 新「SCC + bitset 精确闭包」；
 * 2) 增量优先：注册规则后「单边 onEdgeAdded」vs「整图重新全量枚举」；
 * 3) 路径读法：适配层 findPathsBetween 在中等图上的吞吐（工具的一次调用成本）。
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
const { XuanjiAdapter } = await import('../src/shared/analysis/XuanjiAdapter.ts');

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

console.log(JSON.stringify(report, null, 2));
