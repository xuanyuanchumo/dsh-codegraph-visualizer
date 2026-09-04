import React from 'react';

export interface TooltipData {
  x: number;
  y: number;
  name: string;
  path: string;
  type: string;
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

export function GraphTooltip({ data }: GraphTooltipProps) {
  if (isEdgeTooltip(data)) {
    return (
      <div className="cg-tooltip" style={{ left: data.x + 15, top: data.y + 15 }} role="tooltip">
        <div className="tooltip-edge-source">{data.sourceLabel}</div>
        <div className="tooltip-edge-arrow">→</div>
        <div className="tooltip-edge-target">{data.targetLabel}</div>
        <span className="tooltip-type">{data.edgeType}</span>
      </div>
    );
  }
  return (
    <div className="cg-tooltip" style={{ left: data.x + 15, top: data.y + 15 }} role="tooltip">
      <div className="tooltip-name">{data.name}</div>
      <div className="tooltip-path">{data.path}</div>
      <span className="tooltip-type">{data.type}</span>
    </div>
  );
}
