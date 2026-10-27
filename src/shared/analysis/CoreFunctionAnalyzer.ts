import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId } from '../../types/index.ts';
import { CORE_FUNCTION, CORE_FUNCTION_ANALYZER } from '../constants.ts';
import { bfsReachCount } from './GraphBFS.ts';
import { computeReachCounts } from './batchReach.ts';

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

/**
 * 旧实现（截断 BFS）的逐节点可达计数，**仅供对照测试与外部兼容**。
 *
 * 语义（必须如实理解）：旧 `bfsReachCount` 在 `visited.size < MAX_BFS_NODES` 时停止扩张，
 * 而截断检查发生在取出下一个节点之前，因此它可能一次性把大出度节点的邻居全部计入，
 * 返回值**不受 500 严格约束**，具体停在哪里取决于 BFS 的邻居顺序。
 *
 * 与 `computeInfluenceReach`（精确值）的关系：
 * - 旧值 ≤ 精确值；
 * - 精确值 < MAX_BFS_NODES 时两者逐节点相等；
 * - 精确值 ≥ MAX_BFS_NODES 时旧值是顺序相关的近似值，新值更准确。
 *
 * 生产路径已不再使用本函数（保留是为了让「新旧对照」可被测试直接调用）。
 *
 * @deprecated 生产代码请使用 `computeInfluenceReach`（SCC + bitset 精确可达）。
 */
export function legacyTruncatedReach(
  nodeId: string,
  outEdges: Map<string, string[]>,
  maxNodes: number = MAX_BFS_NODES,
): number {
  return bfsReachCount(outEdges, nodeId, maxNodes);
}

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

  /**
   * 每个函数节点的**精确**可达节点数（不含自身）。
   *
   * 实现：`computeReachCounts` —— Tarjan SCC 缩点 + 逆拓扑序 bitset 传递闭包，
   * 复杂度 O((V+E)·V/32)，整张图只算一趟；旧实现是「每个节点各跑一次截断 BFS」，
   * 复杂度 O(V·(V+E)) 且结果被 `MAX_BFS_NODES` 截断。
   *
   * 语义差异（契约，见 batchReach.ts 的模块注释与 `legacyTruncatedReach`）：
   * `influenceReach` 现在是精确值；旧值是顺序相关的近似值，且对精确值 ≥ MAX_BFS_NODES
   * 的节点可能明显偏小（长链 0→1→…→600 上旧值为 499，精确值为 600）。
   * 对精确值 < MAX_BFS_NODES 的节点，新旧逐节点相等，因此评分 `large-influence`
   * 的阈值判定（≥ MIN_INFLUENCE_REACH = 10）在常规规模图上不会改变。
   */
  private computeInfluenceReach(
    nodes: GraphNode[],
    outEdges: Map<string, string[]>,
  ): Map<string, number> {
    return computeReachCounts(outEdges, nodes.map((n) => n.id));
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
      if (currentDepth >= CORE_FUNCTION_ANALYZER.MAX_CALL_CHAIN_RECURSION_DEPTH) return currentDepth;

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