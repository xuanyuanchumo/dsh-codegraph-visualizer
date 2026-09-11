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
  module: 'var(--cg-accent)',
  interface: 'var(--cg-text-secondary)',
  type: 'var(--cg-text-tertiary)',
};

const EXPANDABLE_TYPES = new Set(['module', 'class', 'interface']);

interface NodeDetailProps {
  node: GraphNode;
  onClose: () => void;
  isExpanded?: boolean;
  connectionCount?: number;
  onCollapse?: () => void;
  onSelectFunction?: (node: GraphNode, viewMode: 'cfg' | 'flowchart' | 'sequence') => void;
  onAggregateCallChain?: (nodeId: string) => void;
}

export function NodeDetail({ node, onClose, isExpanded, connectionCount, onCollapse, onSelectFunction, onAggregateCallChain }: NodeDetailProps) {
  const t = useT();
  const icon = TYPE_ICONS[node.type] ?? '?';
  const color = TYPE_COLORS[node.type] ?? 'var(--cg-accent)';
  const canExpand = EXPANDABLE_TYPES.has(node.type);

  const signature = node.properties?.signature as string | undefined;
  const docstring = node.properties?.docstring as string | undefined;
  const exported = node.properties?.exported as boolean | undefined;
  const kind = node.properties?.kind as string | undefined;

  const extraProps = useMemo(() => {
    const knownKeys = new Set(['signature', 'docstring', 'exported', 'kind']);
    return Object.entries(node.properties)
      .filter(([k]) => !knownKeys.has(k)) as [string, unknown][];
  }, [node]);

  return (
    <div className="node-detail-panel" role="complementary" aria-label={t('detail.ariaLabel')}>
      <button className="close-btn" onClick={onClose} aria-label={t('detail.close')}>
        <CloseIcon size={14} />
      </button>
      <div className="detail-header">
        <span className="detail-type-icon" style={{ color, borderColor: color }}>{icon}</span>
        <h3>{node.label}</h3>
        {exported && <span className="detail-exported-badge">EXP</span>}
        {isExpanded && <span className="detail-expanded-badge">OPEN</span>}
      </div>
      <div className="detail-row"><span className="detail-label">{t('detail.type')}</span><span className="detail-value">{node.type}</span></div>
      {kind && kind !== node.type && (
        <div className="detail-row"><span className="detail-label">{t('detail.kind')}</span><span className="detail-value">{kind}</span></div>
      )}
      <div className="detail-row"><span className="detail-label">{t('detail.file')}</span><span className="detail-value">{node.filePath}</span></div>
      <div className="detail-row"><span className="detail-label">{t('detail.line')}</span><span className="detail-value">{node.lineNumber}</span></div>
      {connectionCount !== undefined && connectionCount > 0 && (
        <div className="detail-row"><span className="detail-label">{t('detail.connections')}</span><span className="detail-value">{connectionCount}</span></div>
      )}
      {signature && (
        <div className="detail-signature">
          <div className="detail-section-title">{t('detail.signature')}</div>
          <code className="detail-code">{signature}</code>
        </div>
      )}
      {docstring && (
        <div className="detail-docstring">
          <div className="detail-section-title">{t('detail.docstring')}</div>
          <pre className="detail-doc-text">{docstring}</pre>
        </div>
      )}
      {canExpand && !isExpanded && (
        <div className="detail-expand-hint">
          {t('detail.doubleClickExpand')}
        </div>
      )}
      {canExpand && isExpanded && onCollapse && (
        <div className="detail-expand-hint detail-expand-hint--expanded">
          {t('detail.expanded')}
          <button onClick={onCollapse} className="detail-collapse-btn">
            {t('detail.collapse')}
          </button>
        </div>
      )}
      {node.type === 'function' && onSelectFunction && (
        <div className="detail-micro-actions">
          <div className="detail-section-title">{t('detail.microViews')}</div>
          <div className="detail-micro-btns">
            <button className="detail-micro-btn" onClick={() => onSelectFunction(node, 'cfg')}>
              {t('viewMode.cfg')}
            </button>
            <button className="detail-micro-btn" onClick={() => onSelectFunction(node, 'flowchart')}>
              {t('viewMode.flowchart')}
            </button>
            <button className="detail-micro-btn" onClick={() => onSelectFunction(node, 'sequence')}>
              {t('viewMode.sequence')}
            </button>
          </div>
          {onAggregateCallChain && (
            <button className="detail-micro-btn detail-chain-btn" onClick={() => onAggregateCallChain(node.id)}>
              {t('detail.aggregateCallChain')}
            </button>
          )}
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
