import { memo } from 'react';
import type { ImpactStats } from '../hooks/useAnalysisPanels.ts';

interface ImpactPanelProps {
  impactStats: ImpactStats;
  label: string;
  totalLabel: string;
}

export const ImpactPanel = memo(function ImpactPanel({ impactStats, label, totalLabel }: ImpactPanelProps) {
  return (
    <div className="cg-analysis-panel cg-impact-panel" role="region" aria-label={label} aria-live="polite">
      <div className="cg-analysis-panel-header">
        <span>{label}</span>
      </div>
      <div className="cg-analysis-panel-content">
        <div className="cg-impact-stat-row">
          <span className="cg-impact-stat-badge cg-d1">D1</span>
          <span className="cg-impact-stat-count">{impactStats.d1}</span>
        </div>
        <div className="cg-impact-stat-row">
          <span className="cg-impact-stat-badge cg-d2">D2</span>
          <span className="cg-impact-stat-count">{impactStats.d2}</span>
        </div>
        <div className="cg-impact-stat-row">
          <span className="cg-impact-stat-badge cg-d3">D3</span>
          <span className="cg-impact-stat-count">{impactStats.d3}</span>
        </div>
        <div className="cg-impact-stat-total">{totalLabel}: {impactStats.total}</div>
      </div>
    </div>
  );
})