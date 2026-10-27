/**
 * GraphCanvasControls 组件单元测试。
 *
 * 验证：
 *  1. 隐藏条件（collapsed / isMicroView / isRuntimeView）
 *  2. 缩放按钮调用 rendererRef 方法
 *  3. 统计浮层显示正确数据
 *  4. 交互式小地图点击导航
 *
 * @module tests/unit/GraphCanvasControls.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { GraphCanvasControls } from '../../src/client/components/GraphCanvasControls.tsx';

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

describe('GraphCanvasControls', () => {
  beforeEach(() => cleanup());

  it('returns null when collapsed', () => {
    const rendererRef = { current: createMockRenderer() };
    const { container } = render(
      <GraphCanvasControls
        rendererRef={rendererRef}
        visibleNodeCount={10}
        visibleEdgeCount={20}
        totalNodeCount={100}
        totalEdgeCount={200}
        collapsed={true}
        isMicroView={false}
        isRuntimeView={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when isMicroView', () => {
    const rendererRef = { current: createMockRenderer() };
    const { container } = render(
      <GraphCanvasControls
        rendererRef={rendererRef}
        visibleNodeCount={10}
        visibleEdgeCount={20}
        totalNodeCount={100}
        totalEdgeCount={200}
        collapsed={false}
        isMicroView={true}
        isRuntimeView={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when isRuntimeView', () => {
    const rendererRef = { current: createMockRenderer() };
    const { container } = render(
      <GraphCanvasControls
        rendererRef={rendererRef}
        visibleNodeCount={10}
        visibleEdgeCount={20}
        totalNodeCount={100}
        totalEdgeCount={200}
        collapsed={false}
        isMicroView={false}
        isRuntimeView={true}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders zoom buttons when not collapsed', () => {
    const rendererRef = { current: createMockRenderer() };
    render(
      <GraphCanvasControls
        rendererRef={rendererRef}
        visibleNodeCount={10}
        visibleEdgeCount={20}
        totalNodeCount={100}
        totalEdgeCount={200}
        collapsed={false}
        isMicroView={false}
        isRuntimeView={false}
      />,
    );
    // 四个按钮：zoom in, zoom out, fit, reset
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
  });

  it('calls zoomBy when zoom in button is clicked', () => {
    const renderer = createMockRenderer();
    const rendererRef = { current: renderer };
    render(
      <GraphCanvasControls
        rendererRef={rendererRef}
        visibleNodeCount={10}
        visibleEdgeCount={20}
        totalNodeCount={100}
        totalEdgeCount={200}
        collapsed={false}
        isMicroView={false}
        isRuntimeView={false}
      />,
    );
    const buttons = screen.getAllByRole('button');
    // 第一个按钮是 zoom in
    fireEvent.click(buttons[0]!);
    expect(renderer.zoomBy).toHaveBeenCalledWith(1.3);
  });

  it('calls zoomBy with inverse factor when zoom out button is clicked', () => {
    const renderer = createMockRenderer();
    const rendererRef = { current: renderer };
    render(
      <GraphCanvasControls
        rendererRef={rendererRef}
        visibleNodeCount={10}
        visibleEdgeCount={20}
        totalNodeCount={100}
        totalEdgeCount={200}
        collapsed={false}
        isMicroView={false}
        isRuntimeView={false}
      />,
    );
    const buttons = screen.getAllByRole('button');
    // 第二个按钮是 zoom out
    fireEvent.click(buttons[1]!);
    expect(renderer.zoomBy).toHaveBeenCalledWith(1 / 1.3);
  });

  it('calls fitToView when fit button is clicked', () => {
    const renderer = createMockRenderer();
    const rendererRef = { current: renderer };
    render(
      <GraphCanvasControls
        rendererRef={rendererRef}
        visibleNodeCount={10}
        visibleEdgeCount={20}
        totalNodeCount={100}
        totalEdgeCount={200}
        collapsed={false}
        isMicroView={false}
        isRuntimeView={false}
      />,
    );
    const buttons = screen.getAllByRole('button');
    // 第三个按钮是 fit
    fireEvent.click(buttons[2]!);
    expect(renderer.fitToView).toHaveBeenCalledOnce();
  });

  it('calls resetView when reset button is clicked', () => {
    const renderer = createMockRenderer();
    const rendererRef = { current: renderer };
    render(
      <GraphCanvasControls
        rendererRef={rendererRef}
        visibleNodeCount={10}
        visibleEdgeCount={20}
        totalNodeCount={100}
        totalEdgeCount={200}
        collapsed={false}
        isMicroView={false}
        isRuntimeView={false}
      />,
    );
    const buttons = screen.getAllByRole('button');
    // 第四个按钮是 reset
    fireEvent.click(buttons[3]!);
    expect(renderer.resetView).toHaveBeenCalledOnce();
  });

  it('renders stats overlay when has data and visible nodes', () => {
    const rendererRef = { current: createMockRenderer() };
    render(
      <GraphCanvasControls
        rendererRef={rendererRef}
        visibleNodeCount={50}
        visibleEdgeCount={100}
        totalNodeCount={200}
        totalEdgeCount={400}
        collapsed={false}
        isMicroView={false}
        isRuntimeView={false}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toBeDefined();
  });

  it('does not render stats overlay when no data', () => {
    const rendererRef = { current: createMockRenderer() };
    render(
      <GraphCanvasControls
        rendererRef={rendererRef}
        visibleNodeCount={0}
        visibleEdgeCount={0}
        totalNodeCount={0}
        totalEdgeCount={0}
        collapsed={false}
        isMicroView={false}
        isRuntimeView={false}
      />,
    );
    // No status element (stats overlay hidden)
    const statuses = screen.queryAllByRole('status');
    expect(statuses).toHaveLength(0);
  });

  it('renders minimap when thumbnail is provided', () => {
    const rendererRef = { current: createMockRenderer() };
    render(
      <GraphCanvasControls
        rendererRef={rendererRef}
        visibleNodeCount={10}
        visibleEdgeCount={20}
        totalNodeCount={100}
        totalEdgeCount={200}
        collapsed={false}
        isMicroView={false}
        isRuntimeView={false}
        thumbnail="data:image/png;base64,mock"
      />,
    );
    const minimap = screen.getByRole('img');
    expect(minimap).toBeDefined();
  });

  it('calls onFocusArea when minimap is clicked', () => {
    const renderer = createMockRenderer();
    const rendererRef = { current: renderer };
    const onFocusArea = vi.fn();
    render(
      <GraphCanvasControls
        rendererRef={rendererRef}
        visibleNodeCount={10}
        visibleEdgeCount={20}
        totalNodeCount={100}
        totalEdgeCount={200}
        collapsed={false}
        isMicroView={false}
        isRuntimeView={false}
        thumbnail="data:image/png;base64,mock"
        onFocusArea={onFocusArea}
      />,
    );
    const minimap = screen.getByRole('img');
    fireEvent.click(minimap);
    expect(onFocusArea).toHaveBeenCalled();
  });
});
