
import { memo } from 'react';
import { useT } from '../i18n/index.ts';
import { TOOLTIP } from '../../shared/constants.ts';
import { Portal } from './Portal.tsx';

export interface TooltipData {
  x: number;
  y: number;
  name: string;
  path: string;
  type: string;
  linksIn?: number;
  linksOut?: number;
}

export interface EdgeTooltipData {
  x: number;
  y: number;
  sourceLabel: string;
  targetLabel: string;
  edgeType: string;
}

interface GraphTooltipProps {
  data: TooltipData | EdgeTooltipData;
}

function isEdgeTooltip(data: TooltipData | EdgeTooltipData): data is EdgeTooltipData {
  return 'sourceLabel' in data;
}

function clampPosition(x: number, y: number): { left: number; top: number } {
  const maxX = window.innerWidth - TOOLTIP.WIDTH - TOOLTIP.OFFSET;
  const maxY = window.innerHeight - TOOLTIP.HEIGHT - TOOLTIP.OFFSET;
  return {
    left: Math.min(x + TOOLTIP.OFFSET, Math.max(TOOLTIP.OFFSET, maxX)),
    top: Math.min(y + TOOLTIP.OFFSET, Math.max(TOOLTIP.OFFSET, maxY)),
  };
}

export const GraphTooltip = memo(function GraphTooltip({ data }: GraphTooltipProps) {
  const t = useT();
  const pos = clampPosition(data.x, data.y);
  // 提示框用 `position: fixed` 贴视口；面板的 `contain: layout paint style` 会把它
  // 变成裁剪容器，所以必须 portal 到 body，否则提示框会在面板边缘被截断。
  if (isEdgeTooltip(data)) {
    return (
      <Portal>
        <div className="cg-tooltip" style={{ left: pos.left, top: pos.top }} role="tooltip">
          <div className="cg-tooltip-edge-source">{data.sourceLabel}</div>
          <div className="cg-tooltip-edge-arrow">→</div>
          <div className="cg-tooltip-edge-target">{data.targetLabel}</div>
          <span className="cg-tooltip-type">{t(`legend.${data.edgeType}`)}</span>
        </div>
      </Portal>
    );
  }
  return (
    <Portal>
      <div className="cg-tooltip" style={{ left: pos.left, top: pos.top }} role="tooltip">
        <div className="cg-tooltip-name">{data.name}</div>
        <div className="cg-tooltip-path">{data.path}</div>
        <span className="cg-tooltip-type">{data.type}</span>
        {(data.linksIn !== undefined || data.linksOut !== undefined) && (
          <div className="cg-tooltip-links">
            {data.linksIn !== undefined && <span className="cg-tooltip-links-in">in: {data.linksIn}</span>}
            {data.linksOut !== undefined && <span className="cg-tooltip-links-out">out: {data.linksOut}</span>}
          </div>
        )}
      </div>
    </Portal>
  );
});
