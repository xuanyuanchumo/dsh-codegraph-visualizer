
import { memo } from 'react';

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
  const pos = clampPosition(data.x, data.y);
  if (isEdgeTooltip(data)) {
    return (
      <div className="cg-tooltip" style={{ left: pos.left, top: pos.top }} role="tooltip">
        <div className="tooltip-edge-source">{data.sourceLabel}</div>
        <div className="tooltip-edge-arrow">→</div>
        <div className="tooltip-edge-target">{data.targetLabel}</div>
        <span className="tooltip-type">{data.edgeType}</span>
      </div>
    );
  }
  return (
    <div className="cg-tooltip" style={{ left: pos.left, top: pos.top }} role="tooltip">
      <div className="tooltip-name">{data.name}</div>
      <div className="tooltip-path">{data.path}</div>
      <span className="tooltip-type">{data.type}</span>
      {(data.linksIn !== undefined || data.linksOut !== undefined) && (
        <div className="tooltip-links">
          {data.linksIn !== undefined && <span className="tooltip-links-in">in: {data.linksIn}</span>}
          {data.linksOut !== undefined && <span className="tooltip-links-out">out: {data.linksOut}</span>}
        </div>
      )}
    </div>
  );
});
