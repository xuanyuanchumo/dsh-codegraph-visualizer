import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId } from '../../types/index.ts';

export interface HotspotNode {
  nodeId: NodeId;
  label: string;
  indegree: number;
  level: 'high' | 'medium' | 'low';
}

export class HotspotAnalyzer {
  analyze(nodes: GraphNode[], edges: GraphEdge[]): HotspotNode[] {
    const indegree = new Map<string, number>();
    for (const edge of edges) {
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }

    const nodeMap = new Map<string, GraphNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const results: HotspotNode[] = [];
    for (const [nodeId, count] of indegree) {
      const node = nodeMap.get(nodeId);
      if (!node || count < 5) continue;

      const level: HotspotNode['level'] = count >= 20 ? 'high' : count >= 10 ? 'medium' : 'low';
      results.push({ nodeId: NodeId(nodeId), label: node.label, indegree: count, level });
    }

    return results.sort((a, b) => b.indegree - a.indegree);
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
      const rawPath = node.filePath.replace(/^(file|import):/, '');
      const parts = rawPath.split(/[\\/]/);
      const dirParts = parts.length > 1 ? parts.slice(0, -1) : [rawPath];
      const module = dirParts.length > this.maxModuleDepth
        ? dirParts.slice(0, this.maxModuleDepth).join('/')
        : dirParts.join('/');
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
