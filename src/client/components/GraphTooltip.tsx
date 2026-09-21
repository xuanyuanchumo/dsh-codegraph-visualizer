
import { memo } from 'react';
import { useT } from '../i18n/index.ts';

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
  const offset = 15;
  const tooltipWidth = 200;
  const tooltipHeight = 80;
  const maxX = window.innerWidth - tooltipWidth - offset;
  const maxY = window.innerHeight - tooltipHeight - offset;
  return {
    left: Math.min(x + offset, Math.max(offset, maxX)),
    top: Math.min(y + offset, Math.max(offset, maxY)),
  };
}

export const GraphTooltip = memo(function GraphTooltip({ data }: GraphTooltipProps) {
  const t = useT();
  const pos = clampPosition(data.x, data.y);
  if (isEdgeTooltip(data)) {
    return (
      <div className="cg-tooltip" style={{ left: pos.left, top: pos.top }} role="tooltip">
        <div className="cg-tooltip-edge-source">{data.sourceLabel}</div>
        <div className="cg-tooltip-edge-arrow">→</div>
        <div className="cg-tooltip-edge-target">{data.targetLabel}</div>
        <span className="cg-tooltip-type">{t(`legend.${data.edgeType}`)}</span>
      </div>
    );
  }
  return (
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
  );
});
