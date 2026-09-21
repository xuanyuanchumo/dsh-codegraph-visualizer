import type { Core } from 'cytoscape';

import { scoped } from '../../shared/Logger.ts';
import { CYCLE_DETECTION } from '../../shared/constants.ts';
import type { AdjacencyCache } from './AdjacencyCache.ts';

const log = scoped('cycle-detector');

export interface CycleInfo {
  nodes: string[];
  length: number;
  edges: string[];
}

export class CycleDetector {
  private cy: Core;
  private adjacencyCache: AdjacencyCache | null;

  constructor(cy: Core, adjacencyCache?: AdjacencyCache) {
    this.cy = cy;
    this.adjacencyCache = adjacencyCache ?? null;
  }

  private getForwardAdjacency(): Map<string, Set<string>> {
    if (this.adjacencyCache) {
      return this.adjacencyCache.getForwardAdjacency(this.cy);
    }
    const adjacency = new Map<string, Set<string>>();
    this.cy.edges().forEach((edge) => {
      const s = edge.source().id();
      const t = edge.target().id();
      let set = adjacency.get(s);
      if (!set) { set = new Set(); adjacency.set(s, set); }
      set.add(t);
    });
    return adjacency;
  }

  private getEdgeIdMap(): Map<string, string> {
    if (this.adjacencyCache) {
      return this.adjacencyCache.getEdgeIdMap(this.cy);
    }
    const edgeMap = new Map<string, string>();
    this.cy.edges().forEach((edge) => {
      const s = edge.source().id();
      const t = edge.target().id();
      edgeMap.set(`${s}->${t}`, edge.id());
    });
    return edgeMap;
  }

  detectCycles(): Set<string> {
    const cycles = new Set<string>();

    const nodeCount = this.cy.nodes().length;
    if (nodeCount > CYCLE_DETECTION.MAX_NODES_FOR_DETECTION) {
      log.warn('cycle detection skipped: graph too large', { nodeCount });
      return cycles;
    }

    const adjacency = this.getForwardAdjacency();

    const visited = new Set<string>();
    const inStack = new Set<string>();

    const enter = (start: string): void => {
      const path: string[] = [];
      const pathIndex = new Map<string, number>();
      const frames: Array<{ id: string; neighbors: string[]; next: number }> = [
        { id: start, neighbors: [...(adjacency.get(start) ?? [])], next: 0 },
      ];
      visited.add(start);
      inStack.add(start);
      path.push(start);
      pathIndex.set(start, 0);

      while (frames.length > 0) {
        const frame = frames[frames.length - 1]!;
        if (frame.next >= frame.neighbors.length) {
          inStack.delete(frame.id);
          path.pop();
          pathIndex.delete(frame.id);
          frames.pop();
          continue;
        }
        const target = frame.neighbors[frame.next++]!;
        if (inStack.has(target)) {
          const cycleStart = pathIndex.get(target);
          if (cycleStart !== undefined) {
            for (let i = cycleStart; i < path.length; i++) cycles.add(path[i]!);
          }
        } else if (!visited.has(target)) {
          visited.add(target);
          inStack.add(target);
          path.push(target);
          pathIndex.set(target, path.length - 1);
          frames.push({ id: target, neighbors: [...(adjacency.get(target) ?? [])], next: 0 });
        }
      }
    };

    for (const id of adjacency.keys()) {
      if (!visited.has(id)) enter(id);
    }

    return cycles;
  }

  detectCyclesDetailed(): CycleInfo[] {
    const nodeCount = this.cy.nodes().length;
    if (nodeCount > CYCLE_DETECTION.MAX_NODES_FOR_DETECTION) {
      log.warn('detailed cycle detection skipped: graph too large', { nodeCount });
      return [];
    }

    const adjacency = this.getForwardAdjacency();
    const edgeMap = this.getEdgeIdMap();

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycleList: CycleInfo[] = [];
    const seenCycleKeys = new Set<string>();

    const enter = (start: string): void => {
      const path: string[] = [];
      const pathIndex = new Map<string, number>();
      const frames: Array<{ id: string; neighbors: string[]; next: number }> = [
        { id: start, neighbors: [...(adjacency.get(start) ?? [])], next: 0 },
      ];
      visited.add(start);
      inStack.add(start);
      path.push(start);
      pathIndex.set(start, 0);

      while (frames.length > 0) {
        const frame = frames[frames.length - 1]!;
        if (frame.next >= frame.neighbors.length) {
          inStack.delete(frame.id);
          path.pop();
          pathIndex.delete(frame.id);
          frames.pop();
          continue;
        }
        const target = frame.neighbors[frame.next++]!;
        if (inStack.has(target)) {
          const cycleStart = pathIndex.get(target);
          if (cycleStart !== undefined) {
            const cycleNodes = path.slice(cycleStart);
            cycleNodes.push(target);
            const cycleKey = [...cycleNodes].sort().join('|');
            if (!seenCycleKeys.has(cycleKey)) {
              seenCycleKeys.add(cycleKey);
              const edges: string[] = [];
              for (let i = 0; i < cycleNodes.length - 1; i++) {
                const eId = edgeMap.get(`${cycleNodes[i]}->${cycleNodes[i + 1]}`);
                if (eId) edges.push(eId);
              }
              const closingEdge = edgeMap.get(`${cycleNodes[cycleNodes.length - 2]}->${target}`);
              if (closingEdge && !edges.includes(closingEdge)) edges.push(closingEdge);
              cycleList.push({
                nodes: cycleNodes.slice(0, -1),
                length: cycleNodes.length - 1,
                edges,
              });
            }
          }
        } else if (!visited.has(target)) {
          visited.add(target);
          inStack.add(target);
          path.push(target);
          pathIndex.set(target, path.length - 1);
          frames.push({ id: target, neighbors: [...(adjacency.get(target) ?? [])], next: 0 });
        }
      }
    };

    for (const id of adjacency.keys()) {
      if (!visited.has(id)) enter(id);
    }

    return cycleList;
  }

  highlightCycles(cycleIds: Set<string>): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('cycle-highlight');
      cycleIds.forEach((id) => {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.addClass('cycle-highlight');
      });
    });
  }

  isolateCycles(cycleIds: Set<string>): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('cycle-hidden');
      this.cy.nodes().forEach((node) => {
        if (!cycleIds.has(node.id())) node.addClass('cycle-hidden');
      });
      this.cy.edges().forEach((edge) => {
        const srcIn = cycleIds.has(edge.source().id());
        const tgtIn = cycleIds.has(edge.target().id());
        if (!srcIn || !tgtIn) edge.addClass('cycle-hidden');
      });
    });
  }

  relayoutCycles(cycleIds: Set<string>): void {
    if (cycleIds.size === 0) return;
    const visibleNodes = this.cy.nodes().filter((n) => cycleIds.has(n.id()));
    if (visibleNodes.length === 0) return;
    const layout = visibleNodes.layout({
      name: 'circle',
      fit: true,
      padding: 50,
      animate: true,
      animationDuration: 300,
      boundingBox: undefined,
    });
    layout.run();
  }

  restoreIsolation(): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('cycle-hidden');
    });
  }

  destroy(): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('cycle-highlight cycle-hidden');
    });
    this.adjacencyCache = null;
  }
}
