
import { CloseIcon } from './Icons.tsx';
import type { HotspotNode } from '../hooks/useAnalysisPanels.ts';

interface HotspotPanelProps {
  hotspotNodes: HotspotNode[];
  onClose: () => void;
  label: string;
}

export function HotspotPanel({ hotspotNodes, onClose, label }: HotspotPanelProps) {
  return (
    <div className="analysis-panel hotspot-panel" role="region" aria-label={label}>
      <div className="analysis-panel-header">
        <span>{label}</span>
        <button onClick={onClose} className="cg-close-btn"><CloseIcon size={14} /></button>
      </div>
      <div className="analysis-panel-content">
        {hotspotNodes.slice(0, 20).map((h) => (
          <div key={h.nodeId} className={`hotspot-item ${h.level}`}>
            <span className="hotspot-level-badge">{h.level}</span>
            <span className="hotspot-label">{h.label}</span>
            <span className="hotspot-indegree">{h.indegree}</span>
          </div>
        ))}
      </div>
    </div>
  );
}