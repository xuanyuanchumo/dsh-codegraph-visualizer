import type { Core } from 'cytoscape';
import { QuadTree } from './QuadTree.ts';
import { VIRTUAL_VIEWPORT } from '../../shared/constants.ts';

const VIRTUAL_SCROLL_THRESHOLD = VIRTUAL_VIEWPORT.SCROLL_THRESHOLD;

interface ViewBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function edgeIntersectsViewport(
  sourcePos: { x: number; y: number },
  targetPos: { x: number; y: number },
  bounds: ViewBounds,
): boolean {
  if (sourcePos.x >= bounds.x1 && sourcePos.x <= bounds.x2 &&
      sourcePos.y >= bounds.y1 && sourcePos.y <= bounds.y2) return true;
  if (targetPos.x >= bounds.x1 && targetPos.x <= bounds.x2 &&
      targetPos.y >= bounds.y1 && targetPos.y <= bounds.y2) return true;
  const dx = targetPos.x - sourcePos.x;
  const dy = targetPos.y - sourcePos.y;
  if (dx === 0 && dy === 0) return false;
  const t1 = (bounds.x1 - sourcePos.x) / (dx || 1e-9);
  const t2 = (bounds.x2 - sourcePos.x) / (dx || 1e-9);
  const t3 = (bounds.y1 - sourcePos.y) / (dy || 1e-9);
  const t4 = (bounds.y2 - sourcePos.y) / (dy || 1e-9);
  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
  return tmax >= 0 && tmin <= 1 && tmin <= tmax;
}

export class VirtualViewportController {
  private cy: Core;
  private enabled = false;
  private rafId: number | null = null;
  private visibleNodeIds: Set<string> = new Set();
  private spatialIndex: QuadTree;
  private indexDirty = true;

  constructor(cy: Core) {
    this.cy = cy;
    this.spatialIndex = new QuadTree(cy);
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.rebuildIndex();
    this.updateVisibility();
    this.cy.on('viewport', this.handleViewportChange);
    this.cy.on('add remove', this.handleStructureChange);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.cy.off('viewport', this.handleViewportChange);
    this.cy.off('add remove', this.handleStructureChange);
    this.cy.batch(() => {
      this.cy.nodes().forEach((n) => {
        if (n.data('typeFiltered') === true || n.data('connectionFiltered') === true) {
          n.style('display', 'none');
        } else {
          n.style('display', 'element');
        }
      });
      this.cy.edges().forEach((e) => {
        if (e.data('typeFiltered') === true || e.data('connectionFiltered') === true) {
          e.style('display', 'none');
        } else {
          e.style('display', 'element');
        }
      });
    });
    this.visibleNodeIds.clear();
    this.spatialIndex.clear();
    this.indexDirty = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  shouldEnable(nodeCount: number): boolean {
    return nodeCount > VIRTUAL_SCROLL_THRESHOLD;
  }

  private handleStructureChange = (): void => {
    this.indexDirty = true;
  };

  private rebuildIndex(): void {
    if (!this.indexDirty) return;
    this.spatialIndex.rebuildFromCytoscape();
    this.indexDirty = false;
  }

  private handleViewportChange = (): void => {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.updateVisibility();
      this.rafId = null;
    });
  };

  private updateVisibility(): void {
    if (!this.enabled) return;

    if (this.indexDirty) {
      this.rebuildIndex();
    }

    const zoom = this.cy.zoom();
    const pan = this.cy.pan();
    const width = this.cy.width();
    const height = this.cy.height();

    const padding = VIRTUAL_VIEWPORT.PADDING;
    const viewBounds: ViewBounds = {
      x1: -pan.x / zoom - padding,
      y1: -pan.y / zoom - padding,
      x2: (-pan.x + width) / zoom + padding,
      y2: (-pan.y + height) / zoom + padding,
    };

    const candidateIds = this.spatialIndex.query(viewBounds);
    const newVisible = new Set<string>();
    const toShow: string[] = [];
    const toHide: string[] = [];

    for (const id of candidateIds) {
      const node = this.cy.getElementById(id);
      if (node.nonempty() === false) continue;
      if (node.data('typeFiltered') === true) continue;
      if (node.data('connectionFiltered') === true) continue;
      const p = node.position();
      const isVisible =
        p.x >= viewBounds.x1 &&
        p.x <= viewBounds.x2 &&
        p.y >= viewBounds.y1 &&
        p.y <= viewBounds.y2;
      if (isVisible) {
        newVisible.add(id);
        if (!this.visibleNodeIds.has(id)) toShow.push(id);
      } else {
        if (this.visibleNodeIds.has(id)) toHide.push(id);
      }
    }

    for (const id of this.visibleNodeIds) {
      if (!newVisible.has(id)) toHide.push(id);
    }

    if (toShow.length === 0 && toHide.length === 0) {
      this.visibleNodeIds = newVisible;
      return;
    }

    this.cy.batch(() => {
      for (const id of toShow) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.style('display', 'element');
      }
      for (const id of toHide) {
        const node = this.cy.getElementById(id);
        if (node.nonempty()) node.style('display', 'none');
      }

      const changedNodeIds = new Set<string>([...toShow, ...toHide]);
      const processedEdgeIds = new Set<string>();
      for (const id of changedNodeIds) {
        const node = this.cy.getElementById(id);
        if (node.empty()) continue;
        node.connectedEdges().forEach((edge) => {
          if (processedEdgeIds.has(edge.id())) return;
          processedEdgeIds.add(edge.id());
          if (edge.data('typeFiltered') === true) {
            edge.style('display', 'none');
            return;
          }
          if (edge.data('connectionFiltered') === true) {
            edge.style('display', 'none');
            return;
          }
          const sourceVisible = newVisible.has(edge.source().id());
          const targetVisible = newVisible.has(edge.target().id());
          if (sourceVisible && targetVisible) {
            edge.style('display', 'element');
          } else if (sourceVisible || targetVisible) {
            const sp = edge.source().position();
            const tp = edge.target().position();
            if (edgeIntersectsViewport(sp, tp, viewBounds)) {
              edge.style('display', 'element');
            } else {
              edge.style('display', 'none');
            }
          } else {
            edge.style('display', 'none');
          }
        });
      }

      for (const id of toHide) {
        const node = this.cy.getElementById(id);
        if (node.empty()) continue;
        node.connectedEdges().forEach((edge) => {
          if (processedEdgeIds.has(edge.id())) return;
          const sourceVisible = newVisible.has(edge.source().id());
          const targetVisible = newVisible.has(edge.target().id());
          if (!sourceVisible && !targetVisible) {
            edge.style('display', 'none');
          }
        });
      }
    });

    this.visibleNodeIds = newVisible;
  }

  getVisibleNodeCount(): number {
    return this.visibleNodeIds.size;
  }

  destroy(): void {
    this.disable();
  }
}
