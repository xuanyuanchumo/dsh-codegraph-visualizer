/**
 * GraphCanvasControls — 浮在图谱画布上的交互式控制层。
 *
 * 设计目标（用户反馈「要可交互的图谱，功能很贫乏」）：
 *  1. 缩放控制：放大 / 缩小 / 适应窗口 / 重置布局，一键可达
 *  2. 画布统计：节点数 / 边数 / 缩放级别 / 可见比例，实时白盒透明
 *  3. 交互式小地图：点击导航、视口框拖拽、密度热力、悬浮提示
 *  4. 布局选择器：画布内直接循环 fcose/dagre/cose/circle，不必回工具栏
 *  5. 标签显隐：大图时一键收起节点 / 边标签，减少视觉噪声
 *  6. 键盘导航：画布聚焦后方向键移动聚焦、Enter 选中、Esc 清除、+/- 缩放、F 适应
 *  7. 浮层定位：右下角浮层，不遮挡图谱主体，响应式自适应
 *
 * 与 StatsPanel 的关系：StatsPanel 是右侧栏面板（可开关、占席位），
 * 本组件是画布内浮层（始终可见、零席位开销），两者互补。
 *
 * @module client/components/GraphCanvasControls
 */
import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useT } from '../i18n/index.ts';
import { LAYOUT_ORDER, type LayoutType } from '../../shared/viewModeUtils.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { CANVAS_KEYBOARD_SHORTCUTS, formatShortcutKey } from '../hooks/usePanelKeyboard.ts';

/** 渲染器引用的最小接口——只暴露控制层需要的方法。 */
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
  /**
   * 标签显隐开关（cycle-141 / D）。
   *
   * 可选：`IRenderer` 当前未声明该方法，渲染器实现后即可生效；未实现时
   * 控制层退化为纯本地状态，仍会同步 `data-cg-labels` 属性供样式 / 测试观察。
   */
  setLabelVisibility?(visible: boolean): void;
}

export interface GraphCanvasControlsProps {
  /** 渲染器实例（通过 ref 传入，可能为 null）。 */
  rendererRef: React.RefObject<RendererHandle | null>;
  /** 当前可见节点数。 */
  visibleNodeCount: number;
  /** 当前可见边数。 */
  visibleEdgeCount: number;
  /** 总节点数（含聚类折叠的）。 */
  totalNodeCount: number;
  /** 总边数。 */
  totalEdgeCount: number;
  /** 是否折叠（折叠时隐藏控制层）。 */
  collapsed: boolean;
  /** 是否为微观视图（微观视图时隐藏控制层）。 */
  isMicroView: boolean;
  /** 是否为运行时视图（运行时视图时隐藏控制层）。 */
  isRuntimeView: boolean;
  /** 缩略图 URL（可选，来自 useMiniMapSync）。 */
  thumbnail?: string | null;
  /** 视口信息（可选，来自 useMiniMapSync）。 */
  viewportInfo?: {
    zoom: number;
    pan: { x: number; y: number };
    renderedSize: { w: number; h: number };
    totalSize: { w: number; h: number };
  } | null;
  /** 点击小地图区域时回调（比例坐标 0-1）。 */
  onFocusArea?: (ratioX: number, ratioY: number) => void;

  // ---- cycle-141 / D 新增 ----
  /**
   * 画布内布局选择器使用的当前布局。
   * 缺省时直接读 `graphStore.layout`（无需父层接线即可工作）。
   */
  layout?: LayoutType;
  /** 显式接管布局循环（缺省调用 `graphStore.setLayout`）。 */
  onCycleLayout?: () => void;
  /** 标签可见性初始值（缺省 true）。 */
  initialLabelsVisible?: boolean;
  /** 标签可见性变化回调。 */
  onLabelsVisibleChange?: (visible: boolean) => void;
  /** 受控的「画布是否聚焦」；缺省时由本组件监听 document focus 事件推断。 */
  canvasFocused?: boolean;
  /** 小地图节点坐标（用于节点密度热力图）。 */
  minimapNodes?: readonly { x: number; y: number }[];
  /** 小地图边中点坐标（用于边密度）。 */
  minimapEdges?: readonly { x: number; y: number }[];
  /** 图谱包围盒（缺省由 minimapNodes 推断）。 */
  graphBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/** 缩放步长（每次点击放大/缩小的倍率）。 */
const ZOOM_STEP = 1.3;

/** 小地图密度网格边数（每边分成多少格）。 */
const MINIMAP_GRID = 20;

/**
 * 画布缩放控制按钮组。
 *
 * 使用 SVG 图标而非 emoji/文字，保证跨平台一致性。
 * 按钮带 `aria-label` 和 `title`，满足可访问性。
 */
function ZoomButtonGroup({
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onReset: () => void;
}) {
  const t = useT();
  return (
    <div className="cg-canvas-zoom-group" role="group" aria-label={t('canvasControls.zoomGroup')}>
      <button
        className="cg-canvas-btn cg-canvas-zoom-in"
        onClick={onZoomIn}
        aria-label={t('canvasControls.zoomIn')}
        title={t('canvasControls.zoomIn')}
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className="cg-canvas-btn cg-canvas-zoom-out"
        onClick={onZoomOut}
        aria-label={t('canvasControls.zoomOut')}
        title={t('canvasControls.zoomOut')}
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className="cg-canvas-btn cg-canvas-fit"
        onClick={onFit}
        aria-label={t('canvasControls.fitView')}
        title={t('canvasControls.fitView')}
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        className="cg-canvas-btn cg-canvas-reset"
        onClick={onReset}
        aria-label={t('canvasControls.resetLayout')}
        title={t('canvasControls.resetLayout')}
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8a5 5 0 1 0 1.5-3.5M3 3v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * 画布统计信息浮层。
 *
 * 白盒透明化：实时显示节点/边数量、缩放级别、可见比例。
 * 让用户随时知道「画布上有多少东西、缩放到什么程度」。
 */
function CanvasStatsOverlay({
  visibleNodes,
  visibleEdges,
  totalNodes,
  totalEdges,
  zoom,
}: {
  visibleNodes: number;
  visibleEdges: number;
  totalNodes: number;
  totalEdges: number;
  zoom: number;
}) {
  const t = useT();
  const visibleRatio = totalNodes > 0 ? Math.round((visibleNodes / totalNodes) * 100) : 100;
  return (
    <div className="cg-canvas-stats" role="status" aria-live="polite">
      <span className="cg-canvas-stat-item" title={t('canvasControls.nodesTitle')}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="3" fill="currentColor" />
        </svg>
        {t('canvasControls.nodes', { visible: visibleNodes, total: totalNodes })}
      </span>
      <span className="cg-canvas-stat-sep" aria-hidden="true">·</span>
      <span className="cg-canvas-stat-item" title={t('canvasControls.edgesTitle')}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 10L10 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {t('canvasControls.edges', { visible: visibleEdges, total: totalEdges })}
      </span>
      <span className="cg-canvas-stat-sep" aria-hidden="true">·</span>
      <span className="cg-canvas-stat-item" title={t('canvasControls.zoomTitle')}>
        {t('canvasControls.zoomLevel', { level: Math.round(zoom * 100) })}
      </span>
      {visibleRatio < 100 && (
        <>
          <span className="cg-canvas-stat-sep" aria-hidden="true">·</span>
          <span className="cg-canvas-stat-item cg-canvas-stat-ratio" title={t('canvasControls.visibleRatioTitle')}>
            {t('canvasControls.visibleRatio', { ratio: visibleRatio })}
          </span>
        </>
      )}
    </div>
  );
}

/** 把点集按包围盒映射到 `gridSize x gridSize` 的密度网格。 */
function densityGrid(
  points: readonly { x: number; y: number }[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  gridSize: number,
): number[] | null {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  if (spanX <= 0 || spanY <= 0 || points.length === 0) return null;
  const grid = Array.from({ length: gridSize * gridSize }, () => 0);
  for (const p of points) {
    const gx = Math.floor(((p.x - bounds.minX) / spanX) * gridSize);
    const gy = Math.floor(((p.y - bounds.minY) / spanY) * gridSize);
    if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
      grid[gy * gridSize + gx] = (grid[gy * gridSize + gx] ?? 0) + 1;
    }
  }
  return grid;
}

/** 密度网格的极值（0 表示没有点）。 */
function gridMax(grid: number[] | null): number {
  if (!grid) return 0;
  return grid.reduce((max, v) => Math.max(max, v), 0);
}

/** 把密度网格渲染成 SVG 热力层；越密越不透明。 */
function DensityLayer({
  grid,
  max,
  fill,
  className,
}: {
  grid: number[] | null;
  max: number;
  fill: string;
  className: string;
}) {
  if (!grid || max <= 0) return null;
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {grid.map((count, i) => {
        if (count <= 0) return null;
        // 0.18 ~ 0.85：低密度也可见，高密度足够深。
        const opacity = Math.min(0.85, 0.18 + (count / max) * 0.67);
        const cell = 100 / MINIMAP_GRID;
        const x = (i % MINIMAP_GRID) * cell;
        const y = Math.floor(i / MINIMAP_GRID) * cell;
        return (
          <rect
            key={`${className}-${i}`}
            x={x}
            y={y}
            width={cell}
            height={cell}
            style={{ fill, opacity }}
          />
        );
      })}
    </svg>
  );
}

/**
 * 交互式小地图。
 *
 * 与 StatsPanel 中的静态缩略图不同：
 *  - 点击小地图任意位置 → 画布视口居中到该位置
 *  - 视口框实时反映当前画布视口位置，且可拖拽
 *  - 节点密度 / 边密度热力层叠加在缩略图上
 *  - 悬浮时显示「点击定位 / 拖拽平移」提示
 */
function InteractiveMiniMap({
  thumbnail,
  viewportInfo,
  onFocusArea,
  nodePositions,
  edgeMidPoints,
  graphBounds,
}: {
  thumbnail: string | null;
  viewportInfo: {
    zoom: number;
    pan: { x: number; y: number };
    renderedSize: { w: number; h: number };
    totalSize: { w: number; h: number };
  } | null;
  onFocusArea?: (ratioX: number, ratioY: number) => void;
  nodePositions?: readonly { x: number; y: number }[];
  edgeMidPoints?: readonly { x: number; y: number }[];
  graphBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
}) {
  const t = useT();
  const mapRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  // 密度热力所需的包围盒：优先用传入的，否则由节点坐标推断。
  const bounds = useMemo(() => {
    if (graphBounds) return graphBounds;
    const pts = nodePositions ?? [];
    if (pts.length === 0) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }, [graphBounds, nodePositions]);

  const nodeGrid = useMemo(
    () => densityGrid(nodePositions ?? [], bounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }, MINIMAP_GRID),
    [nodePositions, bounds],
  );
  const edgeGrid = useMemo(
    () => densityGrid(edgeMidPoints ?? [], bounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }, MINIMAP_GRID),
    [edgeMidPoints, bounds],
  );
  const nodeMax = gridMax(nodeGrid);
  const edgeMax = gridMax(edgeGrid);

  // 计算视口框在小地图中的位置和大小（比例 0-1）
  const viewportRect = viewportInfo
    ? (() => {
        const { renderedSize, totalSize, pan } = viewportInfo;
        if (totalSize.w <= 0 || totalSize.h <= 0) return null;
        // 视口左上角在总图中的比例位置
        const ratioX = -pan.x / totalSize.w;
        const ratioY = -pan.y / totalSize.h;
        // 视口大小在总图中的比例
        const ratioW = renderedSize.w / totalSize.w;
        const ratioH = renderedSize.h / totalSize.h;
        return {
          left: Math.max(0, Math.min(1, ratioX)) * 100,
          top: Math.max(0, Math.min(1, ratioY)) * 100,
          width: Math.max(0, Math.min(1, ratioW)) * 100,
          height: Math.max(0, Math.min(1, ratioH)) * 100,
        };
      })()
    : null;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onFocusArea) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratioX = (e.clientX - rect.left) / rect.width;
      const ratioY = (e.clientY - rect.top) / rect.height;
      onFocusArea(Math.max(0, Math.min(1, ratioX)), Math.max(0, Math.min(1, ratioY)));
    },
    [onFocusArea],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  // 悬浮提示：仅在非拖拽时跟随指针，避免拖拽途中产生抖动。
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, [isDragging]);

  const handleMouseLeave = useCallback(() => {
    setTip(null);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMoveDoc = (e: MouseEvent) => {
      if (!onFocusArea || !mapRef.current) return;
      const rect = mapRef.current.getBoundingClientRect();
      const ratioX = (e.clientX - rect.left) / rect.width;
      const ratioY = (e.clientY - rect.top) / rect.height;
      onFocusArea(Math.max(0, Math.min(1, ratioX)), Math.max(0, Math.min(1, ratioY)));
    };
    const handleMouseUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMouseMoveDoc);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMoveDoc);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, onFocusArea]);

  if (!thumbnail) return null;

  return (
    <div
      className="cg-canvas-minimap"
      ref={mapRef}
      role="img"
      aria-label={t('canvasControls.minimap')}
      title={t('canvasControls.minimapHint')}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      data-cg-minimap-dragging={isDragging ? 'on' : 'off'}
    >
      <img src={thumbnail} alt="" aria-hidden="true" className="cg-canvas-minimap-img" draggable={false} />
      <DensityLayer grid={nodeGrid} max={nodeMax} fill="var(--cg-accent)" className="cg-canvas-minimap-density" />
      <DensityLayer grid={edgeGrid} max={edgeMax} fill="var(--cg-info)" className="cg-canvas-minimap-edge-density" />
      {viewportRect && (
        <div
          className="cg-canvas-minimap-viewport"
          style={{
            left: `${viewportRect.left}%`,
            top: `${viewportRect.top}%`,
            width: `${viewportRect.width}%`,
            height: `${viewportRect.height}%`,
            cursor: 'move',
          }}
          aria-hidden="true"
        />
      )}
      {tip && (
        <div
          className="cg-canvas-minimap-tooltip"
          role="tooltip"
          style={{
            left: tip.x,
            top: tip.y,
            position: 'absolute',
            transform: 'translate(-50%, calc(-100% - 8px))',
            padding: '2px 6px',
            borderRadius: 'var(--cg-radius-xs)',
            fontSize: 10,
            whiteSpace: 'nowrap',
            background: 'var(--cg-bg-elevated)',
            color: 'var(--cg-text)',
            border: '1px solid var(--cg-border-strong))',
            boxShadow: 'var(--cg-shadow-sm))',
            pointerEvents: 'none',
          }}
        >
          {t('canvasControls.minimapFocusHint')}
        </div>
      )}
    </div>
  );
}

/**
 * 画布键盘导航提示浮层（cycle-141 / D）。
 *
 * 仅在画布聚焦且用户开启提示时出现；列表直接来自
 * `CANVAS_KEYBOARD_SHORTCUTS`（与 `usePanelKeyboard` 单一来源，不复制文案）。
 */
function KeyboardHintOverlay({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div
      className="cg-canvas-keyboard-hint"
      role="dialog"
      aria-label={t('canvasControls.keyboardHint')}
      data-cg-keyboard-hint="on"
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 20,
        minWidth: 200,
        maxWidth: 260,
        padding: '10px 12px',
        borderRadius: 'var(--cg-radius-sm)',
        background: 'var(--cg-surface)',
        border: '1px solid var(--cg-border-strong))',
        boxShadow: 'var(--cg-shadow))',
        pointerEvents: 'auto',
      }}
    >
      <div className="cg-canvas-keyboard-hint-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="cg-canvas-keyboard-hint-title" style={{ fontSize: 11, fontWeight: 600, color: 'var(--cg-text)' }}>
          {t('canvasControls.keyboardHint')}
        </span>
        <button
          type="button"
          className="cg-canvas-btn cg-canvas-hint-close"
          onClick={onClose}
          aria-label={t('canvasControls.keyboardHintClose')}
          title={t('canvasControls.keyboardHintClose')}
          style={{ width: 20, height: 20 }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <ul className="cg-canvas-keyboard-hint-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3 }}>
        {CANVAS_KEYBOARD_SHORTCUTS.map((s) => (
          <li key={s.descKey} className="cg-canvas-keyboard-hint-item" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--cg-text-secondary)' }}>
            <kbd className="cg-canvas-keyboard-hint-key" style={{
              minWidth: 34, textAlign: 'center', fontSize: 10, fontFamily: 'var(--cg-font-mono)',
              padding: '1px 4px', borderRadius: 'var(--cg-radius-xs)',
              background: 'var(--cg-surface-active)', color: 'var(--cg-text)',
            }}>
              {formatShortcutKey(s)}
            </kbd>
            <span>{t(s.descKey)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * GraphCanvasControls 主组件。
 *
 * 布局策略：
 *  - 右下角浮层，`position: absolute` 相对于 `.cg-graph-container`
 *  - 垂直排列：统计信息 → 控制按钮行 → 缩放按钮组 → 键盘提示 → 小地图
 *  - `pointer-events: none` 在容器上，子元素 `pointer-events: auto`，
 *    这样浮层不拦截画布的拖拽/滚轮事件
 *
 * 可见性控制：
 *  - collapsed / isMicroView / isRuntimeView 时整体隐藏
 *  - 无数据时隐藏统计和小地图，只保留按钮组（按钮组对空画布也安全）
 */
export const GraphCanvasControls = memo(function GraphCanvasControls(props: GraphCanvasControlsProps) {
  const { rendererRef, collapsed, isMicroView, isRuntimeView } = props;
  const t = useT();

  // 实时缩放级别（用于统计显示）
  const [currentZoom, setCurrentZoom] = useState(1);

  // 标签显隐（cycle-141 / D）
  const [labelsVisible, setLabelsVisible] = useState(props.initialLabelsVisible ?? true);

  // 键盘提示浮层开关（cycle-141 / D）
  const [showKeyboardHint, setShowKeyboardHint] = useState(false);

  // 画布是否聚焦：受控优先，缺省由 document focus 事件推断
  const [internalCanvasFocused, setInternalCanvasFocused] = useState(false);
  const controlledFocused = props.canvasFocused !== undefined;

  useEffect(() => {
    if (controlledFocused) return;
    const containerClass = 'cg-graph-container';
    const onFocusIn = (e: FocusEvent) => {
      if ((e.target as HTMLElement | null)?.classList.contains(containerClass)) {
        setInternalCanvasFocused(true);
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (!related?.classList.contains(containerClass)) {
        setInternalCanvasFocused(false);
      }
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [controlledFocused]);

  const canvasFocused = props.canvasFocused ?? internalCanvasFocused;

  // 轮询缩放级别（cytoscape 的 zoom 事件不透传到 React）
  useEffect(() => {
    if (collapsed || isMicroView || isRuntimeView) return;
    const updateZoom = () => {
      const r = rendererRef.current;
      if (r) {
        try {
          setCurrentZoom(r.getZoom());
        } catch {
          // renderer 已销毁，忽略
        }
      }
    };
    updateZoom();
    const intervalId = setInterval(updateZoom, 500);
    return () => clearInterval(intervalId);
  }, [rendererRef, collapsed, isMicroView, isRuntimeView]);

  const handleZoomIn = useCallback(() => {
    rendererRef.current?.zoomBy(ZOOM_STEP);
  }, [rendererRef]);

  const handleZoomOut = useCallback(() => {
    rendererRef.current?.zoomBy(1 / ZOOM_STEP);
  }, [rendererRef]);

  const handleFit = useCallback(() => {
    rendererRef.current?.fitToView();
  }, [rendererRef]);

  const handleReset = useCallback(() => {
    rendererRef.current?.resetView();
  }, [rendererRef]);

  // 布局：父层 prop 优先，否则直接用 graphStore（本组件在 GraphPanel 的 React 树内，
  // 全局 zustand store 可直接订阅，无需父层接线）。
  const storeLayout = useGraphStore((s) => s.layout);
  const storeSetLayout = useGraphStore((s) => s.setLayout);
  const layout = props.layout ?? storeLayout;

  const handleCycleLayout = useCallback(() => {
    if (props.onCycleLayout) {
      props.onCycleLayout();
      return;
    }
    // 布局顺序的唯一权威表是 `LAYOUT_ORDER`（cycle-84 收敛）。
    const idx = LAYOUT_ORDER.indexOf(layout);
    const next = LAYOUT_ORDER[(idx + 1) % LAYOUT_ORDER.length]!;
    storeSetLayout(next);
  }, [layout, props.onCycleLayout, storeSetLayout]);

  const layoutLabel = layout ? t(`canvasControls.layout.${layout}`) : layout;

  const toggleLabels = useCallback(() => {
    const next = !labelsVisible;
    setLabelsVisible(next);
    rendererRef.current?.setLabelVisibility?.(next);
    props.onLabelsVisibleChange?.(next);
  }, [labelsVisible, rendererRef, props.onLabelsVisibleChange]);

  const toggleKeyboardHint = useCallback(() => {
    setShowKeyboardHint((v) => !v);
  }, []);

  // 隐藏条件
  if (collapsed || isMicroView || isRuntimeView) return null;

  const hasData = props.totalNodeCount > 0;
  const showStats = hasData && props.visibleNodeCount > 0;
  const showMiniMap = hasData && !!props.thumbnail;

  return (
    <div
      className="cg-canvas-controls-overlay"
      data-cg-has-data={hasData}
      data-cg-labels={labelsVisible ? 'visible' : 'hidden'}
      data-cg-canvas-focused={canvasFocused ? 'on' : 'off'}
    >
      {showStats && (
        <CanvasStatsOverlay
          visibleNodes={props.visibleNodeCount}
          visibleEdges={props.visibleEdgeCount}
          totalNodes={props.totalNodeCount}
          totalEdges={props.totalEdgeCount}
          zoom={currentZoom}
        />
      )}

      <div
        className="cg-canvas-toolbar-row"
        role="group"
        aria-label={t('canvasControls.layoutSelector')}
        style={{ display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'auto' }}
      >
        {layout && (
          <button
            type="button"
            className="cg-canvas-btn cg-canvas-layout-btn"
            onClick={handleCycleLayout}
            aria-label={t('canvasControls.layoutSelector')}
            title={t('canvasControls.layoutCycle', { l: layoutLabel })}
            style={{ width: 'auto', minWidth: 30, height: 30, padding: '0 6px', gap: 4, fontSize: 11, fontWeight: 600 }}
            data-cg-layout={layout}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2l6 3-6 3-6-3 6-3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <path d="M2 8.5l6 3 6-3M2 11.5l6 3 6-3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            <span className="cg-canvas-layout-label">{layoutLabel}</span>
          </button>
        )}
        <button
          type="button"
          className={`cg-canvas-btn cg-canvas-label-btn${labelsVisible ? '' : ' cg-is-off'}`}
          onClick={toggleLabels}
          aria-pressed={labelsVisible}
          aria-label={t('canvasControls.labelToggle')}
          title={labelsVisible ? t('canvasControls.labelsShown') : t('canvasControls.labelsHidden')}
          data-cg-labels-state={labelsVisible ? 'on' : 'off'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 11L8 4l5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4.5 13h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className={`cg-canvas-btn cg-canvas-hint-btn${showKeyboardHint ? ' is-active' : ''}`}
          onClick={toggleKeyboardHint}
          aria-pressed={showKeyboardHint}
          aria-label={t('canvasControls.keyboardHintToggle')}
          title={t('canvasControls.keyboardHintHint')}
          data-cg-keyboard-hint-toggle={showKeyboardHint ? 'on' : 'off'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.5" y="3" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M4 7h8M8 10.5a1.4 1.4 0 0 0 0-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <ZoomButtonGroup
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        onReset={handleReset}
      />

      {canvasFocused && showKeyboardHint && (
        <KeyboardHintOverlay onClose={() => setShowKeyboardHint(false)} />
      )}

      {showMiniMap && (
        <InteractiveMiniMap
          thumbnail={props.thumbnail ?? null}
          viewportInfo={props.viewportInfo ?? null}
          onFocusArea={props.onFocusArea}
          nodePositions={props.minimapNodes}
          edgeMidPoints={props.minimapEdges}
          graphBounds={props.graphBounds ?? null}
        />
      )}
    </div>
  );
});
