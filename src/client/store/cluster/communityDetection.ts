import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import { CLUSTER } from '../../../shared/constants.ts';
import { buildFilteredUndirectedAdjacency } from '../../../shared/analysis/AdjacencyList.ts';

const MAX_NODES_FOR_LABEL_PROP = CLUSTER.MAX_NODES_FOR_LABEL_PROP;
const MIN_NODES_FOR_SUBGROUP = CLUSTER.MIN_NODES_FOR_SUBGROUP;
const MAX_ITERATIONS_LARGE = CLUSTER.MAX_ITERATIONS_LARGE;
const MAX_ITERATIONS_SMALL = CLUSTER.MAX_ITERATIONS_SMALL;
const LARGE_NODE_THRESHOLD = CLUSTER.LARGE_NODE_THRESHOLD;

export interface CommunityGroup {
  label: string;
  nodes: GraphNode[];
}

export function selectHighDegreeNodes(nodes: GraphNode[], edges: GraphEdge[], limit: number): GraphNode[] {
  const degreeMap = new Map<string, number>();
  for (const n of nodes) degreeMap.set(n.id, 0);
  for (const e of edges) {
    if (degreeMap.has(e.source)) degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    if (degreeMap.has(e.target)) degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
  }
  return [...nodes]
    .sort((a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0))
    .slice(0, limit);
}

export function detectCommunities(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, CommunityGroup> {
  if (nodes.length === 0) return new Map();
  if (nodes.length < MIN_NODES_FOR_SUBGROUP) {
    const group: CommunityGroup = { label: 'all', nodes };
    return new Map([['all', group]]);
  }

  const participatingNodes = nodes.length > MAX_NODES_FOR_LABEL_PROP
    ? selectHighDegreeNodes(nodes, edges, MAX_NODES_FOR_LABEL_PROP)
    : nodes;
  const participatingIds = new Set(participatingNodes.map((n) => n.id));

  const adjacency = buildFilteredUndirectedAdjacency(edges, participatingIds);

  const labels = new Map<string, string>();
  let nextLabel = 0;
  const sortedNodes = [...participatingNodes].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const n of sortedNodes) labels.set(n.id, `c${nextLabel++}`);

  const maxIterations = participatingNodes.length > LARGE_NODE_THRESHOLD
    ? MAX_ITERATIONS_LARGE
    : MAX_ITERATIONS_SMALL;

  let changed = true;
  let iterations = 0;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    for (const n of sortedNodes) {
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
        if (cnt > bestCount || (cnt === bestCount && lbl === labels.get(n.id))) {
          bestLabel = lbl;
          bestCount = cnt;
        }
      }
      if (bestLabel !== labels.get(n.id)) {
        labels.set(n.id, bestLabel);
        changed = true;
      }
    }
  }

  const groups = new Map<string, CommunityGroup>();
  for (const n of participatingNodes) {
    const lbl = labels.get(n.id)!;
    const group = groups.get(lbl);
    if (group) group.nodes.push(n);
    else groups.set(lbl, { label: lbl, nodes: [n] });
  }

  const overflowNodes: GraphNode[] = [];
  for (const n of nodes) {
    if (!participatingIds.has(n.id)) overflowNodes.push(n);
  }

  if (overflowNodes.length > 0) {
    const overflowAdjacency = new Map<string, string[]>();
    for (const n of overflowNodes) overflowAdjacency.set(n.id, []);
    for (const e of edges) {
      if (overflowAdjacency.has(e.source) && participatingIds.has(e.target)) {
        const arr = overflowAdjacency.get(e.source);
        if (arr) arr.push(e.target);
      }
      if (overflowAdjacency.has(e.target) && participatingIds.has(e.source)) {
        const arr = overflowAdjacency.get(e.target);
        if (arr) arr.push(e.source);
      }
    }

    for (const n of overflowNodes) {
      const neighbors = overflowAdjacency.get(n.id) ?? [];
      let assigned = false;
      for (const neighborId of neighbors) {
        const lbl = labels.get(neighborId);
        if (lbl) {
          const group = groups.get(lbl);
          if (group) { group.nodes.push(n); assigned = true; break; }
        }
      }
      if (!assigned) {
        const group = groups.get('overflow');
        if (group) group.nodes.push(n);
        else groups.set('overflow', { label: 'overflow', nodes: [n] });
      }
    }
  }

  return groups;
}