import type { Core } from 'cytoscape';
import { NodeId } from '../../types/index.ts';
import { HIGHLIGHT } from '../../shared/constants.ts';


export class HighlightController {
  private cy: Core;
  private highlightedNodeIds: Set<string> = new Set();
  private selectedNodeId: string | null = null;
  private lastInheritanceRelevant: Set<string> = new Set();
  private adjacencyMap: Map<string, Set<string>> | null = null;

  constructor(cy: Core) {
    this.cy = cy;
  }

  private getAdjacencyMap(): Map<string, Set<string>> {
    if (this.adjacencyMap) return this.adjacencyMap;
    const map = new Map<string, Set<string>>();
    this.cy.edges().forEach((edge) => {
      const s = edge.source().id();
      const t = edge.target().id();
      let neighbors = map.get(s);
      if (!neighbors) { neighbors = new Set(); map.set(s, neighbors); }
      neighbors.add(t);
      neighbors = map.get(t);
      if (!neighbors) { neighbors = new Set(); map.set(t, neighbors); }
      neighbors.add(s);
    });
    this.adjacencyMap = map;
    return map;
  }

  invalidateCache(): void {
    this.adjacencyMap = null;
  }

  highlightNodes(nodeIds: NodeId[]): void {
    const newSet = new Set<string>(nodeIds);
    this.cy.batch(() => {
      const nodesToUnhighlight: string[] = [];
      const nodesToHighlight: string[] = [];
      for (const id of this.highlightedNodeIds) {
        if (!newSet.has(id)) nodesToUnhighlight.push(id);
      }
      for (const id of newSet) {
        if (!this.highlightedNodeIds.has(id)) nodesToHighlight.push(id);
      }
      for (const id of nodesToUnhighlight) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.removeClass('highlighted');
      }
      for (const id of nodesToHighlight) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.addClass('highlighted');
      }
      this.cy.edges().forEach((edge) => {
        const srcId = edge.source().id();
        const tgtId = edge.target().id();
        const shouldHighlight = newSet.has(srcId) || newSet.has(tgtId);
        edge.toggleClass('highlighted', shouldHighlight);
      });
    });
    this.highlightedNodeIds = newSet;
  }

  selectNode(nodeId: NodeId | null): void {
    const id = nodeId ?? null;
    if (this.selectedNodeId === id) return;
    this.cy.batch(() => {
      if (this.selectedNodeId) {
        const prev = this.cy.getElementById(this.selectedNodeId);
        if (prev.nonempty()) prev.removeClass('selected');
      }
      if (id) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.addClass('selected');
      }
      this.cy.elements().removeClass('neighbor-highlight neighbor-dim');
      if (id) {
        const selectedNode = this.cy.getElementById(id);
        if (selectedNode.nonempty()) {
          const neighborIds = new Set<string>([id]);
          selectedNode.neighborhood().forEach((el) => {
            if (el.isNode()) neighborIds.add(el.id());
          });
          this.cy.nodes().forEach((n) => {
            if (!neighborIds.has(n.id())) n.addClass('neighbor-dim');
          });
          this.cy.edges().forEach((e) => {
            const srcIn = neighborIds.has(e.source().id());
            const tgtIn = neighborIds.has(e.target().id());
            if (!srcIn || !tgtIn) e.addClass('neighbor-dim');
            else e.addClass('neighbor-highlight');
          });
        }
      }
    });
    this.selectedNodeId = id;
  }

  highlightCallChain(nodeId: NodeId | null, maxDepth: number = HIGHLIGHT.CALL_CHAIN_MAX_DEPTH): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('call-chain');
      if (!nodeId) return;

      const visited = new Set<string>();
      const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
      let head = 0;

      while (head < queue.length) {
        const item = queue[head++]!;
        if (visited.has(item.id)) continue;
        if (item.depth > maxDepth) continue;
        visited.add(item.id);

        const node = this.cy.getElementById(item.id);
        if (node.nonempty()) node.addClass('call-chain');

        node.connectedEdges().forEach((edge) => {
          if (edge.source().id() !== item.id) return;
          edge.addClass('call-chain');
          const target = edge.target().id();
          if (!visited.has(target)) queue.push({ id: target, depth: item.depth + 1 });
        });
      }
    });
  }

  highlightInheritance(nodeId: NodeId | null): void {
    if (!nodeId) {
      this.cy.batch(() => {
        this.cy.elements().removeClass('inheritance-highlight inheritance-dim inheritance-focus inheritance-extend inheritance-implement');
        this.cy.edges('[type="extend"]').addClass('inheritance-extend');
        this.cy.edges('[type="implement"]').addClass('inheritance-implement');
      });
      this.lastInheritanceRelevant.clear();
      return;
    }

    const focusNode = this.cy.getElementById(nodeId);
    if (focusNode.empty()) return;

    const relevant = new Set<string>([nodeId]);
    const relevantEdges = new Set<string>();
    const stack: Array<{ id: string; direction: 'up' | 'down' }> = [
      { id: nodeId, direction: 'up' },
      { id: nodeId, direction: 'down' },
    ];

    while (stack.length > 0) {
      const { id, direction } = stack.pop()!;
      const node = this.cy.getElementById(id);
      const edges = direction === 'up'
        ? node.outgoers('edge[type="extend"], edge[type="implement"]')
        : node.incomers('edge[type="extend"], edge[type="implement"]');
      edges.forEach((edge) => {
        const target = direction === 'up' ? edge.target().id() : edge.source().id();
        if (!relevant.has(target)) {
          relevant.add(target);
          relevantEdges.add(edge.id());
          stack.push({ id: target, direction });
        }
      });
    }

    const toHighlight: string[] = [];
    const toUnhighlight: string[] = [];
    for (const id of relevant) {
      if (!this.lastInheritanceRelevant.has(id)) toHighlight.push(id);
    }
    for (const id of this.lastInheritanceRelevant) {
      if (!relevant.has(id)) toUnhighlight.push(id);
    }

    this.cy.batch(() => {
      for (const id of toUnhighlight) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.removeClass('inheritance-highlight inheritance-dim inheritance-focus');
      }
      this.cy.elements().removeClass('inheritance-focus');
      focusNode.addClass('inheritance-focus');
      for (const id of toHighlight) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.addClass('inheritance-highlight');
      }

      this.cy.edges('[type="extend"], edge[type="implement"]').forEach((edge) => {
        if (!relevantEdges.has(edge.id()) && !relevant.has(edge.source().id()) && !relevant.has(edge.target().id())) {
          edge.addClass('inheritance-dim');
        } else {
          edge.removeClass('inheritance-dim');
          if (relevantEdges.has(edge.id())) edge.addClass('inheritance-highlight');
        }
      });
      this.cy.edges('[type!="extend"][type!="implement"]').addClass('inheritance-dim');

      for (const id of toHighlight) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.removeClass('inheritance-dim');
      }
    });

    this.lastInheritanceRelevant = relevant;
  }

  destroy(): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('highlighted selected neighbor-highlight neighbor-dim call-chain inheritance-highlight inheritance-dim inheritance-focus inheritance-extend inheritance-implement');
    });
    this.highlightedNodeIds.clear();
    this.selectedNodeId = null;
    this.lastInheritanceRelevant.clear();
  }
}
