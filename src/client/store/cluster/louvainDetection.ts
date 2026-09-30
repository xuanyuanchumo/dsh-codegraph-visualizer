import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import { CLUSTER, LOUVAIN } from '../../../shared/constants.ts';
import { buildFilteredUndirectedAdjacency } from '../../../shared/analysis/AdjacencyList.ts';
import { selectHighDegreeNodes } from './communityDetection.ts';

export interface LouvainCommunity {
  label: string;
  nodes: GraphNode[];
}

const MAX_NODES_FOR_LOUVAIN = CLUSTER.MAX_NODES_FOR_LABEL_PROP;
const MIN_NODES_FOR_LOUVAIN = CLUSTER.MIN_NODES_FOR_SUBGROUP;

interface CommunityData {
  totalDegree: number;
  nodes: Set<string>;
}

function computeModularityGain(
  nodeId: string,
  communityId: string,
  communities: Map<string, CommunityData>,
  adjacency: Map<string, Set<string>>,
  nodeDegrees: Map<string, number>,
  totalEdges: number,
): number {
  const nodeDegree = nodeDegrees.get(nodeId) ?? 0;
  const community = communities.get(communityId);
  if (!community) return 0;

  let linksToCommunity = 0;
  const neighbors = adjacency.get(nodeId);
  if (neighbors) {
    for (const nb of neighbors) {
      if (community.nodes.has(nb)) linksToCommunity++;
    }
  }

  const communityDegree = community.totalDegree;
  const m = totalEdges;
  if (m === 0) return 0;

  return (linksToCommunity - (nodeDegree * communityDegree) / (2 * m));
}

export function detectLouvainCommunities(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, LouvainCommunity> {
  if (nodes.length === 0) return new Map();
  if (nodes.length < MIN_NODES_FOR_LOUVAIN) {
    return new Map([['all', { label: 'all', nodes }]]);
  }

  const participatingNodes = nodes.length > MAX_NODES_FOR_LOUVAIN
    ? selectHighDegreeNodes(nodes, edges, MAX_NODES_FOR_LOUVAIN)
    : nodes;
  const participatingIds = new Set(participatingNodes.map((n) => n.id));

  const adjacency = buildFilteredUndirectedAdjacency(edges, participatingIds);

  const nodeDegrees = new Map<string, number>();
  let totalEdges = 0;
  for (const n of participatingNodes) {
    const neighbors = adjacency.get(n.id);
    const deg = neighbors ? neighbors.size : 0;
    nodeDegrees.set(n.id, deg);
    totalEdges += deg;
  }
  totalEdges = totalEdges / 2;
  if (totalEdges === 0) {
    return new Map([['all', { label: 'all', nodes: participatingNodes }]]);
  }

  const nodeToCommunity = new Map<string, string>();
  const communities = new Map<string, CommunityData>();
  let nextCommunityId = 0;
  for (const n of participatingNodes) {
    const cid = `c${nextCommunityId++}`;
    nodeToCommunity.set(n.id, cid);
    communities.set(cid, {
      totalDegree: nodeDegrees.get(n.id) ?? 0,
      nodes: new Set([n.id]),
    });
  }

  let improved = true;
  let iteration = 0;
  while (improved && iteration < LOUVAIN.MAX_ITERATIONS) {
    improved = false;
    iteration++;

    for (const n of participatingNodes) {
      const currentCommunity = nodeToCommunity.get(n.id)!;
      const neighbors = adjacency.get(n.id);
      if (!neighbors || neighbors.size === 0) continue;

      const neighborCommunities = new Map<string, number>();
      for (const nb of neighbors) {
        const nbCommunity = nodeToCommunity.get(nb);
        if (nbCommunity) {
          neighborCommunities.set(
            nbCommunity,
            (neighborCommunities.get(nbCommunity) ?? 0) + 1,
          );
        }
      }

      const currentCommunityData = communities.get(currentCommunity)!;
      const nodeDegree = nodeDegrees.get(n.id) ?? 0;

      currentCommunityData.nodes.delete(n.id);
      currentCommunityData.totalDegree -= nodeDegree;

      let bestCommunity = currentCommunity;
      let bestGain = computeModularityGain(
        n.id, currentCommunity, communities, adjacency, nodeDegrees, totalEdges,
      );

      for (const [candidateCommunity, _] of neighborCommunities) {
        if (candidateCommunity === currentCommunity) continue;
        const gain = computeModularityGain(
          n.id, candidateCommunity, communities, adjacency, nodeDegrees, totalEdges,
        );
        if (gain > bestGain) {
          bestGain = gain;
          bestCommunity = candidateCommunity;
        }
      }

      const targetCommunity = communities.get(bestCommunity);
      if (targetCommunity) {
        targetCommunity.nodes.add(n.id);
        targetCommunity.totalDegree += nodeDegree;
      } else {
        communities.set(bestCommunity, {
          totalDegree: nodeDegree,
          nodes: new Set([n.id]),
        });
      }
      nodeToCommunity.set(n.id, bestCommunity);

      if (bestCommunity !== currentCommunity) {
        improved = true;
      }

      if (currentCommunityData.nodes.size === 0) {
        communities.delete(currentCommunity);
      }
    }
  }

  const result = new Map<string, LouvainCommunity>();
  const communityLabels = new Map<string, string>();
  let labelIdx = 0;
  for (const [cid, data] of communities) {
    const label = `community-${labelIdx++}`;
    communityLabels.set(cid, label);
    const communityNodes: GraphNode[] = [];
    for (const nodeId of data.nodes) {
      const node = participatingNodes.find((n) => n.id === nodeId);
      if (node) communityNodes.push(node);
    }
    result.set(label, { label, nodes: communityNodes });
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

    const overflowCommunity: LouvainCommunity = { label: 'overflow', nodes: [] };
    for (const n of overflowNodes) {
      const neighbors = overflowAdjacency.get(n.id) ?? [];
      let assigned = false;
      for (const neighborId of neighbors) {
        const cid = nodeToCommunity.get(neighborId);
        if (cid) {
          const lbl = communityLabels.get(cid);
          if (lbl) {
            const group = result.get(lbl);
            if (group) { group.nodes.push(n); assigned = true; break; }
          }
        }
      }
      if (!assigned) overflowCommunity.nodes.push(n);
    }
    if (overflowCommunity.nodes.length > 0) {
      result.set('overflow', overflowCommunity);
    }
  }

  return result;
}