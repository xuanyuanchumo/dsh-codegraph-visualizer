import type { Core } from 'cytoscape';

export class AdjacencyCache {
  private forward: Map<string, Set<string>> = new Map();
  private backward: Map<string, Set<string>> = new Map();
  private undirected: Map<string, Set<string>> = new Map();
  private edgeIdMap: Map<string, string> = new Map();
  private valid = false;

  invalidate(): void {
    this.valid = false;
  }

  isValid(): boolean {
    return this.valid;
  }

  private rebuild(cy: Core): void {
    this.forward.clear();
    this.backward.clear();
    this.undirected.clear();
    this.edgeIdMap.clear();

    cy.edges().forEach((edge) => {
      const s = edge.source().id();
      const t = edge.target().id();
      const eId = edge.id();

      let fwdSet = this.forward.get(s);
      if (!fwdSet) { fwdSet = new Set(); this.forward.set(s, fwdSet); }
      fwdSet.add(t);

      let bwdSet = this.backward.get(t);
      if (!bwdSet) { bwdSet = new Set(); this.backward.set(t, bwdSet); }
      bwdSet.add(s);

      let undSet = this.undirected.get(s);
      if (!undSet) { undSet = new Set(); this.undirected.set(s, undSet); }
      undSet.add(t);
      undSet = this.undirected.get(t);
      if (!undSet) { undSet = new Set(); this.undirected.set(t, undSet); }
      undSet.add(s);

      this.edgeIdMap.set(`${s}->${t}`, eId);
    });

    this.valid = true;
  }

  getForwardAdjacency(cy: Core): Map<string, Set<string>> {
    if (!this.valid) this.rebuild(cy);
    return this.forward;
  }

  getBackwardAdjacency(cy: Core): Map<string, Set<string>> {
    if (!this.valid) this.rebuild(cy);
    return this.backward;
  }

  getDirectedAdjacency(cy: Core): { forward: Map<string, Set<string>>; backward: Map<string, Set<string>> } {
    if (!this.valid) this.rebuild(cy);
    return { forward: this.forward, backward: this.backward };
  }

  getUndirectedAdjacency(cy: Core): Map<string, Set<string>> {
    if (!this.valid) this.rebuild(cy);
    return this.undirected;
  }

  getEdgeIdMap(cy: Core): Map<string, string> {
    if (!this.valid) this.rebuild(cy);
    return this.edgeIdMap;
  }

  destroy(): void {
    this.forward.clear();
    this.backward.clear();
    this.undirected.clear();
    this.edgeIdMap.clear();
    this.valid = false;
  }
}