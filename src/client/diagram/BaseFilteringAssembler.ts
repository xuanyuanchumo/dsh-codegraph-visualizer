import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { DiagramAssembler, AssembledDiagram } from './DiagramAssembler.ts';
import { computeDepths, buildAdjacencyMaps } from './DiagramAssembler.ts';

export interface FilteringAssemblerConfig {
  nodeTypes: Set<string>;
  edgeTypes: Set<string>;
  rootDirection: 'in-degree-zero' | 'no-out-edges';
  depthDirection: 'source' | 'target';
}

export interface AssemblyContext {
  outEdges: Map<string, GraphEdge[]>;
  inEdges: Map<string, GraphEdge[]>;
  depthMap: Map<string, number>;
  rootIds: string[];
  allNodes: GraphNode[];
  allEdges: GraphEdge[];
  filteredNodes: GraphNode[];
  validEdges: GraphEdge[];
}

export abstract class BaseFilteringAssembler implements DiagramAssembler {
  protected abstract config: FilteringAssemblerConfig;

  protected prepare(_ctx: AssemblyContext): void {}

  protected abstract enrichNode(node: GraphNode, ctx: AssemblyContext): GraphNode;

  assemble(nodes: GraphNode[], edges: GraphEdge[]): AssembledDiagram {
    const cfg = this.config;

    const filteredNodes = nodes.filter((n) => cfg.nodeTypes.has(n.type));
    const filteredEdges = edges.filter((e) => cfg.edgeTypes.has(e.type));

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const validEdges = filteredEdges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
    );

    const { outEdges, inEdges } = buildAdjacencyMaps(validEdges);

    const rootIds = this.findRoots(filteredNodes, outEdges, inEdges);

    const depthEdges = cfg.depthDirection === 'source' ? inEdges : outEdges;
    const depthMap = computeDepths(rootIds, depthEdges, cfg.depthDirection);

    const ctx: AssemblyContext = {
      outEdges,
      inEdges,
      depthMap,
      rootIds,
      allNodes: nodes,
      allEdges: edges,
      filteredNodes,
      validEdges,
    };

    this.prepare(ctx);

    const assembledNodes = filteredNodes.map((n) => this.enrichNode(n, ctx));

    const maxDepth = Math.max(0, ...depthMap.values());

    return {
      nodes: assembledNodes,
      edges: validEdges,
      metadata: {
        rootIds,
        maxDepth,
        nodeCount: assembledNodes.length,
        edgeCount: validEdges.length,
      },
    };
  }

  private findRoots(
    nodes: GraphNode[],
    outEdges: Map<string, GraphEdge[]>,
    inEdges: Map<string, GraphEdge[]>,
  ): string[] {
    if (this.config.rootDirection === 'in-degree-zero') {
      return nodes
        .filter((n) => (inEdges.get(n.id) ?? []).length === 0)
        .map((n) => n.id);
    }
    return nodes.filter((n) => !outEdges.has(n.id)).map((n) => n.id);
  }
}