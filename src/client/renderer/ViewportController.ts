import type { Core } from 'cytoscape';
import type { NodeId } from '../../types/index.ts';
import { RENDERER } from '../../shared/constants.ts';

export class ViewportController {
  private cy: Core;

  constructor(cy: Core) {
    this.cy = cy;
  }

  focusOnNode(nodeId: string): void {
    const node = this.cy.getElementById(nodeId);
    if (node.nonempty()) {
      this.cy.animate({
        center: { eles: node },
        zoom: Math.max(this.cy.zoom(), 1.2),
        duration: RENDERER.FOCUS_NODE_ANIMATION_MS,
      });
    }
  }

  private dimmedNodeIds: Set<string> = new Set();

  focusNeighborhood(nodeId: NodeId | null): void {
    this.cy.batch(() => {
      for (const id of this.dimmedNodeIds) {
        const el = this.cy.getElementById(id);
        if (el.nonempty()) el.removeClass('focus-dim');
      }
      this.dimmedNodeIds.clear();

      this.cy.elements().removeClass('focus-highlight');
      if (!nodeId) return;

      const focusNode = this.cy.getElementById(nodeId);
      if (focusNode.empty()) return;

      const relevant = new Set<string>([nodeId]);
      focusNode.neighborhood().forEach((el) => {
        if (el.isNode()) relevant.add(el.id());
      });

      relevant.forEach((id) => {
        const el = this.cy.getElementById(id);
        if (el.nonempty()) el.addClass('focus-highlight');
      });

      this.cy.nodes(':visible').forEach((node) => {
        if (!relevant.has(node.id())) {
          node.addClass('focus-dim');
          this.dimmedNodeIds.add(node.id());
        }
      });

      this.cy.animate({
        fit: { eles: this.cy.elements().filter((el) => relevant.has(el.id())), padding: RENDERER.FIT_PADDING },
        duration: RENDERER.NEIGHBORHOOD_ANIMATION_MS,
      });
    });
  }

  expandNeighborhood(nodeId: NodeId, depth: number): Set<string> {
    const relevant = new Set<string>([nodeId]);
    let frontier = new Set<string>([nodeId]);

    for (let d = 0; d < depth; d++) {
      const nextFrontier = new Set<string>();
      for (const id of frontier) {
        const node = this.cy.getElementById(id);
        if (node.empty()) continue;
        node.neighborhood().forEach((el) => {
          if (el.isNode() && !relevant.has(el.id())) {
            relevant.add(el.id());
            nextFrontier.add(el.id());
          }
        });
      }
      frontier = nextFrontier;
      if (frontier.size === 0) break;
    }

    this.cy.batch(() => {
      for (const id of this.dimmedNodeIds) {
        const el = this.cy.getElementById(id);
        if (el.nonempty()) el.removeClass('focus-dim');
      }
      this.dimmedNodeIds.clear();
      this.cy.elements().removeClass('focus-highlight');
      relevant.forEach((id) => {
        const el = this.cy.getElementById(id);
        if (el.nonempty()) el.addClass('focus-highlight');
      });
      this.cy.nodes(':visible').forEach((node) => {
        if (!relevant.has(node.id())) {
          node.addClass('focus-dim');
          this.dimmedNodeIds.add(node.id());
        }
      });
      this.cy.animate({
        fit: { eles: this.cy.elements().filter((el) => relevant.has(el.id())), padding: RENDERER.FIT_PADDING },
        duration: RENDERER.NEIGHBORHOOD_ANIMATION_MS,
      });
    });

    return relevant;
  }

  getThumbnail(): string | null {
    return this.cy.png({ full: true, scale: 0.15, bg: 'transparent' });
  }

  getViewportInfo(): { zoom: number; pan: { x: number; y: number }; renderedSize: { w: number; h: number }; totalSize: { w: number; h: number } } | null {
    const zoom = this.cy.zoom();
    const pan = this.cy.pan();
    const renderedSize = { w: this.cy.width(), h: this.cy.height() };
    const bounds = this.cy.elements().boundingBox();
    const totalSize = { w: bounds.w, h: bounds.h };
    return { zoom, pan, renderedSize, totalSize };
  }

  focusOnArea(x: number, y: number, zoom: number): void {
    this.cy.zoom(zoom);
    this.cy.panBy({
      x: -x * zoom + this.cy.width() / 2,
      y: -y * zoom + this.cy.height() / 2,
    });
  }

  resize(): void {
    this.cy.resize();
  }

  private focusModeActive = false;
  private focusModeHiddenNodes: Set<string> = new Set();
  private focusModeHiddenEdges: Set<string> = new Set();

  setFocusMode(nodeId: NodeId | null, depth: number): void {
    this.clearFocusMode();

    if (!nodeId) {
      this.focusModeActive = false;
      return;
    }

    this.focusModeActive = true;
    const visibleIds = this.expandNeighborhood(nodeId, depth);

    this.cy.batch(() => {
      this.cy.nodes().forEach((node) => {
        if (!visibleIds.has(node.id())) {
          const typeFiltered = node.data('typeFiltered') === true;
          const connectionFiltered = node.data('connectionFiltered') === true;
          if (!typeFiltered && !connectionFiltered) {
            node.style('display', 'none');
            this.focusModeHiddenNodes.add(node.id());
          }
        }
      });

      this.cy.edges().forEach((edge) => {
        const s = edge.source().id();
        const t = edge.target().id();
        if (!visibleIds.has(s) || !visibleIds.has(t)) {
          const typeFiltered = edge.data('typeFiltered') === true;
          const connectionFiltered = edge.data('connectionFiltered') === true;
          if (!typeFiltered && !connectionFiltered) {
            edge.style('display', 'none');
            this.focusModeHiddenEdges.add(edge.id());
          }
        }
      });
    });
  }

  clearFocusMode(): void {
    if (!this.focusModeActive) return;

    this.cy.batch(() => {
      for (const id of this.focusModeHiddenNodes) {
        const el = this.cy.getElementById(id);
        if (el.nonempty()) {
          const typeFiltered = el.data('typeFiltered') === true;
          const connectionFiltered = el.data('connectionFiltered') === true;
          if (!typeFiltered && !connectionFiltered) {
            el.style('display', 'element');
          }
        }
      }
      for (const id of this.focusModeHiddenEdges) {
        const el = this.cy.getElementById(id);
        if (el.nonempty()) {
          const typeFiltered = el.data('typeFiltered') === true;
          const connectionFiltered = el.data('connectionFiltered') === true;
          if (!typeFiltered && !connectionFiltered) {
            el.style('display', 'element');
          }
        }
      }
    });

    this.focusModeHiddenNodes.clear();
    this.focusModeHiddenEdges.clear();
    this.focusModeActive = false;
  }

  isFocusModeActive(): boolean {
    return this.focusModeActive;
  }

  destroy(): void {
    this.cy.batch(() => {
      for (const id of this.dimmedNodeIds) {
        const el = this.cy.getElementById(id);
        if (el.nonempty()) el.removeClass('focus-dim');
      }
      this.dimmedNodeIds.clear();
      this.cy.elements().removeClass('focus-highlight');
    });
    this.focusModeHiddenNodes.clear();
    this.focusModeHiddenEdges.clear();
    this.focusModeActive = false;
  }
}