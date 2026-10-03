import { memo } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import type { HotspotNode } from '../hooks/useAnalysisPanels.ts';

interface HotspotPanelProps {
  hotspotNodes: HotspotNode[];
  onClose: () => void;
  label: string;
}

export const HotspotPanel = memo(function HotspotPanel({ hotspotNodes, onClose, label }: HotspotPanelProps) {
  return (
    <AnalysisPanelShell variant="hotspot" label={label} onClose={onClose}>
      {hotspotNodes.slice(0, 20).map((h) => (
        <div key={h.nodeId} className={`cg-hotspot-item cg-${h.level}`}>
          <span className="cg-hotspot-level-badge">{h.level}</span>
          <span className="cg-hotspot-label">{h.label}</span>
          <span className="cg-hotspot-indegree">{h.indegree}</span>
        </div>
      ))}
    </AnalysisPanelShell>
  );
});