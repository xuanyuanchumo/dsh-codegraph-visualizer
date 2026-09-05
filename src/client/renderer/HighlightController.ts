import type { Core } from 'cytoscape';
import type { NodeId } from '../../types/index.ts';

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

  selectNode(nodeId: NodeId | null): void {
    this.cy.batch(() => {
      this.cy.elements().forEach((ele) => {
        ele.toggleClass('selected', ele.isNode() && ele.id() === nodeId);
      });
    });
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
          if (!visited.has(target)) queue.push(target as NodeId);
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
    const path: string[] = [];

    const enter = (start: string): void => {
      const frames: Array<{ id: string; neighbors: string[]; next: number }> = [
        { id: start, neighbors: adjacency.get(start) ?? [], next: 0 },
      ];
      visited.add(start);
      inStack.add(start);
      path.push(start);

      while (frames.length > 0) {
        const frame = frames[frames.length - 1]!;
        if (frame.next >= frame.neighbors.length) {
          inStack.delete(frame.id);
          path.pop();
          frames.pop();
          continue;
        }
        const target = frame.neighbors[frame.next++]!;
        if (inStack.has(target)) {
          const cycleStart = path.indexOf(target);
          if (cycleStart >= 0) {
            for (let i = cycleStart; i < path.length; i++) cycles.add(path[i]!);
          }
        } else if (!visited.has(target)) {
          visited.add(target);
          inStack.add(target);
          path.push(target);
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

  highlightImpact(nodeId: NodeId | null): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('impact-d1 impact-d2 impact-d3 impact-source');
      if (!nodeId) return;

      const sourceNode = this.cy.getElementById(nodeId);
      if (sourceNode.nonempty()) sourceNode.addClass('impact-source');

      const visited = new Map<string, number>();
      const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
      let head = 0;

      while (head < queue.length) {
        const { id, depth } = queue[head++]!;
        if (visited.has(id) && visited.get(id)! <= depth) continue;
        visited.set(id, depth);

        const node = this.cy.getElementById(id);
        if (depth > 0 && node.nonempty()) {
          const cls = depth <= 1 ? 'impact-d1' : depth === 2 ? 'impact-d2' : 'impact-d3';
          node.addClass(cls);
        }

        if (depth < 3) {
          node.incomers().forEach((edge) => {
            const src = edge.source().id();
            if (!visited.has(src) || visited.get(src)! > depth + 1) {
              queue.push({ id: src, depth: depth + 1 });
            }
          });
        }
      }
    });
  }

  getImpactStats(nodeId: NodeId): { d1: number; d2: number; d3: number; total: number } | null {
    const sourceNode = this.cy.getElementById(nodeId);
    if (sourceNode.empty()) return null;

    const visited = new Map<string, number>();
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
    let head = 0;
    let d1 = 0, d2 = 0, d3 = 0;

    while (head < queue.length) {
      const { id, depth } = queue[head++]!;
      if (visited.has(id) && visited.get(id)! <= depth) continue;
      visited.set(id, depth);

      if (depth > 0) {
        if (depth <= 1) d1++;
        else if (depth === 2) d2++;
        else d3++;
      }

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

    return { d1, d2, d3, total: d1 + d2 + d3 };
  }

  highlightInheritance(nodeId: NodeId | null): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('inheritance-highlight inheritance-dim inheritance-focus inheritance-extend inheritance-implement');
      if (!nodeId) {
        this.cy.edges('[type="extend"]').addClass('inheritance-extend');
        this.cy.edges('[type="implement"]').addClass('inheritance-implement');
        this.cy.edges('[type!="extend"][type!="implement"]').addClass('inheritance-dim');
        this.cy.nodes('[type!="class"][type!="interface"]').addClass('inheritance-dim');
        return;
      }

      const focusNode = this.cy.getElementById(nodeId);
      if (focusNode.empty()) return;
      focusNode.addClass('inheritance-focus');

      const relevant = new Set<string>([nodeId]);
      const traverse = (id: string, direction: 'up' | 'down') => {
        const node = this.cy.getElementById(id);
        if (direction === 'up') {
          node.outgoers('edge[type="extend"], edge[type="implement"]').forEach((edge) => {
            const target = edge.target().id();
            if (!relevant.has(target)) {
              relevant.add(target);
              edge.addClass('inheritance-highlight');
              traverse(target, 'up');
            }
          });
        } else {
          node.incomers('edge[type="extend"], edge[type="implement"]').forEach((edge) => {
            const source = edge.source().id();
            if (!relevant.has(source)) {
              relevant.add(source);
              edge.addClass('inheritance-highlight');
              traverse(source, 'down');
            }
          });
        }
      };
      traverse(nodeId, 'up');
      traverse(nodeId, 'down');

      relevant.forEach((id) => {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.addClass('inheritance-highlight');
      });

      this.cy.edges('[type="extend"], edge[type="implement"]').forEach((edge) => {
        if (!relevant.has(edge.source().id()) && !relevant.has(edge.target().id())) {
          edge.addClass('inheritance-dim');
        }
      });
      this.cy.edges('[type!="extend"][type!="implement"]').addClass('inheritance-dim');
      this.cy.nodes().forEach((node) => {
        if (!relevant.has(node.id())) node.addClass('inheritance-dim');
      });
    });
  }
}