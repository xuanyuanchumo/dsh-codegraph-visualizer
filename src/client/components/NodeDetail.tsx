import React, { useMemo } from 'react';
import type { GraphNode } from '../../types/index.ts';
import { useT } from '../i18n/index.ts';
import { CloseIcon } from './Icons.tsx';

const TYPE_ICONS: Record<string, string> = {
  function: 'fn',
  class: 'C',
  variable: 'V',
  module: 'M',
  interface: 'I',
  type: 'T',
};

const TYPE_COLORS: Record<string, string> = {
  function: 'var(--cg-success)',
  class: 'var(--cg-accent-hover)',
  variable: 'var(--cg-warning)',
  module: '#ec4899',
  interface: '#14b8a6',
  type: 'var(--cg-text-tertiary)',
};

const EXPANDABLE_TYPES = new Set(['module', 'class', 'interface', 'function', 'variable', 'type']);

interface NodeDetailProps {
  node: GraphNode;
  onClose: () => void;
  isExpanded?: boolean;
  connectionCount?: number;
  onCollapse?: () => void;
}

export function NodeDetail({ node, onClose, isExpanded, connectionCount, onCollapse }: NodeDetailProps) {
  const t = useT();
  const extraProps = useMemo(
    () => Object.entries(node.properties).slice(0, 5) as [string, unknown][],
    [node],
  );
  const icon = TYPE_ICONS[node.type] ?? '?';
  const color = TYPE_COLORS[node.type] ?? 'var(--cg-accent)';
  const canExpand = EXPANDABLE_TYPES.has(node.type);

  return (
    <div className="node-detail-panel" role="complementary" aria-label={t('detail.ariaLabel')}>
      <button className="close-btn" onClick={onClose} aria-label={t('detail.close')}>
        <CloseIcon size={14} />
      </button>
      <div className="detail-header">
        <span className="detail-type-icon" style={{ color, borderColor: color }}>{icon}</span>
        <h3>{node.label}</h3>
        {isExpanded && <span className="detail-expanded-badge">EXP</span>}
      </div>
      <div className="detail-row"><span className="detail-label">{t('detail.type')}</span><span className="detail-value">{node.type}</span></div>
      <div className="detail-row"><span className="detail-label">{t('detail.file')}</span><span className="detail-value">{node.filePath}</span></div>
      <div className="detail-row"><span className="detail-label">{t('detail.line')}</span><span className="detail-value">{node.lineNumber}</span></div>
      {connectionCount !== undefined && connectionCount > 0 && (
        <div className="detail-row"><span className="detail-label">{t('detail.connections')}</span><span className="detail-value">{connectionCount}</span></div>
      )}
      {canExpand && !isExpanded && (
        <div className="detail-expand-hint">
          {t('detail.doubleClickExpand')}
        </div>
      )}
      {canExpand && isExpanded && onCollapse && (
        <div className="detail-expand-hint" style={{ background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.3)', color: 'var(--cg-success)' }}>
          {t('detail.expanded')}
          <button onClick={onCollapse} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--cg-success)', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}>
            {t('detail.collapse')}
          </button>
        </div>
      )}
      {extraProps.length > 0 && (
        <div className="detail-extra">
          <div className="detail-extra-title">{t('detail.properties')}</div>
          {extraProps.map(([k, v]) => (
            <div className="detail-row" key={k}>
              <span className="detail-label">{k}</span>
              <span className="detail-value">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
