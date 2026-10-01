import type { GraphNode, GraphEdge } from '../types/index.ts';
import { scoped } from './Logger.ts';

const log = scoped('graphology');

export interface CommunityResult {
  nodeId: string;
  community: number;
}

export interface CentralityResult {
  nodeId: string;
  centrality: number;
}

interface IGGraph {
  order: number;
  size: number;
  addNode(id: string, attrs?: Record<string, unknown>): void;
  addEdge(source: string, target: string, attrs?: Record<string, unknown>): void;
  hasNode(id: string): boolean;
  hasEdge(source: string, target: string): boolean;
  degree(id: string): number;
  forEachNode(cb: (id: string, attrs: Record<string, unknown>) => void): void;
  forEachNeighbor(id: string, cb: (neighbor: string, attrs: Record<string, unknown>) => void): void;
  clear(): void;
}

async function loadGraphCtor(): Promise<new (opts: Record<string, unknown>) => IGGraph> {
  const mod = await import('graphology');
  const Ctor = (mod as unknown as { default?: new (opts: Record<string, unknown>) => IGGraph; Graph?: new (opts: Record<string, unknown>) => IGGraph }).default ?? (mod as unknown as { Graph: new (opts: Record<string, unknown>) => IGGraph }).Graph;
  if (!Ctor) throw new Error('graphology: no Graph constructor found');
  return Ctor;
}

async function loadLouvain(): Promise<(graph: unknown, opts?: Record<string, unknown>) => Record<string, number>> {
  const mod = await import('graphology-communities-louvain');
  const fn = (mod as unknown as { default?: (graph: unknown, opts?: Record<string, unknown>) => Record<string, number> }).default;
  if (!fn) throw new Error('graphology-communities-louvain: no default export found');
  return fn;
}

export class GraphologyAdapter {
  private graph: IGGraph | null = null;

  async buildGraph(nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
    const GraphCtor = await loadGraphCtor();
    const g = new GraphCtor({ multi: false, type: 'undirected' });

    for (const node of nodes) {
      g.addNode(node.id, { type: node.type, label: node.label, filePath: node.filePath });
    }

    for (const edge of edges) {
      if (g.hasNode(edge.source) && g.hasNode(edge.target) && !g.hasEdge(edge.source, edge.target)) {
        g.addEdge(edge.source, edge.target, { type: edge.type, weight: edge.weight ?? 1 });
      }
    }

    this.graph = g;
    log.info(`built graph: ${g.order} nodes, ${g.size} edges`);
  }

  async detectCommunities(): Promise<CommunityResult[]> {
    if (!this.graph) return [];
    const louvain = await loadLouvain();
    const communities = louvain(this.graph, { resolution: 1.0 });
    const results: CommunityResult[] = [];
    for (const [nodeId, community] of Object.entries(communities)) {
      results.push({ nodeId, community });
    }
    log.info(`detected ${new Set(results.map(r => r.community)).size} communities`);
    return results;
  }

  computeDegreeCentrality(): CentralityResult[] {
    if (!this.graph) return [];
    const results: CentralityResult[] = [];
    const maxDegree = this.graph.order - 1;
    this.graph.forEachNode((nodeId: string) => {
      const degree = this.graph!.degree(nodeId);
      const centrality = maxDegree > 0 ? degree / maxDegree : 0;
      results.push({ nodeId, centrality });
    });
    return results.sort((a, b) => b.centrality - a.centrality);
  }

  bfs(startNodeId: string, maxDepth?: number): string[] {
    if (!this.graph || !this.graph.hasNode(startNodeId)) return [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: startNodeId, depth: 0 }];
    const result: string[] = [];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      if (maxDepth !== undefined && depth > maxDepth) continue;
      visited.add(id);
      result.push(id);

      this.graph.forEachNeighbor(id, (neighbor: string) => {
        if (!visited.has(neighbor)) {
          queue.push({ id: neighbor, depth: depth + 1 });
        }
      });
    }

    return result;
  }

  shortestPath(fromId: string, toId: string): string[] | null {
    if (!this.graph || !this.graph.hasNode(fromId) || !this.graph.hasNode(toId)) return null;
    if (fromId === toId) return [fromId];

    const visited = new Set<string>([fromId]);
    const queue: Array<{ id: string; path: string[] }> = [{ id: fromId, path: [fromId] }];
    let found: string[] | null = null;

    while (queue.length > 0 && !found) {
      const { id, path } = queue.shift()!;
      this.graph.forEachNeighbor(id, (neighbor: string) => {
        if (visited.has(neighbor) || found) return;
        visited.add(neighbor);
        const newPath = [...path, neighbor];
        if (neighbor === toId) {
          found = newPath;
          return;
        }
        queue.push({ id: neighbor, path: newPath });
      });
    }

    return found;
  }

  findConnectedComponents(): string[][] {
    if (!this.graph) return [];
    const visited = new Set<string>();
    const components: string[][] = [];

    this.graph.forEachNode((nodeId: string) => {
      if (visited.has(nodeId)) return;
      const component: string[] = [];
      const stack = [nodeId];
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        component.push(id);
        this.graph!.forEachNeighbor(id, (neighbor: string) => {
          if (!visited.has(neighbor)) stack.push(neighbor);
        });
      }
      components.push(component);
    });

    return components.sort((a, b) => b.length - a.length);
  }

  findOrphanNodes(): string[] {
    if (!this.graph) return [];
    const orphans: string[] = [];
    this.graph.forEachNode((nodeId: string) => {
      if (this.graph!.degree(nodeId) === 0) orphans.push(nodeId);
    });
    return orphans;
  }

  findLeafNodes(): string[] {
    if (!this.graph) return [];
    const leaves: string[] = [];
    this.graph.forEachNode((nodeId: string) => {
      if (this.graph!.degree(nodeId) === 1) leaves.push(nodeId);
    });
    return leaves;
  }

  findHubNodes(threshold = 10): string[] {
    if (!this.graph) return [];
    const hubs: string[] = [];
    this.graph.forEachNode((nodeId: string) => {
      if (this.graph!.degree(nodeId) >= threshold) hubs.push(nodeId);
    });
    return hubs.sort((a, b) => this.graph!.degree(b) - this.graph!.degree(a));
  }

  clear(): void {
    if (this.graph) {
      this.graph.clear();
      this.graph = null;
    }
  }
}