import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { BaseFilteringAssembler, type FilteringAssemblerConfig, type AssemblyContext } from './BaseFilteringAssembler.ts';
import { buildForwardAdjacency } from '../../shared/analysis/AdjacencyList.ts';

const CALL_NODE_TYPES = new Set(['function']);
const CALL_EDGE_TYPES = new Set(['call']);

const ENTRY_PATTERNS = {
  handler: /handler|controller|route|middleware|endpoint/i,
  event: /^on[A-Z]|^listen|^subscribe|^emit/i,
  cli: /^main$|^cli$|^run$|^start$/i,
  test: /^test|^it$|^describe$|^beforeEach$|^afterEach$/i,
};

export class CallGraphAssembler extends BaseFilteringAssembler {
  protected config: FilteringAssemblerConfig = {
    nodeTypes: CALL_NODE_TYPES,
    edgeTypes: CALL_EDGE_TYPES,
    rootDirection: 'in-degree-zero',
    depthDirection: 'target',
  };

  private recursiveIds = new Set<string>();

  protected prepare(ctx: AssemblyContext): void {
    this.recursiveIds = this.detectRecursion(ctx.filteredNodes, ctx.validEdges);
  }

  protected enrichNode(node: GraphNode, ctx: AssemblyContext): GraphNode {
    const inDeg = (ctx.inEdges.get(node.id) ?? []).length;
    const outDeg = (ctx.outEdges.get(node.id) ?? []).length;
    const isEntry = inDeg === 0;
    const entryType = isEntry ? this.classifyEntry(node) : 'none';
    const entryPrefix = isEntry ? `\u00AB${entryType}\u00BB\n` : '';
    const umlLabel = entryPrefix + node.label;

    return {
      ...node,
      properties: {
        ...node.properties,
        depth: ctx.depthMap.get(node.id) ?? 0,
        isEntry,
        entryType,
        inDegree: inDeg,
        outDegree: outDeg,
        isRecursive: this.recursiveIds.has(node.id),
        umlLabel,
      },
    };
  }

  private classifyEntry(node: GraphNode): 'export' | 'handler' | 'event' | 'cli' | 'test' | 'none' {
    const isExported = node.properties?.isExported === true || node.properties?.is_exported === 1;
    if (isExported) return 'export';

    const name = node.label;
    if (ENTRY_PATTERNS.handler.test(name)) return 'handler';
    if (ENTRY_PATTERNS.event.test(name)) return 'event';
    if (ENTRY_PATTERNS.cli.test(name)) return 'cli';
    if (ENTRY_PATTERNS.test.test(name)) return 'test';

    return 'none';
  }

  private detectRecursion(nodes: GraphNode[], edges: GraphEdge[]): Set<string> {
    const adjacency = buildForwardAdjacency(edges);

    const recursive = new Set<string>();
    const visited = new Set<string>();

    for (const startNode of nodes) {
      if (visited.has(startNode.id)) continue;

      const stack: Array<{ id: string; neighborIdx: number }> = [];
      const inStack = new Set<string>();

      stack.push({ id: startNode.id, neighborIdx: 0 });
      inStack.add(startNode.id);
      visited.add(startNode.id);

      while (stack.length > 0) {
        const frame = stack[stack.length - 1]!;
        const neighbors = adjacency.get(frame.id) ?? [];

        if (frame.neighborIdx < neighbors.length) {
          const target = neighbors[frame.neighborIdx]!;
          frame.neighborIdx++;

          if (inStack.has(target)) {
            recursive.add(target);
            recursive.add(frame.id);
          } else if (!visited.has(target)) {
            visited.add(target);
            inStack.add(target);
            stack.push({ id: target, neighborIdx: 0 });
          }
        } else {
          inStack.delete(frame.id);
          stack.pop();
        }
      }
    }

    return recursive;
  }
}
