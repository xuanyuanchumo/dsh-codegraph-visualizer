import { memo } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import type { ImpactStats } from '../hooks/useAnalysisPanels.ts';

interface ImpactPanelProps {
  impactStats: ImpactStats;
  label: string;
  totalLabel: string;
  onClose: () => void;
}

export const ImpactPanel = memo(function ImpactPanel({ impactStats, label, totalLabel, onClose }: ImpactPanelProps) {
  return (
    <AnalysisPanelShell variant="impact" label={label} onClose={onClose}>
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
    </AnalysisPanelShell>
  );
});