import { memo } from 'react';
import { CloseIcon } from './Icons.tsx';
import type { HotspotNode } from '../hooks/useAnalysisPanels.ts';
import { useT } from '../i18n/index.ts';

interface HotspotPanelProps {
  hotspotNodes: HotspotNode[];
  onClose: () => void;
  label: string;
}

export const HotspotPanel = memo(function HotspotPanel({ hotspotNodes, onClose, label }: HotspotPanelProps) {
  const t = useT();
  return (
    <div className="cg-analysis-panel hotspot-panel" role="region" aria-label={label} aria-live="polite">
      <div className="cg-analysis-panel-header">
        <span>{label}</span>
        <button onClick={onClose} className="cg-close-btn" aria-label={t('hotspot.close')}><CloseIcon size={14} /></button>
      </div>
      <div className="cg-analysis-panel-content">
        {hotspotNodes.slice(0, 20).map((h) => (
          <div key={h.nodeId} className={`cg-hotspot-item cg-${h.level}`}>
            <span className="cg-hotspot-level-badge">{h.level}</span>
            <span className="cg-hotspot-label">{h.label}</span>
            <span className="cg-hotspot-indegree">{h.indegree}</span>
          </div>
        ))}
      </div>
    </div>
  );
})