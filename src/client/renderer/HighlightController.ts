import type { Core } from 'cytoscape';
import { NodeId } from '../../types/index.ts';

export class HighlightController {
  private cy: Core;
  private highlightedNodeIds: Set<string> = new Set();

  constructor(cy: Core) {
    this.cy = cy;
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

  private selectedNodeId: string | null = null;

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

  highlightCallChain(nodeId: NodeId | null): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('call-chain');
      if (!nodeId) return;

      const visited = new Set<string>();
      const queue = [nodeId];
      let head = 0;

      while (head < queue.length) {
        const id = queue[head++]!;
        if (visited.has(id)) continue;
        visited.add(id);

        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.addClass('call-chain');

        node.connectedEdges().forEach((edge) => {
          if (edge.source().id() !== id) return;
          edge.addClass('call-chain');
          const target = edge.target().id();
          if (!visited.has(target)) queue.push(NodeId(target));
        });
      }
    });
  }

  detectCycles(): Set<string> {
    const cycles = new Set<string>();

    const adjacency = new Map<string, string[]>();
    this.cy.edges().forEach((edge) => {
      const s = edge.source().id();
      const t = edge.target().id();
      const list = adjacency.get(s);
      if (list) list.push(t);
      else adjacency.set(s, [t]);
    });

    const visited = new Set<string>();
    const inStack = new Set<string>();

    const enter = (start: string): void => {
      const path: string[] = [];
      const pathIndex = new Map<string, number>();
      const frames: Array<{ id: string; neighbors: string[]; next: number }> = [
        { id: start, neighbors: adjacency.get(start) ?? [], next: 0 },
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
          frames.push({ id: target, neighbors: adjacency.get(target) ?? [], next: 0 });
        }
      }
    };

    for (const id of adjacency.keys()) {
      if (!visited.has(id)) enter(id);
    }

    return cycles;
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

  private computeImpact(nodeId: NodeId): Map<string, number> {
    const visited = new Map<string, number>();
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
    let head = 0;

    while (head < queue.length) {
      const { id, depth } = queue[head++]!;
      if (visited.has(id) && visited.get(id)! <= depth) continue;
      visited.set(id, depth);

      if (depth < 3) {
        const node = this.cy.getElementById(id);
        node.incomers().forEach((edge) => {
          const src = edge.source().id();
          if (!visited.has(src) || visited.get(src)! > depth + 1) {
            queue.push({ id: src, depth: depth + 1 });
          }
        });
      }
    }

    return visited;
  }

  highlightImpact(nodeId: NodeId | null): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('impact-d1 impact-d2 impact-d3 impact-source');
      if (!nodeId) return;

      const sourceNode = this.cy.getElementById(nodeId);
      if (sourceNode.nonempty()) sourceNode.addClass('impact-source');

      const visited = this.computeImpact(nodeId);
      for (const [id, depth] of visited) {
        if (depth > 0) {
          const node = this.cy.getElementById(id);
          if (node.nonempty()) {
            const cls = depth <= 1 ? 'impact-d1' : depth === 2 ? 'impact-d2' : 'impact-d3';
            node.addClass(cls);
          }
        }
      }
    });
  }

  getImpactStats(nodeId: NodeId): { d1: number; d2: number; d3: number; total: number } | null {
    const sourceNode = this.cy.getElementById(nodeId);
    if (sourceNode.empty()) return null;

    const visited = this.computeImpact(nodeId);
    let d1 = 0, d2 = 0, d3 = 0;
    for (const depth of visited.values()) {
      if (depth > 0) {
        if (depth <= 1) d1++;
        else if (depth === 2) d2++;
        else d3++;
      }
    }

    return { d1, d2, d3, total: d1 + d2 + d3 };
  }

  private lastInheritanceRelevant: Set<string> = new Set();

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
    this.highlightedNodeIds.clear();
  }
}