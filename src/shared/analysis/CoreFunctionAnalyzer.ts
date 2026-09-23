import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId } from '../../types/index.ts';
import { CORE_FUNCTION } from '../constants.ts';
import { bfsReachCount } from './GraphBFS.ts';

export interface CoreFunction {
  nodeId: NodeId;
  label: string;
  filePath: string;
  score: number;
  reasons: CoreFunctionReason[];
  inDegree: number;
  outDegree: number;
  influenceReach: number;
  callChainDepth: number;
  category: CoreFunctionCategory;
}

export type CoreFunctionCategory = 'entry' | 'hub' | 'api' | 'critical';

export type CoreFunctionReason =
  | 'high-indegree'
  | 'high-outdegree'
  | 'entry-point'
  | 'exported'
  | 'handler-pattern'
  | 'event-pattern'
  | 'cli-pattern'
  | 'large-influence'
  | 'deep-call-chain'
  | 'hub-function';

const ENTRY_PATTERNS = {
  handler: /handler|controller|route|middleware|endpoint|api/i,
  event: /^on[A-Z]|^listen|^subscribe|^emit|^handle[A-Z]/i,
  cli: /^main$|^cli$|^run$|^start$|^bootstrap$|^init$/i,
};

const MIN_INDEGREE_HUB = CORE_FUNCTION.MIN_INDEGREE_HUB;
const MIN_OUTDEGREE_HUB = CORE_FUNCTION.MIN_OUTDEGREE_HUB;
const MIN_INFLUENCE_REACH = CORE_FUNCTION.MIN_INFLUENCE_REACH;
const MIN_CALL_CHAIN_DEPTH = CORE_FUNCTION.MIN_CALL_CHAIN_DEPTH;
const MAX_BFS_NODES = CORE_FUNCTION.MAX_BFS_NODES;

const MAX_CALL_CHAIN_RECURSION_DEPTH = 500;

export class CoreFunctionAnalyzer {
  analyze(nodes: GraphNode[], edges: GraphEdge[]): CoreFunction[] {
    if (nodes.length === 0) return [];

    const functionNodes = nodes.filter((n) => n.type === 'function');
    if (functionNodes.length === 0) return [];

    const nodeIds = new Set(functionNodes.map((n) => n.id));

    const callEdges = edges.filter(
      (e) => e.type === 'call' && nodeIds.has(e.source) && nodeIds.has(e.target),
    );

    const outEdges = new Map<string, string[]>();
    const inEdges = new Map<string, string[]>();
    for (const e of callEdges) {
      if (e.source === e.target) continue;
      const outList = outEdges.get(e.source) ?? [];
      outList.push(e.target);
      outEdges.set(e.source, outList);

      const inList = inEdges.get(e.target) ?? [];
      inList.push(e.source);
      inEdges.set(e.target, inList);
    }

    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    for (const n of functionNodes) {
      inDegree.set(n.id, (inEdges.get(n.id) ?? []).length);
      outDegree.set(n.id, (outEdges.get(n.id) ?? []).length);
    }

    const influenceReach = this.computeInfluenceReach(functionNodes, outEdges);
    const callChainDepth = this.computeCallChainDepth(functionNodes, outEdges);

    const results: CoreFunction[] = [];
    for (const n of functionNodes) {
      const reasons: CoreFunctionReason[] = [];
      const indeg = inDegree.get(n.id) ?? 0;
      const outdeg = outDegree.get(n.id) ?? 0;
      const reach = influenceReach.get(n.id) ?? 0;
      const depth = callChainDepth.get(n.id) ?? 0;
      const isExported = n.properties?.isExported === true || n.properties?.is_exported === 1;

      let score = 0;

      if (indeg >= MIN_INDEGREE_HUB) {
        reasons.push('high-indegree');
        score += Math.min(indeg * 2, 30);
      }

      if (outdeg >= MIN_OUTDEGREE_HUB) {
        reasons.push('high-outdegree');
        score += Math.min(outdeg * 2, 30);
      }

      if (indeg === 0 && outdeg > 0) {
        reasons.push('entry-point');
        score += 15;
      }

      if (isExported) {
        reasons.push('exported');
        score += 10;
      }

      if (ENTRY_PATTERNS.handler.test(n.label)) {
        reasons.push('handler-pattern');
        score += 20;
      }

      if (ENTRY_PATTERNS.event.test(n.label)) {
        reasons.push('event-pattern');
        score += 15;
      }

      if (ENTRY_PATTERNS.cli.test(n.label)) {
        reasons.push('cli-pattern');
        score += 25;
      }

      if (reach >= MIN_INFLUENCE_REACH) {
        reasons.push('large-influence');
        score += Math.min(reach, 40);
      }

      if (depth >= MIN_CALL_CHAIN_DEPTH) {
        reasons.push('deep-call-chain');
        score += Math.min(depth * 3, 15);
      }

      if (indeg >= MIN_INDEGREE_HUB && outdeg >= MIN_OUTDEGREE_HUB) {
        reasons.push('hub-function');
        score += 20;
      }

      if (reasons.length === 0) continue;

      const category = this.classify(reasons, indeg, outdeg);

      results.push({
        nodeId: NodeId(n.id),
        label: n.label,
        filePath: n.filePath,
        score,
        reasons,
        inDegree: indeg,
        outDegree: outdeg,
        influenceReach: reach,
        callChainDepth: depth,
        category,
      });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  private classify(
    reasons: CoreFunctionReason[],
    indeg: number,
    outdeg: number,

  ): CoreFunctionCategory {
    if (reasons.includes('handler-pattern') || reasons.includes('event-pattern')) {
      return 'api';
    }
    if (reasons.includes('cli-pattern') || reasons.includes('entry-point')) {
      return 'entry';
    }
    if (reasons.includes('hub-function') || (indeg >= MIN_INDEGREE_HUB && outdeg >= MIN_OUTDEGREE_HUB)) {
      return 'hub';
    }
    return 'critical';
  }

  private computeInfluenceReach(
    nodes: GraphNode[],
    outEdges: Map<string, string[]>,
  ): Map<string, number> {
    const reach = new Map<string, number>();
    for (const n of nodes) {
      reach.set(n.id, bfsReachCount(outEdges, n.id, MAX_BFS_NODES));
    }
    return reach;
  }

  private computeCallChainDepth(
    nodes: GraphNode[],
    outEdges: Map<string, string[]>,
  ): Map<string, number> {
    const memo = new Map<string, number>();
    const computing = new Set<string>();

    const computeDepth = (id: string, currentDepth: number = 0): number => {
      if (memo.has(id)) return memo.get(id)!;
      if (computing.has(id)) return 0;
      if (currentDepth >= MAX_CALL_CHAIN_RECURSION_DEPTH) return currentDepth;

      computing.add(id);
      const neighbors = outEdges.get(id) ?? [];
      let maxChildDepth = 0;
      for (const target of neighbors) {
        const childDepth = computeDepth(target, currentDepth + 1);
        if (childDepth > maxChildDepth) maxChildDepth = childDepth;
      }
      computing.delete(id);

      const result = maxChildDepth + 1;
      memo.set(id, result);
      return result;
    };

    for (const n of nodes) {
      computeDepth(n.id);
    }

    return memo;
  }
}