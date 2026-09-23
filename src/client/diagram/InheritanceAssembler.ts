import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { BaseFilteringAssembler, type FilteringAssemblerConfig, type AssemblyContext } from './BaseFilteringAssembler.ts';

const INHERITANCE_NODE_TYPES = new Set(['class', 'interface', 'type']);
const INHERITANCE_EDGE_TYPES = new Set(['extend', 'implement']);

export class InheritanceAssembler extends BaseFilteringAssembler {
  protected config: FilteringAssemblerConfig = {
    nodeTypes: INHERITANCE_NODE_TYPES,
    edgeTypes: INHERITANCE_EDGE_TYPES,
    rootDirection: 'no-out-edges',
    depthDirection: 'source',
  };

  private descendantCounts = new Map<string, number>();

  protected prepare(ctx: AssemblyContext): void {
    this.descendantCounts = this.computeDescendantCounts(ctx.rootIds, ctx.inEdges);
  }

  protected enrichNode(node: GraphNode, ctx: AssemblyContext): GraphNode {
    const parentEdges = ctx.outEdges.get(node.id) ?? [];
    const childEdges = ctx.inEdges.get(node.id) ?? [];
    const stereotype = node.type === 'interface' ? `\u00ABinterface\u00BB\n` : '';
    const umlLabel = stereotype + node.label;
    const isInterface = node.type === 'interface';
    const hasAbstractProp = node.properties?.isAbstract === true;
    const matchesAbstractPattern = /^Abstract[A-Z]/.test(node.label);
    const matchesInterfacePattern = /^I[A-Z][a-z]/.test(node.label) && node.type === 'class';
    const isAbstract = isInterface || hasAbstractProp || matchesAbstractPattern || matchesInterfacePattern;

    return {
      ...node,
      properties: {
        ...node.properties,
        depth: ctx.depthMap.get(node.id) ?? 0,
        isRoot: !ctx.outEdges.has(node.id),
        parentCount: parentEdges.length,
        childCount: childEdges.length,
        descendantCount: this.descendantCounts.get(node.id) ?? 0,
        isAbstract,
        umlLabel,
      },
    };
  }

  private computeDescendantCounts(
    rootIds: string[],
    inEdges: Map<string, GraphEdge[]>,
  ): Map<string, number> {
    const counts = new Map<string, number>();

    const countDescendants = (id: string, visited: Set<string>): number => {
      if (counts.has(id)) return counts.get(id)!;
      if (visited.has(id)) return 0;
      visited.add(id);

      const children = inEdges.get(id) ?? [];
      const childSet = new Set<string>();
      let total = 0;
      for (const edge of children) {
        if (!childSet.has(edge.source)) {
          childSet.add(edge.source);
          total += 1 + countDescendants(edge.source, visited);
        }
      }
      counts.set(id, total);
      return total;
    };

    for (const rootId of rootIds) {
      countDescendants(rootId, new Set());
    }

    return counts;
  }
}
