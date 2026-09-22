import type { Core } from 'cytoscape';
import type { DirectedAdjacencyMaps } from '../../shared/analysis/AdjacencyList.ts';

export type { DirectedAdjacencyMaps };

export function buildUndirectedAdjacencyMap(cy: Core): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  cy.edges().forEach((edge) => {
    const s = edge.source().id();
    const t = edge.target().id();
    let neighbors = map.get(s);
    if (!neighbors) { neighbors = new Set(); map.set(s, neighbors); }
    neighbors.add(t);
    neighbors = map.get(t);
    if (!neighbors) { neighbors = new Set(); map.set(t, neighbors); }
    neighbors.add(s);
  });
  return map;
}

export function buildDirectedAdjacencyMaps(cy: Core): DirectedAdjacencyMaps {
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  cy.edges().forEach((edge) => {
    const s = edge.source().id();
    const t = edge.target().id();
    let fwdList = forward.get(s);
    if (!fwdList) { fwdList = []; forward.set(s, fwdList); }
    fwdList.push(t);
    let bwdList = backward.get(t);
    if (!bwdList) { bwdList = []; backward.set(t, bwdList); }
    bwdList.push(s);
  });
  return { forward, backward };
}

export function buildForwardAdjacencyMap(cy: Core): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  cy.edges().forEach((edge) => {
    const s = edge.source().id();
    const t = edge.target().id();
    const list = adjacency.get(s);
    if (list) list.push(t);
    else adjacency.set(s, [t]);
  });
  return adjacency;
}