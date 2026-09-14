import type { GraphNode, GraphEdge } from '../../../types/index.ts';

const MAX_NODES_FOR_LABEL_PROP = 5000;
const MIN_NODES_FOR_SUBGROUP = 50;
const MAX_ITERATIONS_LARGE = 3;
const MAX_ITERATIONS_SMALL = 10;
const LARGE_NODE_THRESHOLD = 2000;

export interface CommunityGroup {
  label: string;
  nodes: GraphNode[];
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
    ? nodes.slice(0, MAX_NODES_FOR_LABEL_PROP)
    : nodes;
  const participatingIds = new Set(participatingNodes.map((n) => n.id));

  const adjacency = new Map<string, Set<string>>();
  for (const n of participatingNodes) adjacency.set(n.id, new Set());
  for (const e of edges) {
    if (!participatingIds.has(e.source) || !participatingIds.has(e.target)) continue;
    adjacency.get(e.source)?.add(e.target);
    adjacency.get(e.target)?.add(e.source);
  }

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

  for (const n of nodes) {
    if (!participatingIds.has(n.id)) {
      let assigned = false;
      for (const e of edges) {
        if (e.source === n.id && participatingIds.has(e.target)) {
          const lbl = labels.get(e.target);
          if (lbl) {
            const group = groups.get(lbl);
            if (group) { group.nodes.push(n); assigned = true; break; }
          }
        }
        if (e.target === n.id && participatingIds.has(e.source)) {
          const lbl = labels.get(e.source);
          if (lbl) {
            const group = groups.get(lbl);
            if (group) { group.nodes.push(n); assigned = true; break; }
          }
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