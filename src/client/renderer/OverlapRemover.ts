import type { Core } from 'cytoscape';
import { computeSmartSpacing } from '../../shared/layoutUtils.ts';
import { LAYOUT as LAYOUT_CONST, RENDERER } from '../../shared/constants.ts';

export class OverlapRemover {
  private cy: Core;

  constructor(cy: Core) {
    this.cy = cy;
  }

  remove(): void {
    const nodes = this.cy.nodes();
    if (nodes.length === 0) return;

    const w = this.cy.width() || RENDERER.DEFAULT_CONTAINER_WIDTH;
    const h = this.cy.height() || RENDERER.DEFAULT_CONTAINER_HEIGHT;
    const sp = computeSmartSpacing(nodes.length, w, h);
    const minGap = sp.minGap;
    const maxIterations = LAYOUT_CONST.OVERLAP_MAX_ITERATIONS;
    const skipThreshold = LAYOUT_CONST.OVERLAP_SKIP_THRESHOLD;

    if (nodes.length > skipThreshold) {
      this.cy.fit(undefined, RENDERER.FIT_PADDING);
      return;
    }

    const cellSize = minGap * LAYOUT_CONST.OVERLAP_CELL_SIZE_MULTIPLIER;
    let lastOverlapCount = Infinity;
    let noImprovementCount = 0;

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
              const pushX = overlapX / 2 + Math.max(LAYOUT_CONST.OVERLAP_MIN_PUSH, overlapX * LAYOUT_CONST.OVERLAP_PUSH_COEFFICIENT);
              const pushY = overlapY / 2 + Math.max(LAYOUT_CONST.OVERLAP_MIN_PUSH, overlapY * LAYOUT_CONST.OVERLAP_PUSH_COEFFICIENT);
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
      if (overlapCount >= lastOverlapCount) {
        noImprovementCount++;
        if (noImprovementCount >= 3) break;
      } else {
        noImprovementCount = 0;
      }
      lastOverlapCount = overlapCount;

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

    this.cy.fit(undefined, RENDERER.FIT_PADDING);
  }
}