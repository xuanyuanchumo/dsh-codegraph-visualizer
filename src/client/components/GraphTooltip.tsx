import React from 'react';

export interface TooltipData {
  x: number;
  y: number;
  name: string;
  path: string;
  type: string;
}

interface GraphTooltipProps {
  data: TooltipData;
}

export function GraphTooltip({ data }: GraphTooltipProps) {
  return (
    <div className="cg-tooltip" style={{ left: data.x + 15, top: data.y + 15 }} role="tooltip">
      <div className="tooltip-name">{data.name}</div>
      <div className="tooltip-path">{data.path}</div>
      <span className="tooltip-type">{data.type}</span>
    </div>
  );
}