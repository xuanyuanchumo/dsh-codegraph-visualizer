import type { Core, LayoutOptions } from 'cytoscape';
import type { LayoutType } from './IRenderer.ts';

export class LayoutController {
  private cy: Core;
  private layoutRaf: number | null = null;

  constructor(cy: Core) {
    this.cy = cy;
  }

  applyLayout(layout: LayoutType): void {
    if (this.layoutRaf !== null) cancelAnimationFrame(this.layoutRaf);

    this.layoutRaf = requestAnimationFrame(() => {
      const nodeCount = this.cy.nodes().length;
      let effectiveLayout = layout;
      let animate = true;

      if (nodeCount > 2000) {
        effectiveLayout = 'grid';
        animate = false;
      } else if (nodeCount > 500 && layout === 'cose') {
        effectiveLayout = 'dagre';
        animate = false;
      }

      const options = this.buildLayoutOptions(effectiveLayout, animate, nodeCount);
      if (options) {
        const l = this.cy.layout(options);
        l.one('layoutstop', () => this.removeOverlaps());
        l.run();
      }
      this.layoutRaf = null;
    });
  }

  private buildLayoutOptions(layout: LayoutType, animate: boolean, nodeCount: number): LayoutOptions | undefined {
    switch (layout) {
      case 'cose':
        return {
          name: 'cose', fit: true, animate: false,
          nodeRepulse: () => 120000, idealEdgeLength: () => 400,
          edgeElasticity: () => 0.05, gravity: 0.02, numIter: 15000,
          randomize: true, tile: true, padding: 120, avoidOverlap: true,
        } as LayoutOptions;
      case 'dagre':
        return {
          name: 'dagre', fit: true, animate, rankDir: 'TB',
          rankSep: 300, edgeSep: 120, nodeSep: 250,
          ranker: 'tight-tree', padding: 100,
        } as LayoutOptions;
      case 'circle':
        return {
          name: 'circle', fit: true, animate, padding: 80,
          radius: () => Math.min(this.cy.width(), this.cy.height()) / 2 - 120,
        } as LayoutOptions;
      case 'grid':
        return {
          name: 'grid', fit: true, animate: false, padding: 80,
          avoidOverlap: true,
          rows: Math.ceil(Math.sqrt(nodeCount)),
          cols: Math.ceil(Math.sqrt(nodeCount)),
        } as LayoutOptions;
      case 'radial':
        return {
          name: 'concentric', fit: true, animate,
          padding: 80, minNodeSpacing: 40,
          concentric: (n: { degree: () => number }) => n.degree(),
          levelWidth: () => 2,
        } as LayoutOptions;
      case 'tree':
        return {
          name: 'breadthfirst', fit: true, animate,
          padding: 80, directed: true, spacingFactor: 1.2,
          roots: undefined, maximalAdjustments: 2,
        } as LayoutOptions;
      default: {
        const _exhaustive: never = layout;
        throw new Error(`Unhandled layout: ${_exhaustive}`);
      }
    }
  }

  private removeOverlaps(): void {
    const nodes = this.cy.nodes();
    if (nodes.length === 0) return;

    const minGap = 40;
    const maxIterations = 20;
    const skipThreshold = 2000;

    if (nodes.length > skipThreshold) {
      this.cy.fit(undefined, 80);
      return;
    }

    const bbox = this.cy.nodes().boundingBox();
    const cx = (bbox.x1 + bbox.x2) / 2;
    const cy = (bbox.y1 + bbox.y2) / 2;
    const scaleFactor = 1.4;
    this.cy.batch(() => {
      nodes.forEach((n) => {
        const p = n.position();
        n.position({ x: cx + (p.x - cx) * scaleFactor, y: cy + (p.y - cy) * scaleFactor });
      });
    });

    const cellSize = minGap * 4;
    for (let iter = 0; iter < maxIterations; iter++) {
      const positions: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
      nodes.forEach((n) => {
        const p = n.position();
        positions.push({ id: n.id(), x: p.x, y: p.y, w: n.width(), h: n.height() });
      });

      const grid = new Map<string, number[]>();
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i]!;
        const gx = Math.floor(p.x / cellSize);
        const gy = Math.floor(p.y / cellSize);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const key = `${gx + dx},${gy + dy}`;
            let bucket = grid.get(key);
            if (!bucket) { bucket = []; grid.set(key, bucket); }
            bucket.push(i);
          }
        }
      }

      const displacements = new Map<string, { dx: number; dy: number }>();
      let overlapCount = 0;
      const checked = new Set<string>();

      for (const [, bucket] of grid) {
        for (let i = 0; i < bucket.length; i++) {
          for (let j = i + 1; j < bucket.length; j++) {
            const ai = bucket[i]!;
            const bi = bucket[j]!;
            const pairKey = ai < bi ? `${ai}-${bi}` : `${bi}-${ai}`;
            if (checked.has(pairKey)) continue;
            checked.add(pairKey);
            const a = positions[ai]!;
            const b = positions[bi]!;
            const ddx = b.x - a.x;
            const ddy = b.y - a.y;
            const minDx = (a.w + b.w) / 2 + minGap;
            const minDy = (a.h + b.h) / 2 + minGap;
            const absDx = Math.abs(ddx);
            const absDy = Math.abs(ddy);
            if (absDx < minDx && absDy < minDy) {
              overlapCount++;
              const overlapX = minDx - absDx;
              const overlapY = minDy - absDy;
              const pushX = overlapX / 2 + 3;
              const pushY = overlapY / 2 + 3;
              const signX = ddx >= 0 ? 1 : -1;
              const signY = ddy >= 0 ? 1 : -1;
              let da = displacements.get(a.id);
              if (!da) { da = { dx: 0, dy: 0 }; displacements.set(a.id, da); }
              let db = displacements.get(b.id);
              if (!db) { db = { dx: 0, dy: 0 }; displacements.set(b.id, db); }
              da.dx -= signX * pushX;
              da.dy -= signY * pushY;
              db.dx += signX * pushX;
              db.dy += signY * pushY;
            }
          }
        }
      }

      if (overlapCount === 0) break;

      this.cy.batch(() => {
        for (const [id, d] of displacements) {
          const node = this.cy.getElementById(id);
          if (node.nonempty()) {
            const p = node.position();
            node.position({ x: p.x + d.dx, y: p.y + d.dy });
          }
        }
      });
    }

    this.cy.fit(undefined, 80);
  }

  destroy(): void {
    if (this.layoutRaf !== null) cancelAnimationFrame(this.layoutRaf);
    this.layoutRaf = null;
  }
}