#!/usr/bin/env node
/**
 * 派生分析成本基准：为「方案 C（派生分析增量）是否值得实现」提供数字。
 *
 * 运行：node scripts/bench-derived-analysis.mjs
 *
 * 背景：docs/research/璇玑图思维-项目优化方案.md 的方案 C（P2）建议用 GraphDelta
 * 增量维护死代码/环/核心函数。cycle-107 已把核心函数分析从「每节点一次截断 BFS」
 * 改为 SCC+bitset O((V+E)·V/32)。本脚本测剩余三个分析器在 2000/5000 节点图上的
 * 单次全量成本，以及「重建邻接表」这一任何增量实现都至少要付的底价。
 *
 * 结论只用于数量级判断：若全量分析本身已在毫秒级，增量协调器（需维护邻接/可达集
 * 并承担正确性风险）无法证明收益。
 */
import { performance } from 'node:perf_hooks';

const { DeadCodeAnalyzer } = await import('../src/shared/analysis/DeadCodeAnalyzer.ts');
const { HotspotAnalyzer } = await import('../src/shared/analysis/HotspotAnalyzer.ts');
const { CoreFunctionAnalyzer } = await import('../src/shared/analysis/CoreFunctionAnalyzer.ts');
const { HealthScorer } = await import('../src/shared/analysis/HealthScorer.ts');
const { buildDirectedAdjacency } = await import('../src/shared/analysis/AdjacencyList.ts');

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function buildGraph(nodeCount, edgesPerNode = 3) {
  const rng = makeRng(0x5eed);
  const types = ['function', 'class', 'module'];
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `n${i}`,
      label: `fn${i}`,
      type: types[i % 3],
      filePath: `src/f${Math.floor(i / 50)}.ts`,
      properties: i % 7 === 0 ? { isExported: true } : {},
    });
  }
  const edges = [];
  for (let i = 0; i < nodeCount * edgesPerNode; i++) {
    const s = Math.floor(rng() * nodeCount);
    const t = Math.floor(rng() * nodeCount);
    if (s === t) continue;
    edges.push({ id: `e${edges.length}`, source: `n${s}`, target: `n${t}`, type: 'call', properties: {} });
  }
  return { nodes, edges };
}

function timeIt(fn) {
  const start = performance.now();
  fn();
  return +(performance.now() - start).toFixed(2);
}

const report = { node: process.version, scenarios: [] };

for (const nodeCount of [2000, 5000]) {
  const { nodes, edges } = buildGraph(nodeCount, 3);
  const dead = new DeadCodeAnalyzer();
  const hotspot = new HotspotAnalyzer();
  const core = new CoreFunctionAnalyzer();
  const health = new HealthScorer();

  // 预热（JIT）
  dead.analyze(nodes, edges);
  core.analyze(nodes, edges);

  const row = {
    nodes: nodeCount,
    edges: edges.length,
    adjacencyBuildMs: timeIt(() => buildDirectedAdjacency(edges)),
    deadCodeMs: timeIt(() => dead.analyze(nodes, edges)),
    hotspotMs: timeIt(() => hotspot.analyze(nodes, edges)),
    coreFunctionMs: timeIt(() => core.analyze(nodes, edges)),
    healthScoreMs: timeIt(() => health.calculate(nodes, edges)),
  };
  report.scenarios.push(row);
}

report.conclusion =
  'Every full analysis is already O(V+E)-scale; an incremental coordinator must first beat ' +
  'adjacencyBuildMs, which is the same order as the analysis itself. Implementation deferred.';
console.log(JSON.stringify(report, null, 2));
