import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { buildModuleMap } from './modulePath.ts';
import { HEALTH_SCORE } from '../constants.ts';

export interface HealthScore {
  coupling: number;
  cohesion: number;
  cyclicDependencyRate: number;
  modularity: number;
  overall: number;
}

export interface ScoreDimension {
  name: string;
  score: number;
  description: string;
}

const EDGE_WEIGHTS: Record<GraphEdge['type'], number> = {
  call: 1.0,
  extend: 0.8,
  implement: 0.7,
  import: 0.5,
  dependency: 0.3,
  contains: 0.0,
  association: 0.6,
  aggregation: 0.5,
  composition: 0.7,
};

const DEFAULT_MAX_MODULE_DEPTH = HEALTH_SCORE.DEFAULT_MAX_MODULE_DEPTH;

export class HealthScorer {
  private readonly maxModuleDepth: number;

  constructor(maxModuleDepth?: number) {
    this.maxModuleDepth = maxModuleDepth ?? DEFAULT_MAX_MODULE_DEPTH;
  }

  calculate(nodes: GraphNode[], edges: GraphEdge[]): HealthScore {
    if (nodes.length === 0) {
      return { coupling: 0, cohesion: 0, cyclicDependencyRate: 0, modularity: 0, overall: 0 };
    }

    const moduleOfNode = buildModuleMap(nodes, this.maxModuleDepth);

    const coupling = this.calculateCoupling(edges, moduleOfNode);
    const cohesion = this.calculateCohesion(nodes, edges, moduleOfNode);
    const cyclicDependencyRate = this.calculateCyclicDependencyRate(nodes, edges);
    const modularity = this.calculateModularity(nodes, edges, moduleOfNode);
    const overall = Math.round(
      coupling * HEALTH_SCORE.WEIGHT_COUPLING + cohesion * HEALTH_SCORE.WEIGHT_COHESION + cyclicDependencyRate * HEALTH_SCORE.WEIGHT_CYCLIC + modularity * HEALTH_SCORE.WEIGHT_MODULARITY,
    );

    return { coupling, cohesion, cyclicDependencyRate, modularity, overall };
  }

  getDimensions(score: HealthScore): ScoreDimension[] {
    return [
      { name: 'coupling', score: score.coupling, description: 'Lower inter-module coupling is better' },
      { name: 'cohesion', score: score.cohesion, description: 'Higher intra-module cohesion is better' },
      { name: 'cyclicDependencyRate', score: score.cyclicDependencyRate, description: 'Fewer circular dependencies is better' },
      { name: 'modularity', score: score.modularity, description: 'Better module separation is better' },
    ];
  }

  private calculateCoupling(edges: GraphEdge[], moduleOfNode: Map<string, string>): number {
    if (edges.length === 0) return 100;

    const efferent = new Map<string, Set<string>>();
    const afferent = new Map<string, Set<string>>();

    for (const edge of edges) {
      if (EDGE_WEIGHTS[edge.type] === 0) continue;
      const srcModule = moduleOfNode.get(edge.source);
      const tgtModule = moduleOfNode.get(edge.target);
      if (!srcModule || !tgtModule || srcModule === tgtModule) continue;

      let eff = efferent.get(srcModule);
      if (!eff) { eff = new Set(); efferent.set(srcModule, eff); }
      eff.add(tgtModule);

      let aff = afferent.get(tgtModule);
      if (!aff) { aff = new Set(); afferent.set(tgtModule, aff); }
      aff.add(srcModule);
    }

    const modules = new Set<string>();
    for (const m of moduleOfNode.values()) modules.add(m);
    if (modules.size <= 1) return 100;

    let totalInstability = 0;
    for (const mod of modules) {
      const ce = (efferent.get(mod)?.size ?? 0);
      const ca = (afferent.get(mod)?.size ?? 0);
      const instability = ce + ca === 0 ? 0 : ce / (ce + ca);
      totalInstability += instability;
    }

    if (modules.size === 0) return 100;
    const avgInstability = totalInstability / modules.size;
    return Math.round(Math.max(0, 100 - avgInstability * 100));
  }

  private calculateCohesion(nodes: GraphNode[], edges: GraphEdge[], moduleOfNode: Map<string, string>): number {
    const moduleStats = new Map<string, { internal: number; total: number; nodeCount: number }>();

    const ensure = (m: string) => {
      let stats = moduleStats.get(m);
      if (!stats) { stats = { internal: 0, total: 0, nodeCount: 0 }; moduleStats.set(m, stats); }
      return stats;
    };

    for (const node of nodes) {
      const mod = moduleOfNode.get(node.id);
      if (mod) ensure(mod).nodeCount++;
    }

    for (const edge of edges) {
      if (EDGE_WEIGHTS[edge.type] === 0) continue;
      const srcModule = moduleOfNode.get(edge.source);
      const tgtModule = moduleOfNode.get(edge.target);
      if (!srcModule && !tgtModule) continue;

      if (srcModule && tgtModule && srcModule === tgtModule) {
        const stats = ensure(srcModule);
        stats.total++;
        stats.internal++;
      } else {
        if (srcModule) ensure(srcModule).total++;
        if (tgtModule) ensure(tgtModule).total++;
      }
    }

    if (moduleStats.size === 0) return 50;

    let weightedCohesion = 0;
    let totalNodes = 0;
    for (const stats of moduleStats.values()) {
      if (stats.nodeCount === 0) continue;
      const cohesionRatio = stats.total > 0 ? stats.internal / stats.total : 0;
      weightedCohesion += cohesionRatio * stats.nodeCount;
      totalNodes += stats.nodeCount;
    }

    if (totalNodes === 0) return 50;
    return Math.round((weightedCohesion / totalNodes) * 100);
  }

  private calculateCyclicDependencyRate(nodes: GraphNode[], edges: GraphEdge[]): number {
    const cycleEdgeTypes: GraphEdge['type'][] = ['call', 'extend', 'implement', 'import'];
    const adjacency = new Map<string, string[]>();
    const nodeIds = new Set<string>();

    for (const edge of edges) {
      if (!cycleEdgeTypes.includes(edge.type)) continue;
      const list = adjacency.get(edge.source);
      if (list) list.push(edge.target);
      else adjacency.set(edge.source, [edge.target]);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }

    if (nodeIds.size === 0) return 100;

    const sccs = this.tarjanSCC(adjacency, nodeIds);
    let cycleNodeCount = 0;
    for (const scc of sccs) {
      if (scc.length > 1) {
        cycleNodeCount += scc.length;
      } else if (scc.length === 1) {
        const id = scc[0]!;
        const neighbors = adjacency.get(id);
        if (neighbors && neighbors.includes(id)) {
          cycleNodeCount++;
        }
      }
    }

    const cycleRate = cycleNodeCount / nodeIds.size;
    return Math.round(Math.max(0, 100 - cycleRate * 100));
  }

  private calculateModularity(nodes: GraphNode[], edges: GraphEdge[], moduleOfNode: Map<string, string>): number {
    if (nodes.length === 0) return 0;

    const modules = new Set<string>();
    for (const m of moduleOfNode.values()) modules.add(m);

    if (modules.size <= 1) return 50;

    const moduleSizes = new Map<string, number>();
    for (const m of moduleOfNode.values()) {
      moduleSizes.set(m, (moduleSizes.get(m) ?? 0) + 1);
    }

    const avgSize = nodes.length / modules.size;
    let sizeVariance = 0;
    for (const size of moduleSizes.values()) {
      sizeVariance += (size - avgSize) ** 2;
    }
    sizeVariance /= modules.size;
    const cv = Math.sqrt(sizeVariance) / Math.max(1, avgSize);
    const balanceScore = Math.max(0, 100 - cv * 50);

    let internalEdges = 0;
    let totalRelevantEdges = 0;
    for (const edge of edges) {
      if (EDGE_WEIGHTS[edge.type] === 0) continue;
      const srcModule = moduleOfNode.get(edge.source);
      const tgtModule = moduleOfNode.get(edge.target);
      if (!srcModule || !tgtModule) continue;
      totalRelevantEdges++;
      if (srcModule === tgtModule) internalEdges++;
    }

    if (totalRelevantEdges === 0) return Math.round(balanceScore);
    const internalRatio = internalEdges / totalRelevantEdges;
    const expectedRatio = 1 / modules.size;
    const modularityQ = internalRatio - expectedRatio;
    const separationScore = Math.max(0, Math.min(100, modularityQ * 100 * modules.size + 50));

    return Math.round((balanceScore + separationScore) / 2);
  }

  private tarjanSCC(
    adjacency: Map<string, string[]>,
    nodeIds: Set<string>,
  ): string[][] {
    let index = 0;
    const indices = new Map<string, number>();
    const lowLinks = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];

    for (const startId of nodeIds) {
      if (indices.has(startId)) continue;

      const callStack: Array<{ v: string; neighborIdx: number; neighbors: string[] }> = [];
      callStack.push({ v: startId, neighborIdx: 0, neighbors: adjacency.get(startId) ?? [] });

      while (callStack.length > 0) {
        const frame = callStack[callStack.length - 1]!;
        const v = frame.v;

        if (frame.neighborIdx === 0) {
          indices.set(v, index);
          lowLinks.set(v, index);
          index++;
          stack.push(v);
          onStack.add(v);
        }

        if (frame.neighborIdx < frame.neighbors.length) {
          const w = frame.neighbors[frame.neighborIdx]!;
          frame.neighborIdx++;

          if (!indices.has(w)) {
            callStack.push({ v: w, neighborIdx: 0, neighbors: adjacency.get(w) ?? [] });
          } else if (onStack.has(w)) {
            lowLinks.set(v, Math.min(lowLinks.get(v)!, indices.get(w)!));
          }
        } else {
          if (lowLinks.get(v) === indices.get(v)) {
            const scc: string[] = [];
            let w: string;
            do {
              w = stack.pop()!;
              onStack.delete(w);
              scc.push(w);
            } while (w !== v);
            sccs.push(scc);
          }

          callStack.pop();
          if (callStack.length > 0) {
            const parentFrame = callStack[callStack.length - 1]!;
            lowLinks.set(parentFrame.v, Math.min(lowLinks.get(parentFrame.v)!, lowLinks.get(v)!));
          }
        }
      }
    }

    return sccs;
  }
}
