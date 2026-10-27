import type { Core } from 'cytoscape';

import { scoped } from '../../shared/Logger.ts';
import { CYCLE_DETECTION } from '../../shared/constants.ts';
import { detectCyclesDFS } from '../../shared/analysis/CycleDFS.ts';
import { buildForwardAdjacencyMap } from './AdjacencyMapBuilder.ts';
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
    const fwdArray = buildForwardAdjacencyMap(this.cy);
    const adjacency = new Map<string, Set<string>>();
    for (const [k, v] of fwdArray) adjacency.set(k, new Set(v));
    return adjacency;
  }

  /**
   * 节点对 → 边 id。
   *
   * AdjacencyCache 返回的是**双键**表：旧键 `${s}->${t}`（同端最后写入的边）与
   * 精确键 `${s}->${t}->${type}`。环检测只按节点对回查边，沿用旧键即可，
   * 因此这里无需感知边类型（同端多重边取最后一条，与旧行为一致）。
   */
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

    const adjacencySet = this.getForwardAdjacency();
    const adjacency: Map<string, string[]> = new Map();
    for (const [k, v] of adjacencySet) adjacency.set(k, [...v]);

    const detectedCycles = detectCyclesDFS(adjacency);
    for (const cycle of detectedCycles) {
      for (const nodeId of cycle) cycles.add(nodeId);
    }

    return cycles;
  }

  detectCyclesDetailed(): CycleInfo[] {
    const nodeCount = this.cy.nodes().length;
    if (nodeCount > CYCLE_DETECTION.MAX_NODES_FOR_DETECTION) {
      log.warn('detailed cycle detection skipped: graph too large', { nodeCount });
      return [];
    }

    const adjacencySet = this.getForwardAdjacency();
    const adjacency: Map<string, string[]> = new Map();
    for (const [k, v] of adjacencySet) adjacency.set(k, [...v]);
    const edgeMap = this.getEdgeIdMap();

    const detectedCycles = detectCyclesDFS(adjacency);
    const cycleList: CycleInfo[] = [];

    for (const cycle of detectedCycles) {
      const nodes = cycle.slice(0, -1);
      const edges: string[] = [];
      for (let i = 0; i < cycle.length - 1; i++) {
        const eId = edgeMap.get(`${cycle[i]}->${cycle[i + 1]}`);
        if (eId) edges.push(eId);
      }
      cycleList.push({
        nodes,
        length: nodes.length,
        edges,
      });
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
