import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId } from '../../types/index.ts';
import { extractModulePath } from './modulePath.ts';
import {
  computeHotspotScore,
  hotspotLevel,
  isHotspotEligible,
  normalizeChurnPath,
} from '../churn.ts';

export interface HotspotNode {
  nodeId: NodeId;
  label: string;
  /** 所属文件（归一化）。用于在面板上显示「哪个文件」，也是 churn 的查表键。 */
  filePath: string;
  indegree: number;
  /**
   * 该文件被多少个提交触及过（来自 `/churn`）。
   *
   * `0` 有两种截然不同的含义，面板必须区分：
   * ① git 不可用 / 采集失败（`churnByFile` 整体为空）——此时 `hotspotScore === indegree`；
   * ② 文件确实从未被改动过。两者都是 0 次，但只有第一种需要在面板上说明。
   */
  churn: number;
  /**
   * CodeScene 口径的热点分数 = 变更频率 × 复杂度（入度代理）。
   *
   * **churn 为 0 时严格等于 `indegree`**（见 `computeHotspotScore`）：没有 churn 数据时
   * 热点排序必须与升级前逐位相同，不能因为一次失败的采集就悄悄改掉既有排序。
   */
  hotspotScore: number;
  level: 'high' | 'medium' | 'low';
}

export class HotspotAnalyzer {
  /**
   * 计算热点节点。
   *
   * `churnByFile` 是可选的：不传（或为空对象）时退化为**纯入度**排序，
   * 结果与升级前逐位相同——这是「采集失败必须可见、不能静默改变既有行为」的落点。
   */
  analyze(
    nodes: GraphNode[],
    edges: GraphEdge[],
    churnByFile?: Record<string, number>,
  ): HotspotNode[] {
    const indegree = new Map<string, number>();
    for (const edge of edges) {
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }

    const nodeMap = new Map<string, GraphNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const results: HotspotNode[] = [];
    for (const [nodeId, count] of indegree) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      if (!isHotspotEligible(count)) continue;

      const filePath = normalizeChurnPath(node.filePath ?? '');
      const churn = churnByFile?.[filePath] ?? 0;
      const score = computeHotspotScore(count, churn);

      results.push({
        nodeId: NodeId(nodeId),
        label: node.label,
        filePath,
        indegree: count,
        churn,
        hotspotScore: score,
        level: hotspotLevel(score),
      });
    }

    // 按热点分数排序（churn 缺失时 score === indegree，等价于旧的按入度排序）。
    return results.sort((a, b) => b.hotspotScore - a.hotspotScore || b.churn - a.churn);
  }
}

export interface GodModule {
  modulePath: string;
  nodeCount: number;
  edgeCount: number;
  suggestion: string;
}

export class GodModuleDetector {
  private readonly maxModuleDepth: number;

  constructor(maxModuleDepth?: number) {
    this.maxModuleDepth = maxModuleDepth ?? 3;
  }

  detect(nodes: GraphNode[], edges: GraphEdge[], threshold = 50): GodModule[] {
    const moduleNodes = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      const module = extractModulePath(node.filePath, this.maxModuleDepth);
      let list = moduleNodes.get(module);
      if (!list) { list = []; moduleNodes.set(module, list); }
      list.push(node);
    }

    const moduleEdges = new Map<string, number>();
    const nodeToModule = new Map<string, string>();
    for (const [module, nodeList] of moduleNodes) {
      for (const n of nodeList) nodeToModule.set(n.id, module);
    }
    for (const edge of edges) {
      const srcModule = nodeToModule.get(edge.source);
      const tgtModule = nodeToModule.get(edge.target);
      if (srcModule) {
        moduleEdges.set(srcModule, (moduleEdges.get(srcModule) ?? 0) + 1);
      }
      if (tgtModule && tgtModule !== srcModule) {
        moduleEdges.set(tgtModule, (moduleEdges.get(tgtModule) ?? 0) + 1);
      }
    }

    const results: GodModule[] = [];
    for (const [modulePath, nodeList] of moduleNodes) {
      const edgeCount = moduleEdges.get(modulePath) ?? 0;
      if (nodeList.length >= threshold) {
        results.push({
          modulePath,
          nodeCount: nodeList.length,
          edgeCount,
          suggestion: `Module "${modulePath}" has ${nodeList.length} nodes — consider splitting into smaller modules`,
        });
      }
    }

    return results.sort((a, b) => b.nodeCount - a.nodeCount);
  }
}
