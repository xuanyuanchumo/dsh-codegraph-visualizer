/**
 * GraphCanvasControls — 浮在图谱画布上的交互式控制层。
 *
 * 设计目标（用户反馈「要可交互的图谱，功能很贫乏」）：
 *  1. 缩放控制：放大 / 缩小 / 适应窗口 / 重置布局，一键可达
 *  2. 画布统计：节点数 / 边数 / 缩放级别 / 可见比例，实时白盒透明
 *  3. 交互式小地图：点击导航、视口框拖拽，不再只是静态缩略图
 *  4. 浮层定位：右下角浮层，不遮挡图谱主体，响应式自适应
 *
 * 与 StatsPanel 的关系：StatsPanel 是右侧栏面板（可开关、占席位），
 * 本组件是画布内浮层（始终可见、零席位开销），两者互补。
 *
 * @module client/components/GraphCanvasControls
 */
import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { useT } from '../i18n/index.ts';

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
}

/** 缩放步长（每次点击放大/缩小的倍率）。 */
const ZOOM_STEP = 1.3;

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

/**
 * 交互式小地图。
 *
 * 与 StatsPanel 中的静态缩略图不同：
 *  - 点击小地图任意位置 → 画布视口居中到该位置
 *  - 视口框（红色矩形）实时反映当前画布视口位置
 *  - 拖拽视口框 → 平移画布
 *
 * 这是「可交互的图谱」核心改进之一。
 */
function InteractiveMiniMap({
  thumbnail,
  viewportInfo,
  onFocusArea,
}: {
  thumbnail: string | null;
  viewportInfo: {
    zoom: number;
    pan: { x: number; y: number };
    renderedSize: { w: number; h: number };
    totalSize: { w: number; h: number };
  } | null;
  onFocusArea?: (ratioX: number, ratioY: number) => void;
}) {
  const t = useT();
  const mapRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

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

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!onFocusArea || !mapRef.current) return;
      const rect = mapRef.current.getBoundingClientRect();
      const ratioX = (e.clientX - rect.left) / rect.width;
      const ratioY = (e.clientY - rect.top) / rect.height;
      onFocusArea(Math.max(0, Math.min(1, ratioX)), Math.max(0, Math.min(1, ratioY)));
    };
    const handleMouseUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
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
    >
      <img src={thumbnail} alt="" aria-hidden="true" className="cg-canvas-minimap-img" draggable={false} />
      {viewportRect && (
        <div
          className="cg-canvas-minimap-viewport"
          style={{
            left: `${viewportRect.left}%`,
            top: `${viewportRect.top}%`,
            width: `${viewportRect.width}%`,
            height: `${viewportRect.height}%`,
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/**
 * GraphCanvasControls 主组件。
 *
 * 布局策略：
 *  - 右下角浮层，`position: absolute` 相对于 `.cg-graph-container`
 *  - 垂直排列：统计信息 → 缩放按钮组 → 小地图
 *  - `pointer-events: none` 在容器上，子元素 `pointer-events: auto`，
 *    这样浮层不拦截画布的拖拽/滚轮事件
 *
 * 可见性控制：
 *  - collapsed / isMicroView / isRuntimeView 时整体隐藏
 *  - 无数据时隐藏统计和小地图，只保留按钮组（按钮组对空画布也安全）
 */
export const GraphCanvasControls = memo(function GraphCanvasControls(props: GraphCanvasControlsProps) {
  const { rendererRef, collapsed, isMicroView, isRuntimeView } = props;

  // 实时缩放级别（用于统计显示）
  const [currentZoom, setCurrentZoom] = useState(1);

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

  // 隐藏条件
  if (collapsed || isMicroView || isRuntimeView) return null;

  const hasData = props.totalNodeCount > 0;
  const showStats = hasData && props.visibleNodeCount > 0;
  const showMiniMap = hasData && !!props.thumbnail;

  return (
    <div className="cg-canvas-controls-overlay" data-cg-has-data={hasData}>
      {showStats && (
        <CanvasStatsOverlay
          visibleNodes={props.visibleNodeCount}
          visibleEdges={props.visibleEdgeCount}
          totalNodes={props.totalNodeCount}
          totalEdges={props.totalEdgeCount}
          zoom={currentZoom}
        />
      )}
      <ZoomButtonGroup
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        onReset={handleReset}
      />
      {showMiniMap && (
        <InteractiveMiniMap
          thumbnail={props.thumbnail ?? null}
          viewportInfo={props.viewportInfo ?? null}
          onFocusArea={props.onFocusArea}
        />
      )}
    </div>
  );
});
