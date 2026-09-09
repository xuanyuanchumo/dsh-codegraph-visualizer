import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { DiagramAssembler, AssembledDiagram } from './DiagramAssembler.ts';

const CALL_NODE_TYPES = new Set(['function']);
const CALL_EDGE_TYPES = new Set(['call']);

const ENTRY_PATTERNS = {
  handler: /handler|controller|route|middleware|endpoint/i,
  event: /^on[A-Z]|^listen|^subscribe|^emit/i,
  cli: /^main$|^cli$|^run$|^start$/i,
  test: /^test|^it$|^describe$|^beforeEach$|^afterEach$/i,
};

export class CallGraphAssembler implements DiagramAssembler {
  assemble(nodes: GraphNode[], edges: GraphEdge[]): AssembledDiagram {
    const callNodes = nodes.filter((n) => CALL_NODE_TYPES.has(n.type));
    const callEdges = edges.filter((e) => CALL_EDGE_TYPES.has(e.type));

    const nodeIds = new Set(callNodes.map((n) => n.id));
    const validEdges = callEdges.filter(
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

    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    for (const n of callNodes) {
      inDegree.set(n.id, (inEdges.get(n.id) ?? []).length);
      outDegree.set(n.id, (outEdges.get(n.id) ?? []).length);
    }

    const rootIds: string[] = [];
    for (const n of callNodes) {
      if (inDegree.get(n.id) === 0) rootIds.push(n.id);
    }

    const recursiveIds = this.detectRecursion(callNodes, validEdges);
    const depthMap = this.computeDepths(rootIds, outEdges);

    const assembledNodes = callNodes.map((n) => {
      const deg = inDegree.get(n.id) ?? 0;
      const outDeg = outDegree.get(n.id) ?? 0;
      const isEntry = deg === 0;
      const entryType = isEntry ? this.classifyEntry(n) : 'none';
      const entryPrefix = isEntry ? `\u00AB${entryType}\u00BB\n` : '';
      const umlLabel = entryPrefix + n.label;

      return {
        ...n,
        properties: {
          ...n.properties,
          depth: depthMap.get(n.id) ?? 0,
          isEntry,
          entryType,
          inDegree: deg,
          outDegree: outDeg,
          isRecursive: recursiveIds.has(n.id),
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
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      const list = adjacency.get(e.source) ?? [];
      list.push(e.target);
      adjacency.set(e.source, list);
    }

    const recursive = new Set<string>();
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (id: string): void => {
      visited.add(id);
      inStack.add(id);

      const neighbors = adjacency.get(id) ?? [];
      for (const target of neighbors) {
        if (inStack.has(target)) {
          recursive.add(target);
          recursive.add(id);
        } else if (!visited.has(target)) {
          dfs(target);
        }
      }

      inStack.delete(id);
    };

    for (const n of nodes) {
      if (!visited.has(n.id)) dfs(n.id);
    }

    return recursive;
  }

  private computeDepths(
    rootIds: string[],
    outEdges: Map<string, GraphEdge[]>,
  ): Map<string, number> {
    const depths = new Map<string, number>();
    const queue: Array<{ id: string; depth: number }> = rootIds.map((id) => ({ id, depth: 0 }));
    let head = 0;

    while (head < queue.length) {
      const { id, depth } = queue[head++]!;
      const currentDepth = depths.get(id);
      if (currentDepth !== undefined && currentDepth <= depth) continue;
      depths.set(id, depth);

      const outList = outEdges.get(id) ?? [];
      for (const edge of outList) {
        const targetId = edge.target;
        if (!depths.has(targetId) || depths.get(targetId)! > depth + 1) {
          queue.push({ id: targetId, depth: depth + 1 });
        }
      }
    }

    return depths;
  }
}