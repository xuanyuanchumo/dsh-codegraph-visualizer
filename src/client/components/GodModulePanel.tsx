import { memo } from 'react';
import { useT } from '../i18n/index.ts';
import { CloseIcon } from './Icons.tsx';
import type { GodModule } from '../hooks/useAnalysisPanels.ts';

interface GodModulePanelProps {
  godModules: GodModule[];
  onClose: () => void;
  label: string;
  statsLabel: (nodes: number, edges: number) => string;
}

export const GodModulePanel = memo(function GodModulePanel({ godModules, onClose, label, statsLabel }: GodModulePanelProps) {
  const t = useT();
  return (
    <div className="cg-analysis-panel godmodule-panel" role="region" aria-label={label} aria-live="polite">
      <div className="cg-analysis-panel-header">
        <span>{label}</span>
        <button onClick={onClose} className="cg-close-btn" aria-label={t('common.close')}><CloseIcon size={14} /></button>
      </div>
      <div className="cg-analysis-panel-content">
        {godModules.map((m) => (
          <div key={m.modulePath} className="cg-godmodule-item">
            <div className="cg-godmodule-path">{m.modulePath}</div>
            <div className="cg-godmodule-stats">{statsLabel(m.nodeCount, m.edgeCount)}</div>
            <div className="cg-godmodule-suggestion">{m.suggestion}</div>
          </div>
        ))}
      </div>
    </div>
  );
})