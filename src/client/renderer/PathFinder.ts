import type { Core } from 'cytoscape';
import { NodeId } from '../../types/index.ts';
import { PATH_FINDER } from '../../shared/constants.ts';

export interface PathResult {
  source: NodeId;
  target: NodeId;
  path: NodeId[];
  length: number;
}

export class PathFinder {
  private cy: Core;

  constructor(cy: Core) {
    this.cy = cy;
  }

  findPath(sourceId: NodeId, targetId: NodeId): PathResult | null {
    const sourceNode = this.cy.getElementById(sourceId);
    const targetNode = this.cy.getElementById(targetId);
    if (sourceNode.empty() || targetNode.empty()) return null;

    const nodeCount = this.cy.nodes().length;
    if (nodeCount > PATH_FINDER.MAX_NODES_FOR_DIJKSTRA) return null;

    const dijkstra = this.cy.elements().dijkstra({ root: sourceNode });
    const pathToTarget = dijkstra.pathTo(targetNode);

    if (pathToTarget.length === 0) return null;

    const pathIds: NodeId[] = [];
    pathToTarget.forEach((el) => {
      if (el.isNode()) pathIds.push(NodeId(el.id()));
    });

    if (pathIds.length === 0) return null;

    return {
      source: sourceId,
      target: targetId,
      path: pathIds,
      length: pathIds.length - 1,
    };
  }

  highlightPath(path: NodeId[] | null): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('path-highlight path-dim');
      if (!path || path.length === 0) return;

      const pathSet = new Set<string>(path);
      const pathIndex = new Map<string, number>();
      path.forEach((id, i) => pathIndex.set(id, i));

      path.forEach((id) => {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.addClass('path-highlight');
      });

      this.cy.edges().forEach((edge) => {
        const srcId = edge.source().id();
        const tgtId = edge.target().id();
        if (pathSet.has(srcId) && pathSet.has(tgtId)) {
          const srcIdx = pathIndex.get(srcId);
          const tgtIdx = pathIndex.get(tgtId);
          if (srcIdx !== undefined && tgtIdx !== undefined && Math.abs(srcIdx - tgtIdx) === 1) {
            edge.addClass('path-highlight');
          }
        }
      });

      this.cy.elements().forEach((el) => {
        if (!pathSet.has(el.id()) && el.isNode()) el.addClass('path-dim');
      });
    });
  }

  destroy(): void {}
}