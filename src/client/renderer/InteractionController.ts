import type { Core, NodeSingular } from 'cytoscape';
import type { RendererCallbacks } from './IRenderer.ts';

/**
 * 画布级交互回调。
 *
 * 基座是 `RendererCallbacks`（IRenderer 里声明的渲染器回调）；这里用交叉类型
 * 追加**画布键盘导航 / 多选**一族可选回调。之所以放在本文件而不是 `IRenderer.ts`：
 * cycle-141 D 的写范围限定在本文件，新增成员全部可选，因此 `CytoscapeRenderer`
 * 构造时传的旧对象字面量仍然合法（缺省即不启用）。
 *
 * @module client/renderer/InteractionController
 */
export type InteractionCallbacks = RendererCallbacks & {
  /**
   * Shift+点击切换多选。`selected=true` 表示本次把该节点加入多选集合。
   * `selectedIds` 是切换**之后**的完整多选集合（顺序稳定，便于父层快照）。
   */
  onSelectionToggle?(nodeId: string, selected: boolean, selectedIds: readonly string[]): void;
  /**
   * 多选集合被**静默清空**时通知父层（cycle-149）。普通点击 / Esc 会清空多选，
   * 此前这两个路径不携带任何回调——消费方（store 镜像）会留下过期集合，
   * BatchActionBar 显示幽灵计数而画布无高亮。
   */
  onSelectionClear?(): void;
  /** 画布键盘 Escape：清除键盘聚焦（不清空鼠标点击产生的选中）。 */
  onCanvasEscape?(): void;
  /** 键盘方向键把聚焦移动到相邻节点后通知父层（用于同步 aria / 详情面板）。 */
  onNodeFocus?(nodeId: string | null): void;
};

/** 画布键盘方向。 */
export type CanvasDir = 'up' | 'down' | 'left' | 'right';

/**
 * 画布交互控制器。
 *
 * 在既有的 hover / tap / dbltap / cxttap 之外，cycle-141 D 追加：
 *  1. 画布键盘导航：方向键聚焦相邻节点、Enter 选中、Esc 清除、+/- 缩放、F 适应窗口；
 *  2. Shift+点击多选：用独立的 `multi-selected` class 表达，不覆盖 `selected`；
 *  3. 键盘聚焦节点用 `canvas-focused` class 表达，鼠标点击的节点则记录为
 *     「最近聚焦起点」，让方向键可以在没有显式 Enter 的情况下起步。
 */
export class InteractionController {
  private cy: Core;
  private callbacks: InteractionCallbacks;
  private container: HTMLElement | null = null;
  /** 键盘聚焦的节点 id（Enter 之前的视觉焦点）。 */
  private focusNodeId: string | null = null;
  /** Shift+点击维护的多选集合。 */
  private multiSelectedIds: Set<string> = new Set();
  /** 画布键盘导航步长（与 GraphCanvasControls 的 ZOOM_STEP 保持一致）。 */
  private static readonly ZOOM_STEP = 1.3;

  constructor(cy: Core, callbacks: InteractionCallbacks) {
    this.cy = cy;
    this.callbacks = callbacks;
    this.bindEvents();
    this.bindCanvasEvents();
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

  /** 按 id 取节点；不存在或不是节点时返回 null。 */
  private nodeById(id: string): NodeSingular | null {
    const el = this.cy.getElementById(id);
    if (el.empty() || !el.isNode()) return null;
    return el;
  }

  private bindEvents(): void {
    this.cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const id = node.id();
      const additive = Boolean(evt.originalEvent?.shiftKey);
      if (additive) {
        // Shift+点击：切换多选集合，并同步渲染器之外的 `multi-selected` class。
        const selected = !this.multiSelectedIds.has(id);
        if (selected) this.multiSelectedIds.add(id);
        else this.multiSelectedIds.delete(id);
        node.toggleClass('multi-selected', selected);
        this.callbacks.onSelectionToggle?.(id, selected, [...this.multiSelectedIds]);
        // 仍按普通 tap 通知父层：父层的单选选中态以最后一次点击为准，
        // 多选集合由 `onSelectionToggle` 单独维护，两条通道互不覆盖。
        this.callbacks.onNodeTap?.(id);
      } else {
        // 普通点击清空多选集合，避免「点击 A 后 Shift+点击 B」残留 A 的高亮。
        this.clearMultiSelect();
        this.callbacks.onNodeTap?.(id);
      }
      // 记录为方向键导航的默认起点（画布未聚焦时也允许从最近点击的节点起步）。
      this.focusNodeId = id;
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

  /**
   * 绑定画布容器上的键盘 / 焦点事件。
   *
   * 只在容器可聚焦（GraphPanel 给 `.cg-graph-container` 加了 `tabIndex={0}`）时生效；
   * 无头测试的 mock 容器没有 `addEventListener`，这里提前返回。
   */
  private bindCanvasEvents(): void {
    const container = this.cy.container?.();
    if (!container || typeof container.addEventListener !== 'function') return;
    this.container = container;
    container.addEventListener('keydown', this.handleCanvasKeyDown);
  }

  private handleCanvasKeyDown = (e: KeyboardEvent): void => {
    // 只接管容器自身的按键：叠加层里的按钮 / 输入框获得焦点时不劫持方向键。
    if (e.target !== this.container) return;

    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        this.moveFocus(e.key);
        return;
      case 'Enter':
        e.preventDefault();
        this.selectFocusedNode();
        return;
      case 'Escape':
        e.preventDefault();
        this.clearFocus();
        this.callbacks.onCanvasEscape?.();
        return;
      case '+':
      case '=':
        e.preventDefault();
        this.zoomByCanvas(InteractionController.ZOOM_STEP);
        return;
      case '-':
      case '_':
        e.preventDefault();
        this.zoomByCanvas(1 / InteractionController.ZOOM_STEP);
        return;
      case 'f':
      case 'F':
        e.preventDefault();
        this.fitCanvas();
        return;
      default:
        return;
    }
  };

  /** 方向键把键盘焦点移动到相邻节点（图空间优先，退化为屏幕空间最近邻）。 */
  private moveFocus(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
    const dir: CanvasDir =
      key === 'ArrowUp' ? 'up' : key === 'ArrowDown' ? 'down' : key === 'ArrowLeft' ? 'left' : 'right';
    const current = this.resolveFocusNode();
    if (!current) return;

    const from = current.renderedPosition();
    const horizontal = dir === 'left' || dir === 'right';
    const sign = (dir === 'right' || dir === 'down') ? 1 : -1;

    // 首选图空间邻居：与当前节点有边相连的节点。
    const neighbors: NodeSingular[] = [];
    current.neighborhood().forEach((el) => {
      if (el.isNode() && el.id() !== current.id()) {
        neighbors.push(el);
      }
    });
    // 没有邻居时退化为屏幕空间：在所有可见节点里找方向上的最近点。
    const pool = neighbors.length > 0
      ? neighbors
      : this.cy.nodes(':visible').toArray().filter((n) => n.id() !== current.id());

    let best: NodeSingular | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const node of pool) {
      const pos = node.renderedPosition();
      const along = (horizontal ? pos.x - from.x : pos.y - from.y) * sign;
      if (along <= 0) continue; // 必须落在按下的方向上
      const perp = Math.abs(horizontal ? pos.y - from.y : pos.x - from.x);
      // 越正、越近越好：perp 惩罚、along 奖励。
      const score = perp - along * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = node;
      }
    }
    if (best) this.focusNode(best.id());
  }

  /** Enter：选中当前键盘聚焦的节点（等价于一次点击）。 */
  private selectFocusedNode(): void {
    if (!this.focusNodeId) return;
    this.callbacks.onNodeTap?.(this.focusNodeId);
  }

  /** 清除键盘聚焦（保留鼠标点击产生的选中）。 */
  private clearFocus(): void {
    if (this.focusNodeId) {
      const node = this.nodeById(this.focusNodeId);
      node?.removeClass('canvas-focused');
    }
    this.focusNodeId = null;
    this.callbacks.onNodeFocus?.(null);
  }

  /** 记录键盘聚焦节点并加 class。 */
  private focusNode(id: string): void {
    if (this.focusNodeId && this.focusNodeId !== id) {
      this.nodeById(this.focusNodeId)?.removeClass('canvas-focused');
    }
    this.focusNodeId = id;
    this.nodeById(id)?.addClass('canvas-focused');
    this.callbacks.onNodeFocus?.(id);
  }

  /** 键盘聚焦起点：显式焦点优先，其次当前 `selected` 节点，最后退化为视口中心最近节点。 */
  private resolveFocusNode(): NodeSingular | null {
    if (this.focusNodeId) {
      const node = this.nodeById(this.focusNodeId);
      if (node) return node;
    }
    const selected = this.cy.$('node.selected');
    if (selected.nonempty()) {
      const first = selected.first();
      if (first.isNode()) return first;
    }
    return this.centerNode();
  }

  /** 视口中心最近的可见节点——没有选中节点时给方向键一个合理的起点。 */
  private centerNode(): NodeSingular | null {
    const nodes = this.cy.nodes(':visible').toArray();
    if (nodes.length === 0) return null;
    let cx = 0;
    let cy = 0;
    for (const n of nodes) {
      const p = n.renderedPosition();
      cx += p.x;
      cy += p.y;
    }
    cx /= nodes.length;
    cy /= nodes.length;
    let best = nodes[0]!;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const n of nodes) {
      const p = n.renderedPosition();
      const dist = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    return best;
  }

  private zoomByCanvas(factor: number): void {
    const next = this.cy.zoom() * factor;
    this.cy.zoom(Math.min(20, Math.max(0.05, next)));
  }

  private fitCanvas(): void {
    this.cy.fit(undefined, 40);
  }

  updateCallbacks(callbacks: InteractionCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * 清空多选集合（cycle-149）：集合 + `multi-selected` class + 通知消费方一体完成。
   *
   * 两个触发方共用本方法（单一实现，防漂移）：普通点击的静默清空、
   * 批量操作条「清除」按钮经渲染器 `clearMultiSelect` 的显式清空。
   * `onSelectionClear` 让 store 镜像同步——缺了它消费方留下幽灵计数
   * （「画布无高亮但 BatchActionBar 还在」）。
   */
  clearMultiSelect(): void {
    if (this.multiSelectedIds.size === 0) return;
    this.multiSelectedIds.clear();
    // 单条 class 操作不值得 cy.batch（批处理是为多条样式变更减栈的）；
    // 这里保持与 cycle-141 原内联实现同形，也兼容以 spy 验证 removeClass 的既有测试。
    this.cy.nodes().removeClass('multi-selected');
    this.callbacks.onSelectionClear?.();
  }

  /**
   * 切换节点 / 边标签的可见性（cycle-141 / D）。
   *
   * 实现放在本控制器而不是 `StyleController`：标签显隐是**交互态**而非主题态，
   * 用户切来切去不该触发整份样式表重建。这里只覆盖 cytoscape 的 `text-opacity`
   * （节点与边的标签共用这一个属性，见 cytoscape `setupTextStyle`），
   * 渲染器侧把 `setLabelVisibility` 委托到这里即可，无需重建样式。
   *
   * @param visible `true` 显示标签，`false` 隐藏。
   */
  setLabelVisibility(visible: boolean): void {
    this.cy.batch(() => {
      this.cy.style().selector('node').style({ 'text-opacity': visible ? 1 : 0 });
      this.cy.style().selector('edge').style({ 'text-opacity': visible ? 1 : 0 });
      this.cy.style().update();
    });
  }

  destroy(): void {
    this.cy.nodes().removeClass('hovered');
    this.cy.edges().removeClass('hovered');
    this.cy.nodes().removeClass('canvas-focused');
    this.cy.nodes().removeClass('multi-selected');
    this.container?.removeEventListener('keydown', this.handleCanvasKeyDown);
    this.container = null;
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
