import { memo } from 'react';
import { useT } from '../i18n/index.ts';
import type { CycleInfo } from '../renderer/CycleDetector.ts';

interface CyclePanelProps {
  cycles: CycleInfo[];
  label: string;
  emptyLabel: string;
}

export const CyclePanel = memo(function CyclePanel({ cycles, label, emptyLabel }: CyclePanelProps) {
  const t = useT();
  return (
    <div className="analysis-panel cycle-panel" role="region" aria-label={label} aria-live="polite">
      <div className="analysis-panel-header">
        <span>{label}</span>
        <span className="cycle-count-badge">{cycles.length}</span>
      </div>
      <div className="analysis-panel-content">
        {cycles.length === 0 ? (
          <div className="cycle-empty">{emptyLabel}</div>
        ) : (
          cycles.map((cycle, i) => (
            <div key={i} className="cycle-item">
              <div className="cycle-item-header">
                <span className="cycle-index">#{i + 1}</span>
                <span className="cycle-length">{t('cycle.nodeCount').replace('{n}', String(cycle.length))}</span>
              </div>
              <div className="cycle-nodes">
                {cycle.nodes.map((nodeId, j) => (
                  <span key={j} className="cycle-node-tag">
                    {nodeId}
                    {j < cycle.nodes.length - 1 && <span className="cycle-arrow">→</span>}
                  </span>
                ))}
                <span className="cycle-arrow">↺</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
})