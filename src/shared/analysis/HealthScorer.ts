import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { buildModuleMap } from './modulePath.ts';

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
  contains: 0.1,
};

const DEFAULT_MAX_MODULE_DEPTH = 3;

export class HealthScorer {
  private readonly maxModuleDepth: number;

  constructor(maxModuleDepth?: number) {
    this.maxModuleDepth = maxModuleDepth ?? DEFAULT_MAX_MODULE_DEPTH;
  }

  calculate(nodes: GraphNode[], edges: GraphEdge[]): HealthScore {
    if (nodes.length === 0) {
      return { coupling: 0, cohesion: 0, cyclicDependencyRate: 0, modularity: 0, overall: 0 };
    }

    const moduleOfNode = this.buildModuleMap(nodes);

    const coupling = this.calculateCoupling(nodes, edges, moduleOfNode);
    const cohesion = this.calculateCohesion(nodes, edges, moduleOfNode);
    const cyclicDependencyRate = this.calculateCyclicDependencyRate(nodes, edges);
    const modularity = this.calculateModularity(nodes, edges, moduleOfNode);
    const overall = Math.round(
      coupling * 0.25 + cohesion * 0.25 + cyclicDependencyRate * 0.30 + modularity * 0.20,
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

  private calculateCoupling(nodes: GraphNode[], edges: GraphEdge[], moduleOfNode: Map<string, string>): number {
    if (edges.length === 0) return 100;


    let weightedCrossModule = 0;
    let totalWeight = 0;

    for (const edge of edges) {
      const weight = EDGE_WEIGHTS[edge.type] ?? 0.5;
      totalWeight += weight;
      const srcModule = moduleOfNode.get(edge.source);
      const tgtModule = moduleOfNode.get(edge.target);
      if (srcModule && tgtModule && srcModule !== tgtModule) {
        weightedCrossModule += weight;
      }
    }

    if (totalWeight === 0) return 100;
    const couplingRatio = weightedCrossModule / totalWeight;
    return Math.round(Math.max(0, 100 - couplingRatio * 100));
  }

  private calculateCohesion(nodes: GraphNode[], edges: GraphEdge[], moduleOfNode: Map<string, string>): number {
    const moduleEdges = new Map<string, { internal: number; total: number }>();

    const ensure = (m: string) => {
      let stats = moduleEdges.get(m);
      if (!stats) { stats = { internal: 0, total: 0 }; moduleEdges.set(m, stats); }
      return stats;
    };

    for (const edge of edges) {
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

    if (moduleEdges.size === 0) return 50;

    let totalCohesion = 0;
    let moduleCount = 0;
    for (const stats of moduleEdges.values()) {
      if (stats.total > 0) {
        totalCohesion += stats.internal / stats.total;
        moduleCount++;
      }
    }

    if (moduleCount === 0) return 50;
    return Math.round((totalCohesion / moduleCount) * 100);
  }

  private calculateCyclicDependencyRate(nodes: GraphNode[], edges: GraphEdge[]): number {
    if (edges.length === 0) return 100;

    const cycleEdgeTypes: GraphEdge['type'][] = ['call', 'extend', 'implement'];
    const adjacency = new Map<string, string[]>();
    const nodeIds = new Set<string>();
    for (const node of nodes) nodeIds.add(node.id);
    for (const edge of edges) {
      if (!cycleEdgeTypes.includes(edge.type)) continue;
      const list = adjacency.get(edge.source);
      if (list) list.push(edge.target);
      else adjacency.set(edge.source, [edge.target]);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }

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

    const cycleRate = cycleNodeCount / nodes.length;
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

    let sizeVariance = 0;
    const avgSize = nodes.length / modules.size;
    for (const size of moduleSizes.values()) {
      sizeVariance += Math.abs(size - avgSize);
    }
    sizeVariance /= modules.size;

    const balanceScore = Math.max(0, 100 - (sizeVariance / Math.max(1, avgSize)) * 50);

    let crossModuleEdges = 0;
    for (const edge of edges) {
      const srcModule = moduleOfNode.get(edge.source);
      const tgtModule = moduleOfNode.get(edge.target);
      if (srcModule && tgtModule && srcModule !== tgtModule) {
        crossModuleEdges++;
      }
    }
    const crossModuleRatio = edges.length > 0 ? crossModuleEdges / edges.length : 0;
    const separationScore = Math.max(0, 100 - crossModuleRatio * 100);

    return Math.round((balanceScore + separationScore) / 2);
  }

  private buildModuleMap(nodes: GraphNode[]): Map<string, string> {
    return buildModuleMap(nodes, this.maxModuleDepth);
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
