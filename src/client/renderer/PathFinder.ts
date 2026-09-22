import type { Core } from 'cytoscape';
import { NodeId } from '../../types/index.ts';
import { PATH_FINDER as PF_CONST } from '../../shared/constants.ts';
import { buildDirectedAdjacencyMaps } from './AdjacencyMapBuilder.ts';
import type { AdjacencyCache } from './AdjacencyCache.ts';

export interface PathResult {
  source: NodeId;
  target: NodeId;
  path: NodeId[];
  length: number;
}

const BIDIRECTIONAL_BFS_LIMIT = PF_CONST.MAX_NODES_FOR_BFS;

export class PathFinder {
  private cy: Core;
  private adjacencyCache: AdjacencyCache | null;

  constructor(cy: Core, adjacencyCache?: AdjacencyCache) {
    this.cy = cy;
    this.adjacencyCache = adjacencyCache ?? null;
  }

  findPath(sourceId: NodeId, targetId: NodeId): PathResult | null {
    const sourceNode = this.cy.getElementById(sourceId);
    const targetNode = this.cy.getElementById(targetId);
    if (sourceNode.empty() || targetNode.empty()) return null;

    if (sourceId === targetId) {
      return { source: sourceId, target: targetId, path: [sourceId], length: 0 };
    }

    const nodeCount = this.cy.nodes().length;
    if (nodeCount > BIDIRECTIONAL_BFS_LIMIT) return null;

    const adjacency = this.getDirectedAdjacency();
    return this.bidirectionalBFS(sourceId, targetId, adjacency);
  }

  private getDirectedAdjacency(): { forward: Map<string, Set<string>>; backward: Map<string, Set<string>> } {
    if (this.adjacencyCache) {
      return this.adjacencyCache.getDirectedAdjacency(this.cy);
    }
    const directed = buildDirectedAdjacencyMaps(this.cy);
    const forward = new Map<string, Set<string>>();
    const backward = new Map<string, Set<string>>();
    for (const [k, v] of directed.forward) forward.set(k, new Set(v));
    for (const [k, v] of directed.backward) backward.set(k, new Set(v));
    return { forward, backward };
  }

  private bidirectionalBFS(
    sourceId: NodeId,
    targetId: NodeId,
    adjacency: { forward: Map<string, Set<string>>; backward: Map<string, Set<string>> },
  ): PathResult | null {
    const forwardVisited = new Map<string, string | null>();
    const backwardVisited = new Map<string, string | null>();
    const forwardQueue: string[] = [sourceId];
    const backwardQueue: string[] = [targetId];
    forwardVisited.set(sourceId, null);
    backwardVisited.set(targetId, null);

    let forwardHead = 0;
    let backwardHead = 0;
    let meetingPoint: string | null = null;

    while (forwardHead < forwardQueue.length && backwardHead < backwardQueue.length) {
      const fwdResult = this.bfsStep(forwardQueue, forwardHead, forwardVisited, backwardVisited, adjacency.forward);
      forwardHead = fwdResult.newHead;
      if (fwdResult.meetingNode) {
        meetingPoint = fwdResult.meetingNode;
        break;
      }

      const bwdResult = this.bfsStep(backwardQueue, backwardHead, backwardVisited, forwardVisited, adjacency.backward);
      backwardHead = bwdResult.newHead;
      if (bwdResult.meetingNode) {
        meetingPoint = bwdResult.meetingNode;
        break;
      }
    }

    if (!meetingPoint) return null;

    const forwardPath = this.reconstructPath(forwardVisited, meetingPoint, sourceId);
    const backwardPath = this.reconstructPath(backwardVisited, meetingPoint, targetId);
    backwardPath.reverse();
    const fullPath = [...forwardPath, ...backwardPath.slice(1)];

    const pathIds: NodeId[] = fullPath.map((id) => NodeId(id));

    return {
      source: sourceId,
      target: targetId,
      path: pathIds,
      length: pathIds.length - 1,
    };
  }

  private bfsStep(
    queue: string[],
    head: number,
    visited: Map<string, string | null>,
    otherVisited: Map<string, string | null>,
    adjacency: Map<string, Set<string>>,
  ): { newHead: number; meetingNode: string | null } {
    const currentId = queue[head];
    head++;

    if (!currentId) return { newHead: head, meetingNode: null };

    const neighbors = adjacency.get(currentId);
    let meetingNode: string | null = null;

    if (neighbors) {
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.set(neighborId, currentId);
          queue.push(neighborId);
          if (otherVisited.has(neighborId)) {
            meetingNode = neighborId;
          }
        }
      }
    }

    return { newHead: head, meetingNode };
  }

  private reconstructPath(visited: Map<string, string | null>, meetingPoint: string, endpoint: string): string[] {
    const path: string[] = [];
    let current: string | null = meetingPoint;
    while (current !== null) {
      path.push(current);
      current = visited.get(current) ?? null;
    }
    if (path[path.length - 1] !== endpoint) {
      path.push(endpoint);
    }
    path.reverse();
    return path;
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

  destroy(): void {
    this.adjacencyCache = null;
  }
}
