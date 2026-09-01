import React from 'react';
import { useT } from '../i18n/index.ts';
import { CloseIcon } from './Icons.tsx';

interface StatsPanelProps {
  counts: { function: number; class: number; variable: number; module: number; interface: number };
  onClose: () => void;
}

export function StatsPanel({ counts, onClose }: StatsPanelProps) {
  const t = useT();
  const total = counts.function + counts.class + counts.variable + counts.module + counts.interface;
  return (
    <div className="mini-map" role="complementary" aria-label={t('minimap.title')}>
      <div className="mini-map-header">
        <span>{t('minimap.title')}</span>
        <button
          onClick={onClose}
          aria-label={t('minimap.close')}
          style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: '0 4px' }}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="mini-map-content">
        <div className="mini-map-stats">
          <div><span className="dot" style={{ background: 'var(--cg-success)' }} />{t('minimap.functions')}: {counts.function}</div>
          <div><span className="dot" style={{ background: 'var(--cg-accent)' }} />{t('minimap.classes')}: {counts.class}</div>
          <div><span className="dot" style={{ background: 'var(--cg-warning)' }} />{t('minimap.variables')}: {counts.variable}</div>
          <div><span className="dot" style={{ background: '#ec4899' }} />{t('minimap.modules')}: {counts.module}</div>
          <div><span className="dot" style={{ background: '#14b8a6' }} />{t('minimap.interfaces')}: {counts.interface}</div>
        </div>
        <div className="mini-map-total">{t('minimap.total')}: {total}</div>
      </div>
    </div>
  );
}