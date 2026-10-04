import type { Core } from 'cytoscape';
import type { RendererCallbacks } from './IRenderer.ts';

export type InteractionCallbacks = RendererCallbacks;

export class InteractionController {
  private cy: Core;
  private callbacks: InteractionCallbacks;

  constructor(cy: Core, callbacks: InteractionCallbacks) {
    this.cy = cy;
    this.callbacks = callbacks;
    this.bindEvents();
  }

  /**
   * Cytoscape 的 `renderedPosition()` / `renderedMidpoint()` 返回的是相对画布容器的
   * 坐标，而消费方（右键菜单、悬浮提示）使用 `position: fixed` 贴视口，
   * 因此这里叠加容器在视口中的原点，换算成视口坐标。
   * 无头测试或容器不可测时回退为原坐标。
   */
  private toViewport(pos: { x: number; y: number }): { x: number; y: number } {
    const rect = this.cy.container?.()?.getBoundingClientRect?.();
    if (!rect) return pos;
    return { x: pos.x + rect.left, y: pos.y + rect.top };
  }

  private bindEvents(): void {
    this.cy.on('tap', 'node', (evt) => {
      this.callbacks.onNodeTap?.(evt.target.id());
    });
    this.cy.on('tap', 'edge', (evt) => {
      const edge = evt.target;
      const pos = this.toViewport(edge.renderedMidpoint());
      this.callbacks.onEdgeTap?.(edge.id(), { x: pos.x, y: pos.y });
    });
    this.cy.on('dbltap', 'node', (evt) => {
      this.callbacks.onNodeDoubleTap?.(evt.target.id());
    });
    this.cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      node.addClass('hovered');
      const pos = this.toViewport(node.renderedPosition());
      this.callbacks.onNodeHover?.(node.id(), { x: pos.x, y: pos.y });
      this.callbacks.onNodeHoverPrefetch?.(node.id());
    });
    this.cy.on('mouseout', 'node', (evt) => {
      evt.target.removeClass('hovered');
      this.callbacks.onNodeHoverOut?.();
    });
    this.cy.on('mouseover', 'edge', (evt) => {
      const edge = evt.target;
      edge.addClass('hovered');
      const pos = this.toViewport(edge.renderedMidpoint());
      this.callbacks.onEdgeHover?.(edge.id(), { x: pos.x, y: pos.y });
    });
    this.cy.on('mouseout', 'edge', (evt) => {
      evt.target.removeClass('hovered');
      this.callbacks.onEdgeHoverOut?.();
    });
    this.cy.on('cxttap', 'node', (evt) => {
      const node = evt.target;
      const pos = this.toViewport(node.renderedPosition());
      this.callbacks.onNodeContextTap?.(node.id(), { x: pos.x, y: pos.y });
    });
  }

  updateCallbacks(callbacks: InteractionCallbacks): void {
    this.callbacks = callbacks;
  }

  destroy(): void {
    this.cy.nodes().removeClass('hovered');
    this.cy.edges().removeClass('hovered');
    this.cy.off('tap', 'node');
    this.cy.off('tap', 'edge');
    this.cy.off('dbltap', 'node');
    this.cy.off('mouseover', 'node');
    this.cy.off('mouseout', 'node');
    this.cy.off('mouseover', 'edge');
    this.cy.off('mouseout', 'edge');
    this.cy.off('cxttap', 'node');
  }
}