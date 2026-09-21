import type { GraphEdge } from '../../types/index.ts';

export type AdjacencyMap = Map<string, string[]>;

export interface DirectedAdjacencyMaps {
  forward: AdjacencyMap;
  backward: AdjacencyMap;
}

export function buildForwardAdjacency(edges: GraphEdge[]): AdjacencyMap {
  const map: AdjacencyMap = new Map();
  for (const edge of edges) {
    const list = map.get(edge.source);
    if (list) list.push(edge.target);
    else map.set(edge.source, [edge.target]);
  }
  return map;
}

export function buildBackwardAdjacency(edges: GraphEdge[]): AdjacencyMap {
  const map: AdjacencyMap = new Map();
  for (const edge of edges) {
    const list = map.get(edge.target);
    if (list) list.push(edge.source);
    else map.set(edge.target, [edge.source]);
  }
  return map;
}

export function buildDirectedAdjacency(edges: GraphEdge[]): DirectedAdjacencyMaps {
  const forward: AdjacencyMap = new Map();
  const backward: AdjacencyMap = new Map();
  for (const edge of edges) {
    let fwdList = forward.get(edge.source);
    if (!fwdList) { fwdList = []; forward.set(edge.source, fwdList); }
    fwdList.push(edge.target);

    let bwdList = backward.get(edge.target);
    if (!bwdList) { bwdList = []; backward.set(edge.target, bwdList); }
    bwdList.push(edge.source);
  }
  return { forward, backward };
}

export function buildUndirectedAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const edge of edges) {
    let neighbors = map.get(edge.source);
    if (!neighbors) { neighbors = new Set(); map.set(edge.source, neighbors); }
    neighbors.add(edge.target);

    neighbors = map.get(edge.target);
    if (!neighbors) { neighbors = new Set(); map.set(edge.target, neighbors); }
    neighbors.add(edge.source);
  }
  return map;
}

export function buildFilteredUndirectedAdjacency(
  edges: GraphEdge[],
  nodeIds: Set<string>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const id of nodeIds) map.set(id, new Set());
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    let neighbors = map.get(edge.source);
    if (!neighbors) { neighbors = new Set(); map.set(edge.source, neighbors); }
    neighbors.add(edge.target);

    neighbors = map.get(edge.target);
    if (!neighbors) { neighbors = new Set(); map.set(edge.target, neighbors); }
    neighbors.add(edge.source);
  }
  return map;
}

export function buildFilteredForwardAdjacency(edges: GraphEdge[], edgeTypes: string[]): AdjacencyMap {
  const map: AdjacencyMap = new Map();
  for (const edge of edges) {
    if (!edgeTypes.includes(edge.type)) continue;
    const list = map.get(edge.source);
    if (list) list.push(edge.target);
    else map.set(edge.source, [edge.target]);
  }
  return map;
}