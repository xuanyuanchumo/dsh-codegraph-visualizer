import type { GraphNode, GraphEdge, NodeId } from '../../../types/index.ts';
import type { ClusterNode, ClusterResult } from './types.ts';
import { aggregateEdges } from './types.ts';

export function computeSmartClusters(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  expandedNodeIds: Set<string>,
): ClusterResult {
  if (rawNodes.length === 0) return { nodes: [], edges: [] };

  const adjacency = new Map<string, Set<string>>();
  for (const n of rawNodes) adjacency.set(n.id, new Set());
  for (const e of rawEdges) {
    adjacency.get(e.source)?.add(e.target);
    adjacency.get(e.target)?.add(e.source);
  }

  const labels = new Map<string, string>();
  let nextLabel = 0;
  for (const n of rawNodes) labels.set(n.id, `c${nextLabel++}`);

  let changed = true;
  let iterations = 0;
  const maxIterations = 10;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    for (const n of rawNodes) {
      const neighbors = adjacency.get(n.id);
      if (!neighbors || neighbors.size === 0) continue;
      const labelCounts = new Map<string, number>();
      for (const nb of neighbors) {
        const lbl = labels.get(nb);
        if (lbl) labelCounts.set(lbl, (labelCounts.get(lbl) ?? 0) + 1);
      }
      let bestLabel = labels.get(n.id)!;
      let bestCount = 0;
      for (const [lbl, cnt] of labelCounts) {
        if (cnt > bestCount) { bestLabel = lbl; bestCount = cnt; }
      }
      if (bestLabel !== labels.get(n.id)) {
        labels.set(n.id, bestLabel);
        changed = true;
      }
    }
  }

  const labelToNodes = new Map<string, GraphNode[]>();
  for (const n of rawNodes) {
    const lbl = labels.get(n.id)!;
    const list = labelToNodes.get(lbl);
    if (list) list.push(n);
    else labelToNodes.set(lbl, [n]);
  }

  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const nodeIdToVisibleId = new Map<string, string>();

  for (const [label, nodes] of labelToNodes) {
    if (nodes.length <= 1) {
      for (const n of nodes) {
        visibleNodes.push(n);
        nodeIdToVisibleId.set(n.id, n.id);
      }
      continue;
    }
    const clusterId = `smartcluster__${label}`;
    const isExpanded = expandedNodeIds.has(clusterId);
    if (isExpanded) {
      for (const n of nodes) {
        visibleNodes.push(n);
        nodeIdToVisibleId.set(n.id, n.id);
      }
    } else {
      const primaryNode = nodes[0]!;
      const clusterNode: ClusterNode = {
        id: clusterId as NodeId,
        label: `${primaryNode.label.split(/[\\/]/).pop()?.split('.')[0] ?? 'group'} +${nodes.length - 1}`,
        type: primaryNode.type,
        filePath: primaryNode.filePath,
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: nodes.length,
        childIds: nodes.map((n) => n.id),
        clusterPath: label,
      };
      visibleNodes.push(clusterNode);
      for (const n of nodes) nodeIdToVisibleId.set(n.id, clusterId);
    }
  }

  const visibleEdges = aggregateEdges(rawEdges, nodeIdToVisibleId, 'smartcluster__');

  return { nodes: visibleNodes, edges: visibleEdges };
}