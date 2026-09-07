import type { Core } from 'cytoscape';

export interface InteractionCallbacks {
  onNodeTap?(nodeId: string): void;
  onEdgeTap?(edgeId: string): void;
  onNodeDoubleTap?(nodeId: string): void;
  onNodeHover?(nodeId: string, renderedPosition: { x: number; y: number }): void;
  onNodeHoverOut?(): void;
  onEdgeHover?(edgeId: string, renderedPosition: { x: number; y: number }): void;
  onEdgeHoverOut?(): void;
}

export class InteractionController {
  private cy: Core;
  private callbacks: InteractionCallbacks;

  constructor(cy: Core, callbacks: InteractionCallbacks) {
    this.cy = cy;
    this.callbacks = callbacks;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.cy.on('tap', 'node', (evt) => {
      this.callbacks.onNodeTap?.(evt.target.id());
    });
    this.cy.on('tap', 'edge', (evt) => {
      this.callbacks.onEdgeTap?.(evt.target.id());
    });
    this.cy.on('dbltap', 'node', (evt) => {
      this.callbacks.onNodeDoubleTap?.(evt.target.id());
    });
    this.cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      node.addClass('hovered');
      const pos = node.renderedPosition();
      this.callbacks.onNodeHover?.(node.id(), { x: pos.x, y: pos.y });
    });
    this.cy.on('mouseout', 'node', (evt) => {
      evt.target.removeClass('hovered');
      this.callbacks.onNodeHoverOut?.();
    });
    this.cy.on('mouseover', 'edge', (evt) => {
      const edge = evt.target;
      edge.addClass('hovered');
      const pos = edge.renderedMidpoint();
      this.callbacks.onEdgeHover?.(edge.id(), { x: pos.x, y: pos.y });
    });
    this.cy.on('mouseout', 'edge', (evt) => {
      evt.target.removeClass('hovered');
      this.callbacks.onEdgeHoverOut?.();
    });
  }

  updateCallbacks(callbacks: InteractionCallbacks): void {
    this.callbacks = callbacks;
  }

  destroy(): void {
    this.cy.off('tap', 'node');
    this.cy.off('tap', 'edge');
    this.cy.off('dbltap', 'node');
    this.cy.off('mouseover', 'node');
    this.cy.off('mouseout', 'node');
    this.cy.off('mouseover', 'edge');
    this.cy.off('mouseout', 'edge');
  }
}