import { memo } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import type { GodModule } from '../hooks/useAnalysisPanels.ts';

interface GodModulePanelProps {
  godModules: GodModule[];
  onClose: () => void;
  label: string;
  statsLabel: (nodes: number, edges: number) => string;
}

export const GodModulePanel = memo(function GodModulePanel({ godModules, onClose, label, statsLabel }: GodModulePanelProps) {
  return (
    <AnalysisPanelShell variant="godmodule" label={label} onClose={onClose}>
      {godModules.map((m) => (
        <div key={m.modulePath} className="cg-godmodule-item">
          <div className="cg-godmodule-path">{m.modulePath}</div>
          <div className="cg-godmodule-stats">{statsLabel(m.nodeCount, m.edgeCount)}</div>
          <div className="cg-godmodule-suggestion">{m.suggestion}</div>
        </div>
      ))}
    </AnalysisPanelShell>
  );
});