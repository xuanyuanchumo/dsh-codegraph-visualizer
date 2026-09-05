import type { GraphNode, GraphEdge } from '../../types/index.ts';

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

export class HealthScorer {
  calculate(nodes: GraphNode[], edges: GraphEdge[]): HealthScore {
    if (nodes.length === 0) {
      return { coupling: 0, cohesion: 0, cyclicDependencyRate: 0, modularity: 0, overall: 0 };
    }

    const coupling = this.calculateCoupling(nodes, edges);
    const cohesion = this.calculateCohesion(nodes, edges);
    const cyclicDependencyRate = this.calculateCyclicDependencyRate(nodes, edges);
    const modularity = this.calculateModularity(nodes, edges);
    const overall = Math.round(coupling * 0.25 + cohesion * 0.25 + cyclicDependencyRate * 0.25 + modularity * 0.25);

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

  private calculateCoupling(nodes: GraphNode[], edges: GraphEdge[]): number {
    if (edges.length === 0) return 100;

    const moduleOfNode = this.buildModuleMap(nodes);
    let crossModuleEdges = 0;
    for (const edge of edges) {
      const srcModule = moduleOfNode.get(edge.source);
      const tgtModule = moduleOfNode.get(edge.target);
      if (srcModule && tgtModule && srcModule !== tgtModule) {
        crossModuleEdges++;
      }
    }

    const couplingRatio = crossModuleEdges / edges.length;
    return Math.round(Math.max(0, 100 - couplingRatio * 100));
  }

  private calculateCohesion(nodes: GraphNode[], edges: GraphEdge[]): number {
    const moduleOfNode = this.buildModuleMap(nodes);
    const moduleEdges = new Map<string, { internal: number; total: number }>();

    for (const edge of edges) {
      const srcModule = moduleOfNode.get(edge.source);
      const tgtModule = moduleOfNode.get(edge.target);
      if (!srcModule) continue;

      let stats = moduleEdges.get(srcModule);
      if (!stats) { stats = { internal: 0, total: 0 }; moduleEdges.set(srcModule, stats); }
      stats.total++;
      if (srcModule === tgtModule) stats.internal++;
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

    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      const list = adjacency.get(edge.source);
      if (list) list.push(edge.target);
      else adjacency.set(edge.source, [edge.target]);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];
    let cycleNodeCount = 0;

    const enter = (start: string): void => {
      const frames: Array<{ id: string; neighbors: string[]; next: number }> = [
        { id: start, neighbors: adjacency.get(start) ?? [], next: 0 },
      ];
      visited.add(start);
      inStack.add(start);
      path.push(start);

      while (frames.length > 0) {
        const frame = frames[frames.length - 1]!;
        if (frame.next >= frame.neighbors.length) {
          inStack.delete(frame.id);
          path.pop();
          frames.pop();
          continue;
        }
        const target = frame.neighbors[frame.next++]!;
        if (inStack.has(target)) {
          const cycleStart = path.indexOf(target);
          if (cycleStart >= 0) {
            for (let i = cycleStart; i < path.length; i++) {
              if (!visited.has(`__cycle_${path[i]}`)) {
                cycleNodeCount++;
                visited.add(`__cycle_${path[i]}`);
              }
            }
          }
        } else if (!visited.has(target)) {
          visited.add(target);
          inStack.add(target);
          path.push(target);
          frames.push({ id: target, neighbors: adjacency.get(target) ?? [], next: 0 });
        }
      }
    };

    for (const id of adjacency.keys()) {
      if (!visited.has(id)) enter(id);
    }

    const cycleRate = cycleNodeCount / nodes.length;
    return Math.round(Math.max(0, 100 - cycleRate * 100));
  }

  private calculateModularity(nodes: GraphNode[], _edges: GraphEdge[]): number {
    if (nodes.length === 0) return 0;

    const moduleOfNode = this.buildModuleMap(nodes);
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

    const balanceScore = Math.max(0, 100 - (sizeVariance / avgSize) * 50);
    const separationScore = Math.min(100, (modules.size / Math.max(1, Math.sqrt(nodes.length))) * 100);

    return Math.round((balanceScore + separationScore) / 2);
  }

  private buildModuleMap(nodes: GraphNode[]): Map<string, string> {
    const moduleOfNode = new Map<string, string>();
    for (const node of nodes) {
      const parts = node.filePath.split(/[\\/]/);
      const module = parts.length > 1 ? parts.slice(0, -1).join('/') : node.filePath;
      moduleOfNode.set(node.id, module);
    }
    return moduleOfNode;
  }
}