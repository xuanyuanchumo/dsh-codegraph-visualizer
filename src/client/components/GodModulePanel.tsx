import { memo } from 'react';
import { CloseIcon } from './Icons.tsx';
import type { GodModule } from '../hooks/useAnalysisPanels.ts';

interface GodModulePanelProps {
  godModules: GodModule[];
  onClose: () => void;
  label: string;
  statsLabel: (nodes: number, edges: number) => string;
}

export const GodModulePanel = memo(function GodModulePanel({ godModules, onClose, label, statsLabel }: GodModulePanelProps) {
  return (
    <div className="analysis-panel godmodule-panel" role="region" aria-label={label} aria-live="polite">
      <div className="analysis-panel-header">
        <span>{label}</span>
        <button onClick={onClose} className="cg-close-btn"><CloseIcon size={14} /></button>
      </div>
      <div className="analysis-panel-content">
        {godModules.map((m) => (
          <div key={m.modulePath} className="godmodule-item">
            <div className="godmodule-path">{m.modulePath}</div>
            <div className="godmodule-stats">{statsLabel(m.nodeCount, m.edgeCount)}</div>
            <div className="godmodule-suggestion">{m.suggestion}</div>
          </div>
        ))}
      </div>
    </div>
  );
})