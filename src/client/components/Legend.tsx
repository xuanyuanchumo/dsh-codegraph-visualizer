import React from 'react';
import { useT } from '../i18n/index.ts';

interface LegendProps {
  onClose: () => void;
}

const NODE_TYPES: { type: string; color: string; key: string }[] = [
  { type: 'function', color: 'var(--cg-success)', key: 'legend.function' },
  { type: 'class', color: 'var(--cg-accent)', key: 'legend.class' },
  { type: 'variable', color: 'var(--cg-warning)', key: 'legend.variable' },
  { type: 'module', color: '#ec4899', key: 'legend.module' },
  { type: 'interface', color: '#14b8a6', key: 'legend.interface' },
  { type: 'type', color: '#a855f7', key: 'legend.type' },
];

const EDGE_TYPES: { type: string; style: 'solid' | 'dashed' | 'dotted'; key: string }[] = [
  { type: 'call', style: 'solid', key: 'legend.call' },
  { type: 'import', style: 'dashed', key: 'legend.import' },
  { type: 'extend', style: 'solid', key: 'legend.extend' },
  { type: 'implement', style: 'dotted', key: 'legend.implement' },
  { type: 'dependency', style: 'dashed', key: 'legend.dependency' },
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
              <span className="legend-line" style={{ borderTopStyle: e.style }} />
              <span>{t(e.key)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
