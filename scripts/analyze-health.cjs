const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('.codegraph/codegraph.db', { readOnly: true });

const EDGE_KIND_MAP = {
  'contains': 'contains',
  'calls': 'call',
  'imports': 'import',
  'extends': 'extend',
  'implements': 'implement',
  'depends_on': 'dependency',
  'uses': 'call',
};
const FILTERED_EDGE_KINDS = new Set(['uses_var', 'func_imports_local']);

const nodes = db.prepare('SELECT id, kind, name, file_path, start_line FROM nodes').all();
const edges = db.prepare('SELECT source, target, kind FROM edges').all();

const graphNodes = nodes.map(n => ({
  id: n.id,
  label: n.name,
  type: mapKindToType(n.kind),
  filePath: n.file_path || '',
  lineNumber: n.start_line || 0,
  properties: {},
}));

const graphEdges = [];
for (const e of edges) {
  if (FILTERED_EDGE_KINDS.has(e.kind)) continue;
  const mapped = EDGE_KIND_MAP[e.kind];
  if (!mapped) continue;
  graphEdges.push({
    id: `${e.source}->${e.target}:${mapped}`,
    source: e.source,
    target: e.target,
    type: mapped,
    properties: {},
  });
}

console.log('=== Graph Data ===');
console.log('Total nodes:', graphNodes.length);
console.log('Total edges:', graphEdges.length);

const nodeTypeCounts = {};
for (const n of graphNodes) nodeTypeCounts[n.type] = (nodeTypeCounts[n.type]||0)+1;
console.log('Node types:', JSON.stringify(nodeTypeCounts));

const edgeTypeCounts = {};
for (const e of graphEdges) edgeTypeCounts[e.type] = (edgeTypeCounts[e.type]||0)+1;
console.log('Edge types:', JSON.stringify(edgeTypeCounts));

function mapKindToType(kind) {
  switch (kind) {
    case 'function': return 'function';
    case 'class': return 'class';
    case 'method': return 'function';
    case 'interface': return 'interface';
    case 'type': return 'type';
    case 'enum': return 'type';
    case 'variable': return 'variable';
    case 'file': return 'module';
    case 'import': return 'module';
    case 'module': return 'module';
    default: return 'module';
  }
}

// === Build Module Map (same as HealthScorer) ===
const MAX_MODULE_DEPTH = 3;

function normalizeFilePath(filePath) {
  return filePath.replace(/^(file|import):/, '');
}

function extractModulePath(filePath, maxDepth) {
  const rawPath = normalizeFilePath(filePath);
  const parts = rawPath.split(/[\\/]/);
  const dirParts = parts.length > 1 ? parts.slice(0, -1) : [rawPath];
  return dirParts.length > maxDepth ? dirParts.slice(0, maxDepth).join('/') : dirParts.join('/');
}

const moduleOfNode = new Map();
for (const node of graphNodes) {
  moduleOfNode.set(node.id, extractModulePath(node.filePath, MAX_MODULE_DEPTH));
}

const modules = new Set();
for (const m of moduleOfNode.values()) modules.add(m);
console.log('\n=== Module Map ===');
console.log('Total modules:', modules.size);

const moduleSizes = {};
for (const m of moduleOfNode.values()) moduleSizes[m] = (moduleSizes[m]||0)+1;
const sortedModules = Object.entries(moduleSizes).sort((a,b)=>b[1]-a[1]);
console.log('Top 10 modules by size:', JSON.stringify(sortedModules.slice(0, 10)));

// === 1. Coupling (Ce/Ca/Instability) ===
console.log('\n=== 1. Coupling (Ce/Ca/Instability) ===');
const efferent = new Map();
const afferent = new Map();

for (const edge of graphEdges) {
  if (edge.type === 'contains') continue;
  const srcModule = moduleOfNode.get(edge.source);
  const tgtModule = moduleOfNode.get(edge.target);
  if (!srcModule || !tgtModule || srcModule === tgtModule) continue;

  if (!efferent.has(srcModule)) efferent.set(srcModule, new Set());
  efferent.get(srcModule).add(tgtModule);

  if (!afferent.has(tgtModule)) afferent.set(tgtModule, new Set());
  afferent.get(tgtModule).add(srcModule);
}

let totalInstability = 0;
let moduleCount = 0;
const moduleInstabilities = [];
for (const mod of modules) {
  const ce = efferent.get(mod)?.size ?? 0;
  const ca = afferent.get(mod)?.size ?? 0;
  if (ce + ca === 0) continue;
  const instability = ce / (ce + ca);
  totalInstability += instability;
  moduleCount++;
  moduleInstabilities.push({ mod, ce, ca, instability });
}
const avgInstability = moduleCount > 0 ? totalInstability / moduleCount : 0;
const couplingScore = Math.round(Math.max(0, 100 - avgInstability * 100));
console.log('Modules with coupling:', moduleCount);
console.log('Avg Instability:', avgInstability.toFixed(3));
console.log('Coupling Score:', couplingScore);
console.log('Top 5 most unstable modules:', JSON.stringify(
  moduleInstabilities.sort((a,b)=>b.instability-a.instability).slice(0,5).map(m=>({
    mod: m.mod, Ce: m.ce, Ca: m.ca, I: m.instability.toFixed(2)
  }))
));

// === 2. Cohesion (weighted by module size) ===
console.log('\n=== 2. Cohesion (node-size-weighted) ===');
const moduleStats = new Map();
for (const node of graphNodes) {
  const mod = moduleOfNode.get(node.id);
  if (!mod) continue;
  if (!moduleStats.has(mod)) moduleStats.set(mod, { internal: 0, total: 0, nodeCount: 0 });
  moduleStats.get(mod).nodeCount++;
}

for (const edge of graphEdges) {
  if (edge.type === 'contains') continue;
  const srcModule = moduleOfNode.get(edge.source);
  const tgtModule = moduleOfNode.get(edge.target);
  if (!srcModule && !tgtModule) continue;

  if (srcModule && tgtModule && srcModule === tgtModule) {
    const stats = moduleStats.get(srcModule) || { internal: 0, total: 0, nodeCount: 0 };
    stats.total++; stats.internal++;
    moduleStats.set(srcModule, stats);
  } else {
    if (srcModule) {
      const stats = moduleStats.get(srcModule) || { internal: 0, total: 0, nodeCount: 0 };
      stats.total++;
      moduleStats.set(srcModule, stats);
    }
    if (tgtModule) {
      const stats = moduleStats.get(tgtModule) || { internal: 0, total: 0, nodeCount: 0 };
      stats.total++;
      moduleStats.set(tgtModule, stats);
    }
  }
}

let weightedCohesion = 0;
let totalNodes = 0;
for (const stats of moduleStats.values()) {
  if (stats.nodeCount === 0) continue;
  const cohesionRatio = stats.total > 0 ? stats.internal / stats.total : 0;
  weightedCohesion += cohesionRatio * stats.nodeCount;
  totalNodes += stats.nodeCount;
}
const cohesionScore = totalNodes > 0 ? Math.round((weightedCohesion / totalNodes) * 100) : 50;
console.log('Cohesion Score:', cohesionScore);

// === 3. Cyclic Dependency Rate ===
console.log('\n=== 3. Cyclic Dependency Rate ===');
const cycleEdgeTypes = ['call', 'extend', 'implement', 'import'];
const adjacency = new Map();
const nodeIds = new Set();
for (const edge of graphEdges) {
  if (!cycleEdgeTypes.includes(edge.type)) continue;
  if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
  adjacency.get(edge.source).push(edge.target);
  nodeIds.add(edge.source);
  nodeIds.add(edge.target);
}
console.log('Nodes participating in cycle detection:', nodeIds.size);

// Tarjan SCC
let index = 0;
const indices = new Map();
const lowLinks = new Map();
const onStack = new Set();
const stack = [];
const sccs = [];

for (const startId of nodeIds) {
  if (indices.has(startId)) continue;
  const callStack = [{ v: startId, neighborIdx: 0, neighbors: adjacency.get(startId) || [] }];
  while (callStack.length > 0) {
    const frame = callStack[callStack.length - 1];
    const v = frame.v;
    if (frame.neighborIdx === 0) {
      indices.set(v, index); lowLinks.set(v, index); index++;
      stack.push(v); onStack.add(v);
    }
    if (frame.neighborIdx < frame.neighbors.length) {
      const w = frame.neighbors[frame.neighborIdx]; frame.neighborIdx++;
      if (!indices.has(w)) {
        callStack.push({ v: w, neighborIdx: 0, neighbors: adjacency.get(w) || [] });
      } else if (onStack.has(w)) {
        lowLinks.set(v, Math.min(lowLinks.get(v), indices.get(w)));
      }
    } else {
      if (lowLinks.get(v) === indices.get(v)) {
        const scc = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); scc.push(w); } while (w !== v);
        sccs.push(scc);
      }
      callStack.pop();
      if (callStack.length > 0) {
        const parent = callStack[callStack.length - 1];
        lowLinks.set(parent.v, Math.min(lowLinks.get(parent.v), lowLinks.get(v)));
      }
    }
  }
}

let cycleNodeCount = 0;
for (const scc of sccs) {
  if (scc.length > 1) {
    cycleNodeCount += scc.length;
  } else if (scc.length === 1) {
    const id = scc[0];
    const neighbors = adjacency.get(id);
    if (neighbors && neighbors.includes(id)) cycleNodeCount++;
  }
}
const cycleRate = nodeIds.size > 0 ? cycleNodeCount / nodeIds.size : 0;
const cyclicScore = Math.round(Math.max(0, 100 - cycleRate * 100));
console.log('SCCs found:', sccs.length);
console.log('Cycle nodes:', cycleNodeCount);
console.log('Cycle rate:', cycleRate.toFixed(3));
console.log('Cyclic Dependency Rate Score:', cyclicScore);

// Show cyclic SCCs
const cyclicSCCs = sccs.filter(s => s.length > 1);
if (cyclicSCCs.length > 0) {
  console.log('Cyclic SCCs:', cyclicSCCs.length);
  cyclicSCCs.slice(0, 5).forEach((scc, i) => {
    console.log(`  SCC ${i+1} (${scc.length} nodes):`, scc.slice(0, 5).map(id => {
      const node = graphNodes.find(n => n.id === id);
      return node ? `${node.label} (${node.filePath})` : id;
    }).join(' -> '));
  });
}

// === 4. Modularity (Newman's Q simplified) ===
console.log('\n=== 4. Modularity (Newman Q simplified) ===');
const avgSize = graphNodes.length / modules.size;
let sizeVariance = 0;
for (const size of Object.values(moduleSizes)) {
  sizeVariance += (size - avgSize) ** 2;
}
sizeVariance /= modules.size;
const cv = Math.sqrt(sizeVariance) / Math.max(1, avgSize);
const balanceScore = Math.max(0, 100 - cv * 50);

let internalEdges = 0;
let totalRelevantEdges = 0;
for (const edge of graphEdges) {
  if (edge.type === 'contains') continue;
  const srcModule = moduleOfNode.get(edge.source);
  const tgtModule = moduleOfNode.get(edge.target);
  if (!srcModule || !tgtModule) continue;
  totalRelevantEdges++;
  if (srcModule === tgtModule) internalEdges++;
}
const internalRatio = totalRelevantEdges > 0 ? internalEdges / totalRelevantEdges : 0;
const expectedRatio = 1 / modules.size;
const modularityQ = internalRatio - expectedRatio;
const separationScore = Math.max(0, Math.min(100, modularityQ * 100 * modules.size + 50));
const modularityScore = Math.round((balanceScore + separationScore) / 2);
console.log('Avg module size:', avgSize.toFixed(1));
console.log('CV (coefficient of variation):', cv.toFixed(3));
console.log('Balance score:', balanceScore.toFixed(1));
console.log('Internal edge ratio:', internalRatio.toFixed(3));
console.log('Expected ratio:', expectedRatio.toFixed(3));
console.log('Modularity Q:', modularityQ.toFixed(3));
console.log('Separation score:', separationScore.toFixed(1));
console.log('Modularity Score:', modularityScore);

// === Overall ===
console.log('\n=== Overall Score ===');
const overall = Math.round(
  couplingScore * 0.25 + cohesionScore * 0.25 + cyclicScore * 0.30 + modularityScore * 0.20
);
console.log('Coupling:', couplingScore, '(25%)');
console.log('Cohesion:', cohesionScore, '(25%)');
console.log('Cyclic Dep Rate:', cyclicScore, '(30%)');
console.log('Modularity:', modularityScore, '(20%)');
console.log('Overall:', overall);

db.close();
