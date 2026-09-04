import React from 'react';
import { useT } from '../i18n/index.ts';

interface LegendProps {
  onClose: () => void;
}

const NODE_TYPES: { type: string; color: string; key: string }[] = [
  { type: 'function', color: 'var(--cg-node-function)', key: 'legend.function' },
  { type: 'class', color: 'var(--cg-node-class)', key: 'legend.class' },
  { type: 'variable', color: 'var(--cg-node-variable)', key: 'legend.variable' },
  { type: 'module', color: 'var(--cg-node-module)', key: 'legend.module' },
  { type: 'interface', color: 'var(--cg-node-interface)', key: 'legend.interface' },
];

const EDGE_TYPES: { type: string; style: 'solid' | 'dashed' | 'dotted'; color: string; key: string }[] = [
  { type: 'call', style: 'solid', color: 'var(--cg-edge-call)', key: 'legend.call' },
  { type: 'import', style: 'dashed', color: 'var(--cg-edge-import)', key: 'legend.import' },
  { type: 'extend', style: 'solid', color: 'var(--cg-edge-extend)', key: 'legend.extend' },
  { type: 'implement', style: 'dotted', color: 'var(--cg-edge-implement)', key: 'legend.implement' },
  { type: 'dependency', style: 'dashed', color: 'var(--cg-edge-dependency)', key: 'legend.dependency' },
];

export function Legend({ onClose }: LegendProps) {
  const t = useT();
  return (
    <div className="legend-panel" role="complementary" aria-label={t('legend.title')}>
      <div className="legend-header">
        <span>{t('legend.title')}</span>
        <button className="legend-close" onClick={onClose} aria-label={t('legend.close')}>×</button>
      </div>
      <div className="legend-body">
        <div className="legend-section">
          <div className="legend-section-title">{t('legend.nodes')}</div>
          {NODE_TYPES.map((n) => (
            <div className="legend-row" key={n.type}>
              <span className="legend-swatch" style={{ background: n.color }} />
              <span>{t(n.key)}</span>
            </div>
          ))}
        </div>
        <div className="legend-section">
          <div className="legend-section-title">{t('legend.edges')}</div>
          {EDGE_TYPES.map((e) => (
            <div className="legend-row" key={e.type}>
              <span className="legend-line" style={{ borderTopStyle: e.style, borderTopColor: e.color }} />
              <span>{t(e.key)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
