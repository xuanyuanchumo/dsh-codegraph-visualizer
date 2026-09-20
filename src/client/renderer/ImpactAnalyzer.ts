import type { Core } from 'cytoscape';
import { NodeId } from '../../types/index.ts';
import { HIGHLIGHT } from '../../shared/constants.ts';

export class ImpactAnalyzer {
  private cy: Core;

  constructor(cy: Core) {
    this.cy = cy;
  }

  computeImpact(nodeId: NodeId, maxDepth: number = HIGHLIGHT.IMPACT_MAX_DEPTH): Map<string, number> {
    const visited = new Map<string, number>();
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
    let head = 0;

    while (head < queue.length) {
      const { id, depth } = queue[head++]!;
      if (visited.has(id) && visited.get(id)! <= depth) continue;
      visited.set(id, depth);

      if (depth < maxDepth) {
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

  destroy(): void {
    this.cy.batch(() => {
      this.cy.elements().removeClass('impact-d1 impact-d2 impact-d3 impact-source');
    });
  }
}