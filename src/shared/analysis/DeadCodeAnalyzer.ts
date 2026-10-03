import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId } from '../../types/index.ts';
import { buildDirectedAdjacency, type AdjacencyMap } from './AdjacencyList.ts';

export type DeadCodeCategory = 'unreachable' | 'no-incoming' | 'orphan';

export type DeadCodeConfidence = 'confirmed' | 'suspected';

export interface DeadCodeNode {
  nodeId: NodeId;
  label: string;
  filePath: string;
  type: GraphNode['type'];
  category: DeadCodeCategory;
  confidence: DeadCodeConfidence;
  inDegree: number;
  outDegree: number;
  reason: string;
}

export interface DeadCodeResult {
  deadNodes: DeadCodeNode[];
  entryNodes: NodeId[];
  unreachableNodes: NodeId[];
  stats: {
    total: number;
    confirmed: number;
    suspected: number;
    byCategory: Record<DeadCodeCategory, number>;
  };
}

const ENTRY_PATTERNS = {
  handler: /handler|controller|route|middleware|endpoint|api/i,
  event: /^on[A-Z]|^listen|^subscribe|^emit|^handle[A-Z]/i,
  cli: /^main$|^cli$|^run$|^start$|^bootstrap$|^init$/i,
  test: /^test|^it$|^describe$|^beforeEach$|^afterEach$/i,
};

/**
 * Containment is structure, not usage: a `contains` edge says "this module defines that
 * symbol", it does not say that anything references the symbol. Counting it as a liveness
 * edge made every contained symbol reachable from its module — and every module is an entry
 * point — so a real scanned graph reported zero dead nodes and the panel (which only mounts
 * when `deadNodes.length > 0`) stayed invisible. J0 Round 11 toggled 死代码检测 on the
 * project's own 2193-node graph and nothing appeared.
 *
 * Liveness now follows reference edges only (call/extend/implement/import/dependency); the
 * reported in/out degrees are reference counts for the same reason.
 */
const STRUCTURAL_EDGE_TYPES: ReadonlySet<string> = new Set(['contains']);

function isLivenessEdge(edge: GraphEdge): boolean {
  return !STRUCTURAL_EDGE_TYPES.has(edge.type);
}

function isEntryPoint(node: GraphNode): boolean {
  if (node.type === 'module') return true;

  if (node.properties?.isExported === true || node.properties?.is_exported === 1) return true;
  if (node.properties?.isEntry === true) return true;
  if (ENTRY_PATTERNS.handler.test(node.label)) return true;
  if (ENTRY_PATTERNS.event.test(node.label)) return true;
  if (ENTRY_PATTERNS.cli.test(node.label)) return true;
  if (ENTRY_PATTERNS.test.test(node.label)) return true;
  return false;
}

export class DeadCodeAnalyzer {
  analyze(nodes: GraphNode[], edges: GraphEdge[]): DeadCodeResult {
    if (nodes.length === 0) return this.emptyResult();

    const { forward, backward } = buildDirectedAdjacency(edges.filter(isLivenessEdge));

    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    for (const n of nodes) {
      inDegree.set(n.id, (backward.get(n.id) ?? []).length);
      outDegree.set(n.id, (forward.get(n.id) ?? []).length);
    }

    const entryNodeIds: string[] = [];
    for (const n of nodes) {
      if (isEntryPoint(n)) entryNodeIds.push(n.id);
    }

    const reachable = this.bfsReachable(forward, entryNodeIds);

    const deadNodes: DeadCodeNode[] = [];
    const unreachableNodes: NodeId[] = [];

    for (const n of nodes) {
      if (reachable.has(n.id)) continue;

      unreachableNodes.push(NodeId(n.id));

      const indeg = inDegree.get(n.id) ?? 0;
      const outdeg = outDegree.get(n.id) ?? 0;

      let category: DeadCodeCategory;
      let confidence: DeadCodeConfidence;
      let reason: string;

      if (indeg === 0 && !isEntryPoint(n)) {
        category = 'no-incoming';
        confidence = 'suspected';
        reason = 'No incoming edges and not an entry point';
      } else if (indeg > 0) {
        category = 'orphan';
        confidence = 'confirmed';
        reason = `Has ${indeg} incoming edge(s) but unreachable from any entry point`;
      } else {
        category = 'unreachable';
        confidence = 'confirmed';
        reason = 'Unreachable from any entry point';
      }

      deadNodes.push({
        nodeId: NodeId(n.id),
        label: n.label,
        filePath: n.filePath,
        type: n.type,
        category,
        confidence,
        inDegree: indeg,
        outDegree: outdeg,
        reason,
      });
    }

    deadNodes.sort((a, b) => {
      if (a.confidence !== b.confidence) {
        return a.confidence === 'confirmed' ? -1 : 1;
      }
      return a.inDegree - b.inDegree;
    });

    return {
      deadNodes,
      entryNodes: entryNodeIds.map((id) => NodeId(id)),
      unreachableNodes,
      stats: this.computeStats(deadNodes),
    };
  }

  private bfsReachable(forward: AdjacencyMap, entryNodeIds: string[]): Set<string> {
    const visited = new Set<string>();
    const queue: string[] = [];
    for (const entry of entryNodeIds) {
      if (!visited.has(entry)) {
        visited.add(entry);
        queue.push(entry);
      }
    }
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++]!;
      const neighbors = forward.get(current) ?? [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return visited;
  }

  private computeStats(deadNodes: DeadCodeNode[]): DeadCodeResult['stats'] {
    const byCategory: Record<DeadCodeCategory, number> = { unreachable: 0, 'no-incoming': 0, orphan: 0 };
    let confirmed = 0;
    let suspected = 0;
    for (const d of deadNodes) {
      byCategory[d.category]++;
      if (d.confidence === 'confirmed') confirmed++;
      else suspected++;
    }
    return { total: deadNodes.length, confirmed, suspected, byCategory };
  }

  private emptyResult(): DeadCodeResult {
    return {
      deadNodes: [],
      entryNodes: [],
      unreachableNodes: [],
      stats: { total: 0, confirmed: 0, suspected: 0, byCategory: { unreachable: 0, 'no-incoming': 0, orphan: 0 } },
    };
  }
}