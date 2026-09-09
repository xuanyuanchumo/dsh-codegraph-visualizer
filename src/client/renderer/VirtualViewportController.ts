import type { Core } from 'cytoscape';
import { SpatialIndex } from './SpatialIndex.ts';

const VIRTUAL_SCROLL_THRESHOLD = 2000;

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

    const padding = 100;
    const viewBounds = {
      x1: -pan.x / zoom - padding,
      y1: -pan.y / zoom - padding,
      x2: (-pan.x + width) / zoom + padding,
      y2: (-pan.y + height) / zoom + padding,
    };

    const candidateIds = this.spatialIndex.query(viewBounds);
    const newVisible = new Set<string>();

    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        if (node.data('typeFiltered') === true) {
          node.style('display', 'none');
          return;
        }
        const id = node.id();
        if (candidateIds.has(id)) {
          const p = node.position();
          const isVisible =
            p.x >= viewBounds.x1 &&
            p.x <= viewBounds.x2 &&
            p.y >= viewBounds.y1 &&
            p.y <= viewBounds.y2;
          if (isVisible) {
            newVisible.add(id);
            node.style('display', 'element');
          } else {
            node.style('display', 'none');
          }
        } else {
          node.style('display', 'none');
        }
      });

      this.cy.edges().forEach((edge) => {
        if (edge.data('typeFiltered') === true) {
          edge.style('display', 'none');
          return;
        }
        const sourceVisible = newVisible.has(edge.source().id());
        const targetVisible = newVisible.has(edge.target().id());
        edge.style('display', sourceVisible && targetVisible ? 'element' : 'none');
      });
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
