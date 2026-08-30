import React from 'react';

interface LegendProps {
  onClose: () => void;
}

const NODE_TYPES: { type: string; color: string; label: string }[] = [
  { type: 'function', color: 'var(--cg-success)', label: 'Function' },
  { type: 'class', color: 'var(--cg-accent)', label: 'Class' },
  { type: 'variable', color: 'var(--cg-warning)', label: 'Variable' },
  { type: 'module', color: '#ec4899', label: 'Module' },
  { type: 'interface', color: '#14b8a6', label: 'Interface' },
  { type: 'type', color: '#a855f7', label: 'Type' },
];

const EDGE_TYPES: { type: string; style: 'solid' | 'dashed' | 'dotted'; label: string }[] = [
  { type: 'call', style: 'solid', label: 'calls' },
  { type: 'import', style: 'dashed', label: 'imports' },
  { type: 'extend', style: 'solid', label: 'extends' },
  { type: 'implement', style: 'dotted', label: 'implements' },
  { type: 'dependency', style: 'dashed', label: 'depends on' },
];

export function Legend({ onClose }: LegendProps) {
  return (
    <div className="legend-panel" role="complementary" aria-label="Graph legend">
      <div className="legend-header">
        <span>Legend</span>
        <button className="legend-close" onClick={onClose} aria-label="Close legend">×</button>
      </div>
      <div className="legend-body">
        <div className="legend-section">
          <div className="legend-section-title">Nodes</div>
          {NODE_TYPES.map((n) => (
            <div className="legend-row" key={n.type}>
              <span className="legend-swatch" style={{ background: n.color }} />
              <span>{n.label}</span>
            </div>
          ))}
        </div>
        <div className="legend-section">
          <div className="legend-section-title">Edges</div>
          {EDGE_TYPES.map((e) => (
            <div className="legend-row" key={e.type}>
              <span className="legend-line" style={{ borderTopStyle: e.style }} />
              <span>{e.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}