import type { Core } from 'cytoscape';
import { SpatialIndex } from './SpatialIndex.ts';
import { VIRTUAL_VIEWPORT } from '../../shared/constants.ts';

const VIRTUAL_SCROLL_THRESHOLD = VIRTUAL_VIEWPORT.SCROLL_THRESHOLD;

export class VirtualViewportController {
  private cy: Core;
  private enabled = false;
  private rafId: number | null = null;
  private visibleNodeIds: Set<string> = new Set();
  private spatialIndex: SpatialIndex;
  private indexDirty = true;

  constructor(cy: Core) {
    this.cy = cy;
    this.spatialIndex = new SpatialIndex(cy);
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
      this.cy.nodes().forEach((n) => { n.style('display', 'element'); });
      this.cy.edges().forEach((e) => { e.style('display', 'element'); });
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
    const viewBounds = {
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
      for (const id of changedNodeIds) {
        const node = this.cy.getElementById(id);
        if (node.empty()) continue;
        node.connectedEdges().forEach((edge) => {
          if (edge.data('typeFiltered') === true) {
            edge.style('display', 'none');
            return;
          }
          const sourceVisible = newVisible.has(edge.source().id());
          const targetVisible = newVisible.has(edge.target().id());
          edge.style('display', sourceVisible && targetVisible ? 'element' : 'none');
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
