
import type { ImpactStats } from '../hooks/useAnalysisPanels.ts';

interface ImpactPanelProps {
  impactStats: ImpactStats;
  label: string;
  totalLabel: string;
}

export function ImpactPanel({ impactStats, label, totalLabel }: ImpactPanelProps) {
  return (
    <div className="analysis-panel impact-panel" role="region" aria-label={label} aria-live="polite">
      <div className="analysis-panel-header">
        <span>{label}</span>
      </div>
      <div className="analysis-panel-content">
        <div className="impact-stat-row">
          <span className="impact-stat-badge d1">D1</span>
          <span className="impact-stat-count">{impactStats.d1}</span>
        </div>
        <div className="impact-stat-row">
          <span className="impact-stat-badge d2">D2</span>
          <span className="impact-stat-count">{impactStats.d2}</span>
        </div>
        <div className="impact-stat-row">
          <span className="impact-stat-badge d3">D3</span>
          <span className="impact-stat-count">{impactStats.d3}</span>
        </div>
        <div className="impact-stat-total">{totalLabel}: {impactStats.total}</div>
      </div>
    </div>
  );
}