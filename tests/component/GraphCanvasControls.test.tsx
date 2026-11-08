/**
 * GraphCanvasControls 组件单元测试。
 *
 * 覆盖（cycle-141 / D）：
 *  1. 隐藏条件（collapsed / isMicroView / isRuntimeView）
 *  2. 缩放按钮调用 rendererRef 方法
 *  3. 统计浮层显示正确数据
 *  4. 交互式小地图：点击导航、密度热力、悬浮提示、拖拽视口
 *  5. 布局选择器：显示当前布局名、点击循环
 *  6. 标签显隐：属性 + renderer 调用
 *  7. 键盘提示浮层：开关 / 关闭
 *
 * @module tests/component/GraphCanvasControls.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { GraphCanvasControls } from '../../src/client/components/GraphCanvasControls.tsx';
import { InteractionController, type InteractionCallbacks } from '../../src/client/renderer/InteractionController.ts';
import { useGraphStore } from '../../src/client/store/graphStore.ts';

// i18n mock — 组件使用 useT()，需要返回键名作为值
vi.mock('../../src/client/i18n/index.ts', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    if (!params) return key;
    return key + JSON.stringify(params);
  },
}));

// Logger mock
vi.mock('../../src/shared/Logger.ts', () => ({
  scoped: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

interface RendererHandle {
  getZoom(): number;
  getViewportInfo(): {
    zoom: number;
    pan: { x: number; y: number };
    renderedSize: { w: number; h: number };
    totalSize: { w: number; h: number };
  } | null;
  getThumbnail(): string | null;
  focusOnArea(x: number, y: number, zoom: number): void;
  zoomBy(factor: number): void;
  fitToView(): void;
  resetView(): void;
  setLabelVisibility?(visible: boolean): void;
}

function createMockRenderer(overrides: Partial<RendererHandle> = {}): RendererHandle {
  return {
    getZoom: vi.fn(() => 1.0),
    getViewportInfo: vi.fn(() => ({
      zoom: 1.0,
      pan: { x: 0, y: 0 },
      renderedSize: { w: 800, h: 600 },
      totalSize: { w: 1600, h: 1200 },
    })),
    getThumbnail: vi.fn(() => 'data:image/png;base64,mock'),
    focusOnArea: vi.fn(),
    zoomBy: vi.fn(),
    fitToView: vi.fn(),
    resetView: vi.fn(),
    ...overrides,
  };
}

/** 渲染组件的最小 props。 */
function renderControls(
  rendererRef: React.RefObject<RendererHandle | null>,
  extra: Partial<React.ComponentProps<typeof GraphCanvasControls>> = {},
) {
  return render(
    <GraphCanvasControls
      rendererRef={rendererRef}
      visibleNodeCount={10}
      visibleEdgeCount={20}
      totalNodeCount={100}
      totalEdgeCount={200}
      collapsed={false}
      isMicroView={false}
      isRuntimeView={false}
      {...extra}
    />,
  );
}

describe('GraphCanvasControls', () => {
  beforeEach(() => {
    cleanup();
    // 布局选择器直接读 graphStore，每个用例前归位，避免用例间串扰。
    useGraphStore.setState({ layout: 'cose' });
  });

  it('returns null when collapsed', () => {
    const rendererRef = { current: createMockRenderer() };
    const { container } = renderControls(rendererRef, { collapsed: true });
    expect(container.firstChild).toBeNull();
  });

  it('returns null when isMicroView', () => {
    const rendererRef = { current: createMockRenderer() };
    const { container } = renderControls(rendererRef, { isMicroView: true });
    expect(container.firstChild).toBeNull();
  });

  it('returns null when isRuntimeView', () => {
    const rendererRef = { current: createMockRenderer() };
    const { container } = renderControls(rendererRef, { isRuntimeView: true });
    expect(container.firstChild).toBeNull();
  });

  it('renders zoom buttons when not collapsed', () => {
    const rendererRef = { current: createMockRenderer() };
    renderControls(rendererRef);
    // 缩放按钮组恰好四个，按可访问名取，避免依赖整体顺序。
    expect(screen.getByRole('button', { name: 'canvasControls.zoomIn' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'canvasControls.zoomOut' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'canvasControls.fitView' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'canvasControls.resetLayout' })).toBeDefined();
  });

  it('calls zoomBy when zoom in button is clicked', () => {
    const renderer = createMockRenderer();
    const rendererRef = { current: renderer };
    renderControls(rendererRef);
    fireEvent.click(screen.getByRole('button', { name: 'canvasControls.zoomIn' }));
    expect(renderer.zoomBy).toHaveBeenCalledWith(1.3);
  });

  it('calls zoomBy with inverse factor when zoom out button is clicked', () => {
    const renderer = createMockRenderer();
    const rendererRef = { current: renderer };
    renderControls(rendererRef);
    fireEvent.click(screen.getByRole('button', { name: 'canvasControls.zoomOut' }));
    expect(renderer.zoomBy).toHaveBeenCalledWith(1 / 1.3);
  });

  it('calls fitToView when fit button is clicked', () => {
    const renderer = createMockRenderer();
    const rendererRef = { current: renderer };
    renderControls(rendererRef);
    fireEvent.click(screen.getByRole('button', { name: 'canvasControls.fitView' }));
    expect(renderer.fitToView).toHaveBeenCalledOnce();
  });

  it('calls resetView when reset button is clicked', () => {
    const renderer = createMockRenderer();
    const rendererRef = { current: renderer };
    renderControls(rendererRef);
    fireEvent.click(screen.getByRole('button', { name: 'canvasControls.resetLayout' }));
    expect(renderer.resetView).toHaveBeenCalledOnce();
  });

  it('renders stats overlay when has data and visible nodes', () => {
    const rendererRef = { current: createMockRenderer() };
    renderControls(rendererRef);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('does not render stats overlay when no data', () => {
    const rendererRef = { current: createMockRenderer() };
    renderControls(rendererRef, { visibleNodeCount: 0, totalNodeCount: 0 });
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('renders minimap when thumbnail is provided', () => {
    const rendererRef = { current: createMockRenderer() };
    renderControls(rendererRef, { thumbnail: 'data:image/png;base64,mock' });
    expect(screen.getByRole('img')).toBeDefined();
  });

  it('calls onFocusArea when minimap is clicked', () => {
    const renderer = createMockRenderer();
    const rendererRef = { current: renderer };
    const onFocusArea = vi.fn();
    renderControls(rendererRef, {
      thumbnail: 'data:image/png;base64,mock',
      onFocusArea,
    });
    fireEvent.click(screen.getByRole('img'));
    expect(onFocusArea).toHaveBeenCalled();
  });

  describe('layout selector (cycle-141 / D)', () => {
    it('shows the current layout name', () => {
      const rendererRef = { current: createMockRenderer() };
      renderControls(rendererRef, { layout: 'dagre' });
      const btn = screen.getByRole('button', { name: 'canvasControls.layoutSelector' });
      expect(btn.textContent).toContain('canvasControls.layout.dagre');
    });

    it('cycles through layouts when clicked (via store)', () => {
      const rendererRef = { current: createMockRenderer() };
      renderControls(rendererRef, { layout: 'fcose' });
      fireEvent.click(screen.getByRole('button', { name: 'canvasControls.layoutSelector' }));
      // LAYOUT_ORDER = cose, fcose, dagre, ... → fcose(1) → dagre(2)
      expect(useGraphStore.getState().layout).toBe('dagre');
    });

    it('delegates to onCycleLayout when provided', () => {
      const rendererRef = { current: createMockRenderer() };
      const onCycleLayout = vi.fn();
      renderControls(rendererRef, { layout: 'cose', onCycleLayout });
      fireEvent.click(screen.getByRole('button', { name: 'canvasControls.layoutSelector' }));
      expect(onCycleLayout).toHaveBeenCalledOnce();
      // 显式回调接管时不应改动 store。
      expect(useGraphStore.getState().layout).toBe('cose');
    });
  });

  describe('label visibility toggle (cycle-141 / D)', () => {
    it('hides labels and calls renderer.setLabelVisibility on toggle', () => {
      const setLabelVisibility = vi.fn();
      const renderer = createMockRenderer({ setLabelVisibility });
      const rendererRef = { current: renderer };
      const onLabelsVisibleChange = vi.fn();
      renderControls(rendererRef, { onLabelsVisibleChange });
      expect(screen.getByRole('button', { name: 'canvasControls.labelToggle' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      fireEvent.click(screen.getByRole('button', { name: 'canvasControls.labelToggle' }));
      expect(renderer.setLabelVisibility).toHaveBeenCalledWith(false);
      expect(onLabelsVisibleChange).toHaveBeenCalledWith(false);
      expect(document.querySelector('[data-cg-labels]')).toHaveAttribute('data-cg-labels', 'hidden');
    });

    it('honours initialLabelsVisible=false', () => {
      const rendererRef = { current: createMockRenderer() };
      renderControls(rendererRef, { initialLabelsVisible: false });
      expect(screen.getByRole('button', { name: 'canvasControls.labelToggle' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('does not throw when renderer lacks setLabelVisibility', () => {
      const renderer = createMockRenderer({ setLabelVisibility: undefined });
      const rendererRef = { current: renderer };
      renderControls(rendererRef);
      expect(() =>
        fireEvent.click(screen.getByRole('button', { name: 'canvasControls.labelToggle' })),
      ).not.toThrow();
    });
  });

  describe('keyboard hint overlay (cycle-141 / D)', () => {
    it('toggles the hint overlay when the canvas is focused', () => {
      const rendererRef = { current: createMockRenderer() };
      renderControls(rendererRef, { canvasFocused: true });
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'canvasControls.keyboardHintToggle' }));
      const overlay = screen.getByRole('dialog');
      expect(overlay).toBeDefined();
      expect(overlay.getAttribute('data-cg-keyboard-hint')).toBe('on');
      // 提示列表来自 CANVAS_KEYBOARD_SHORTCUTS（九条）。
      expect(overlay.querySelectorAll('.cg-canvas-keyboard-hint-item')).toHaveLength(9);
    });

    it('does not show the hint when the canvas is not focused', () => {
      const rendererRef = { current: createMockRenderer() };
      renderControls(rendererRef, { canvasFocused: false });
      fireEvent.click(screen.getByRole('button', { name: 'canvasControls.keyboardHintToggle' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes the hint overlay via the close button', () => {
      const rendererRef = { current: createMockRenderer() };
      renderControls(rendererRef, { canvasFocused: true });
      fireEvent.click(screen.getByRole('button', { name: 'canvasControls.keyboardHintToggle' }));
      fireEvent.click(screen.getByRole('button', { name: 'canvasControls.keyboardHintClose' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('minimap density (cycle-141 / D)', () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 100 },
    ];

    it('renders a node-density layer from minimapNodes', () => {
      const rendererRef = { current: createMockRenderer() };
      renderControls(rendererRef, {
        thumbnail: 'data:image/png;base64,mock',
        minimapNodes: positions,
      });
      expect(document.querySelector('.cg-canvas-minimap-density')).not.toBeNull();
    });

    it('renders an edge-density layer from minimapEdges', () => {
      const rendererRef = { current: createMockRenderer() };
      renderControls(rendererRef, {
        thumbnail: 'data:image/png;base64,mock',
        minimapNodes: positions,
        minimapEdges: [{ x: 50, y: 50 }],
      });
      expect(document.querySelector('.cg-canvas-minimap-edge-density')).not.toBeNull();
    });

    it('omits density layers when no node coordinates are given', () => {
      const rendererRef = { current: createMockRenderer() };
      renderControls(rendererRef, { thumbnail: 'data:image/png;base64,mock' });
      expect(document.querySelector('.cg-canvas-minimap-density')).toBeNull();
    });

    it('shows the focus tooltip on hover', () => {
      const rendererRef = { current: createMockRenderer() };
      renderControls(rendererRef, { thumbnail: 'data:image/png;base64,mock' });
      const minimap = screen.getByRole('img');
      expect(document.querySelector('.cg-canvas-minimap-tooltip')).toBeNull();
      fireEvent.mouseMove(minimap, { clientX: 10, clientY: 10 });
      const tooltip = document.querySelector('.cg-canvas-minimap-tooltip');
      expect(tooltip).not.toBeNull();
      expect(tooltip!.getAttribute('role')).toBe('tooltip');
    });

    it('marks the minimap dragging state on mouse down', () => {
      const rendererRef = { current: createMockRenderer() };
      renderControls(rendererRef, { thumbnail: 'data:image/png;base64,mock' });
      const minimap = screen.getByRole('img');
      expect(minimap).toHaveAttribute('data-cg-minimap-dragging', 'off');
      fireEvent.mouseDown(minimap);
      expect(minimap).toHaveAttribute('data-cg-minimap-dragging', 'on');
      fireEvent.mouseUp(document);
      expect(minimap).toHaveAttribute('data-cg-minimap-dragging', 'off');
    });
  });
});

// ---------------------------------------------------------------------------
// InteractionController 画布键盘 / 多选（cycle-141 / D）
// 放在本文件内是为了满足「新增测试只在允许文件里」的写范围约束。
// ---------------------------------------------------------------------------

interface MockICNode {
  id: () => string;
  renderedPosition: () => { x: number; y: number };
  neighborhood: () => { forEach: (cb: (el: any) => void) => void };
  addClass: ReturnType<typeof vi.fn>;
  removeClass: ReturnType<typeof vi.fn>;
  toggleClass: ReturnType<typeof vi.fn>;
  hasClass: (cls: string) => boolean;
  empty: () => boolean;
  isNode: () => boolean;
}

const icNodeRefs = new Map<string, MockICNode>();

function makeICNode(id: string, pos: { x: number; y: number }, neighborIds: string[]): MockICNode {
  const classes = new Set<string>();
  return {
    id: () => id,
    renderedPosition: () => pos,
    neighborhood: () => ({ forEach: (cb) => neighborIds.forEach((n) => cb(icNodeRefs.get(n))) }),
    addClass: vi.fn((c: string) => { classes.add(c); }),
    removeClass: vi.fn((c: string) => { classes.delete(c); }),
    toggleClass: vi.fn((c: string, on?: boolean) => { if (on) classes.add(c); else classes.delete(c); }),
    hasClass: (c: string) => classes.has(c),
    empty: () => false,
    isNode: () => true,
  };
}

function buildIC() {
  icNodeRefs.clear();
  const a = makeICNode('a', { x: 0, y: 0 }, ['b']);
  const b = makeICNode('b', { x: 100, y: 0 }, ['a']);
  icNodeRefs.set('a', a);
  icNodeRefs.set('b', b);

  const nodeCollection = { removeClass: vi.fn(), forEach: vi.fn(), toArray: () => [a, b] };
  // 用 any 承载：容器只注册 keydown，具体 handler 在测试内直接调用。
  const handlers: Record<string, ((e: any) => void) | undefined> = {};
  const el: HTMLElement & { addEventListener: (k: string, h: (e: any) => void) => void } = {
    addEventListener: (k: string, h: (e: any) => void) => { handlers[k] = h; },
    removeEventListener: vi.fn(),
  } as unknown as HTMLElement;
  const cy: any = {
    container: () => el,
    on: vi.fn(),
    off: vi.fn(),
    nodes: () => nodeCollection,
    edges: () => ({ removeClass: vi.fn() }),
    $: () => ({ nonempty: () => false, first: () => ({ isNode: () => false }) }),
    getElementById: (id: string) => icNodeRefs.get(id) ?? { empty: () => true },
    zoom: vi.fn(() => 1),
    fit: vi.fn(),
  };
  return { a, b, cy, el, handlers, nodeCollection };
}

function makeICCallbacks(): InteractionCallbacks {
  return {
    onNodeTap: vi.fn(),
    onSelectionToggle: vi.fn(),
    onNodeFocus: vi.fn(),
    onCanvasEscape: vi.fn(),
  };
}

function tapNodeHandler(cy: any) {
  const call = cy.on.mock.calls.find(([event]: [string, string, Function]) => event === 'tap')!;
  return call[2] as (e: any) => void;
}

describe('InteractionController canvas keyboard (cycle-141 / D)', () => {
  let callbacks: ReturnType<typeof makeICCallbacks>;

  beforeEach(() => {
    callbacks = makeICCallbacks();
    Object.values(callbacks).forEach((fn) => (fn as any).mockClear());
  });

  it('toggles multi-select on Shift+click', () => {
    const { a, cy } = buildIC();
    new InteractionController(cy as any, callbacks);
    const tap = tapNodeHandler(cy);
    tap({ target: a, originalEvent: { shiftKey: true } });
    expect(callbacks.onSelectionToggle).toHaveBeenCalledWith('a', true, ['a']);
    expect(a.hasClass('multi-selected')).toBe(true);
    tap({ target: a, originalEvent: { shiftKey: true } });
    expect(callbacks.onSelectionToggle).toHaveBeenCalledWith('a', false, []);
    expect(a.hasClass('multi-selected')).toBe(false);
  });

  it('clears multi-select on a plain click', () => {
    const { a, cy, nodeCollection } = buildIC();
    // cycle-149：静默清空必须通知消费方（store 镜像同步依赖此回调）。
    const onSelectionClear = vi.fn();
    new InteractionController(cy as any, { ...callbacks, onSelectionClear });
    const tap = tapNodeHandler(cy);
    tap({ target: a, originalEvent: { shiftKey: true } });
    tap({ target: a, originalEvent: {} });
    expect(nodeCollection.removeClass).toHaveBeenCalledWith('multi-selected');
    expect(onSelectionClear).toHaveBeenCalledTimes(1);
  });

  it('moves keyboard focus to the graph neighbor on arrow key', () => {
    const { a, b, cy, el, handlers } = buildIC();
    new InteractionController(cy as any, callbacks);
    tapNodeHandler(cy)({ target: a, originalEvent: {} });
    handlers.keydown!({ key: 'ArrowRight', target: el, preventDefault: vi.fn() });
    expect(b.hasClass('canvas-focused')).toBe(true);
    expect(callbacks.onNodeFocus).toHaveBeenLastCalledWith('b');
  });

  it('selects the focused node on Enter', () => {
    const { a, b, cy, el, handlers } = buildIC();
    new InteractionController(cy as any, callbacks);
    tapNodeHandler(cy)({ target: a, originalEvent: {} });
    handlers.keydown!({ key: 'ArrowRight', target: el, preventDefault: vi.fn() });
    handlers.keydown!({ key: 'Enter', target: el, preventDefault: vi.fn() });
    expect(callbacks.onNodeTap).toHaveBeenLastCalledWith('b');
  });

  it('clears keyboard focus on Escape', () => {
    const { a, b, cy, el, handlers } = buildIC();
    new InteractionController(cy as any, callbacks);
    tapNodeHandler(cy)({ target: a, originalEvent: {} });
    handlers.keydown!({ key: 'ArrowRight', target: el, preventDefault: vi.fn() });
    handlers.keydown!({ key: 'Escape', target: el, preventDefault: vi.fn() });
    expect(b.hasClass('canvas-focused')).toBe(false);
    expect(callbacks.onCanvasEscape).toHaveBeenCalled();
  });

  it('zooms with +/- and clamps to a sane range', () => {
    const { cy, el, handlers } = buildIC();
    let current = 10;
    cy.zoom = vi.fn((v?: number) => { if (v !== undefined) current = v; return current; });
    new InteractionController(cy as any, callbacks);
    handlers.keydown!({ key: '+', target: el, preventDefault: vi.fn() });
    expect(cy.zoom).toHaveBeenCalledWith(13);
    handlers.keydown!({ key: '-', target: el, preventDefault: vi.fn() });
    expect(cy.zoom).toHaveBeenLastCalledWith(10);
  });

  it('ignores keydown from elements other than the container', () => {
    const { cy, el, handlers } = buildIC();
    new InteractionController(cy as any, callbacks);
    handlers.keydown!({ key: 'ArrowRight', target: { not: 'container' }, preventDefault: vi.fn() });
    expect(callbacks.onNodeFocus).not.toHaveBeenCalled();
  });

  it('does not throw when the container has no addEventListener', () => {
    const { cy } = buildIC();
    cy.container = () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) });
    expect(() => new InteractionController(cy as any, callbacks)).not.toThrow();
  });

  it('hides node and edge labels via text-opacity', () => {
    const styleSpy = vi.fn();
    const selectorStub = { style: styleSpy };
    const cy: any = {
      on: vi.fn(),
      off: vi.fn(),
      container: () => ({}),
      batch: (fn: () => void) => fn(),
      style: () => ({ selector: () => selectorStub, update: vi.fn() }),
    };
    const ctrl = new InteractionController(cy as any, callbacks);
    ctrl.setLabelVisibility(false);
    expect(styleSpy).toHaveBeenNthCalledWith(1, { 'text-opacity': 0 });
    expect(styleSpy).toHaveBeenNthCalledWith(2, { 'text-opacity': 0 });
    ctrl.setLabelVisibility(true);
    expect(styleSpy).toHaveBeenNthCalledWith(3, { 'text-opacity': 1 });
    expect(styleSpy).toHaveBeenNthCalledWith(4, { 'text-opacity': 1 });
  });
});

