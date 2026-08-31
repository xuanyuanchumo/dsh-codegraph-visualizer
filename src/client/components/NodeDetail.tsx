import React, { useMemo } from 'react';
import type { GraphNode } from '../../types/index.ts';
import { useT } from '../i18n/index.ts';
import { CloseIcon } from './Icons.tsx';

interface NodeDetailProps {
  node: GraphNode;
  onClose: () => void;
}

export function NodeDetail({ node, onClose }: NodeDetailProps) {
  const t = useT();
  const extraProps = useMemo(
    () => Object.entries(node.properties).slice(0, 5) as [string, unknown][],
    [node],
  );
  return (
    <div className="node-detail-panel" role="complementary" aria-label={t('detail.ariaLabel')}>
      <button className="close-btn" onClick={onClose} aria-label={t('detail.close')}>
        <CloseIcon size={14} />
      </button>
      <h3>{node.label}</h3>
      <div className="detail-row"><span className="detail-label">{t('detail.type')}</span><span className="detail-value">{node.type}</span></div>
      <div className="detail-row"><span className="detail-label">{t('detail.file')}</span><span className="detail-value">{node.filePath}</span></div>
      <div className="detail-row"><span className="detail-label">{t('detail.line')}</span><span className="detail-value">{node.lineNumber}</span></div>
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