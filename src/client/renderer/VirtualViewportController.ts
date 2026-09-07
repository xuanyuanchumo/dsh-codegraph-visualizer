import type { Core } from 'cytoscape';

const VIRTUAL_SCROLL_THRESHOLD = 2000;


export class VirtualViewportController {
  private cy: Core;
  private enabled = false;
  private rafId: number | null = null;
  private visibleNodeIds: Set<string> = new Set();


  constructor(cy: Core) {
    this.cy = cy;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.updateVisibility();
    this.cy.on('viewport', this.handleViewportChange);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.cy.off('viewport', this.handleViewportChange);
    this.cy.batch(() => {
      this.cy.nodes().forEach((n) => { n.style('display', 'element'); });
      this.cy.edges().forEach((e) => { e.style('display', 'element'); });
    });
    this.visibleNodeIds.clear();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  shouldEnable(nodeCount: number): boolean {
    return nodeCount > VIRTUAL_SCROLL_THRESHOLD;
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

    const zoom = this.cy.zoom();
    const pan = this.cy.pan();
    const width = this.cy.width();
    const height = this.cy.height();

    const viewBounds = {
      x1: -pan.x / zoom,
      y1: -pan.y / zoom,
      x2: (-pan.x + width) / zoom,
      y2: (-pan.y + height) / zoom,
    };

    const newVisible = new Set<string>();
    const padding = 100;

    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        const p = node.position();
        const isVisible =
          p.x >= viewBounds.x1 - padding &&
          p.x <= viewBounds.x2 + padding &&
          p.y >= viewBounds.y1 - padding &&
          p.y <= viewBounds.y2 + padding;

        if (isVisible) {
          newVisible.add(node.id());
          node.style('display', 'element');
        } else {
          node.style('display', 'none');
        }
      });

      this.cy.edges().forEach((edge) => {
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