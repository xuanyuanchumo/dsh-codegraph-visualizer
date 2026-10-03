import { memo } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import { useT } from '../i18n/index.ts';
import type { CycleInfo } from '../renderer/CycleDetector.ts';

interface CyclePanelProps {
  cycles: CycleInfo[];
  label: string;
  emptyLabel: string;
  onClose: () => void;
}

export const CyclePanel = memo(function CyclePanel({ cycles, label, emptyLabel, onClose }: CyclePanelProps) {
  const t = useT();
  return (
    <AnalysisPanelShell
      variant="cycle"
      label={label}
      onClose={onClose}
      badge={<span className="cg-cycle-count-badge">{cycles.length}</span>}
    >
      {cycles.length === 0 ? (
        <div className="cg-cycle-empty">{emptyLabel}</div>
      ) : (
        cycles.map((cycle, i) => (
          <div key={i} className="cg-cycle-item">
            <div className="cg-cycle-item-header">
              <span className="cg-cycle-index">#{i + 1}</span>
              <span className="cg-cycle-length">{t('cycle.nodeCount').replace('{n}', String(cycle.length))}</span>
            </div>
            <div className="cg-cycle-nodes">
              {cycle.nodes.map((nodeId, j) => (
                <span key={j} className="cg-cycle-node-tag">
                  {nodeId}
                  {j < cycle.nodes.length - 1 && <span className="cg-cycle-arrow">→</span>}
                </span>
              ))}
              <span className="cg-cycle-arrow">↺</span>
            </div>
          </div>
        ))
      )}
    </AnalysisPanelShell>
  );
});
