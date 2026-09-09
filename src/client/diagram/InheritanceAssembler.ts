import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { DiagramAssembler, AssembledDiagram } from './DiagramAssembler.ts';

const INHERITANCE_NODE_TYPES = new Set(['class', 'interface', 'type']);
const INHERITANCE_EDGE_TYPES = new Set(['extend', 'implement']);

export class InheritanceAssembler implements DiagramAssembler {
  assemble(nodes: GraphNode[], edges: GraphEdge[]): AssembledDiagram {
    const inheritanceNodes = nodes.filter((n) => INHERITANCE_NODE_TYPES.has(n.type));
    const inheritanceEdges = edges.filter((e) => INHERITANCE_EDGE_TYPES.has(e.type));

    const nodeIds = new Set(inheritanceNodes.map((n) => n.id));
    const validEdges = inheritanceEdges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
    );

    const outEdges = new Map<string, GraphEdge[]>();
    const inEdges = new Map<string, GraphEdge[]>();
    for (const e of validEdges) {
      const outList = outEdges.get(e.source) ?? [];
      outList.push(e);
      outEdges.set(e.source, outList);

      const inList = inEdges.get(e.target) ?? [];
      inList.push(e);
      inEdges.set(e.target, inList);
    }

    const rootIds: string[] = [];
    for (const n of inheritanceNodes) {
      if (!outEdges.has(n.id)) rootIds.push(n.id);
    }

    const depthMap = this.computeDepths(rootIds, inEdges);
    const descendantCounts = this.computeDescendantCounts(rootIds, inEdges);

    const assembledNodes = inheritanceNodes.map((n) => {
      const parentEdges = outEdges.get(n.id) ?? [];
      const childEdges = inEdges.get(n.id) ?? [];
      const stereotype = n.type === 'interface' ? '\u00ABinterface\u00BB\n' : '';
      const umlLabel = stereotype + n.label;

      return {
        ...n,
        properties: {
          ...n.properties,
          depth: depthMap.get(n.id) ?? 0,
          isRoot: !outEdges.has(n.id),
          parentCount: parentEdges.length,
          childCount: childEdges.length,
          descendantCount: descendantCounts.get(n.id) ?? 0,
          isAbstract: false,
          umlLabel,
        },
      };
    });

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

  private computeDepths(
    rootIds: string[],
    inEdges: Map<string, GraphEdge[]>,
  ): Map<string, number> {
    const depths = new Map<string, number>();
    const queue: Array<{ id: string; depth: number }> = rootIds.map((id) => ({ id, depth: 0 }));
    let head = 0;

    while (head < queue.length) {
      const { id, depth } = queue[head++]!;
      if (depths.has(id) && depths.get(id)! <= depth) continue;
      depths.set(id, depth);

      const children = inEdges.get(id) ?? [];
      for (const edge of children) {
        const childId = edge.source;
        if (!depths.has(childId) || depths.get(childId)! > depth + 1) {
          queue.push({ id: childId, depth: depth + 1 });
        }
      }
    }

    return depths;
  }

  private computeDescendantCounts(
    rootIds: string[],
    inEdges: Map<string, GraphEdge[]>,
  ): Map<string, number> {
    const counts = new Map<string, number>();
    const visited = new Set<string>();

    const countDescendants = (id: string): number => {
      if (counts.has(id)) return counts.get(id)!;
      if (visited.has(id)) return 0;
      visited.add(id);

      const children = inEdges.get(id) ?? [];
      let total = 0;
      for (const edge of children) {
        total += 1 + countDescendants(edge.source);
      }
      counts.set(id, total);
      visited.delete(id);
      return total;
    };

    for (const rootId of rootIds) {
      countDescendants(rootId);
    }

    return counts;
  }
}