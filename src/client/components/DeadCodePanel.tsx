import { memo, useState } from 'react';
import { CloseIcon } from './Icons.tsx';
import { useT } from '../i18n/index.ts';
import type { DeadCodeResult, DeadCodeCategory, DeadCodeConfidence } from '../../shared/analysis/DeadCodeAnalyzer.ts';

interface DeadCodePanelProps {
  result: DeadCodeResult;
  onClose: () => void;
  label: string;
  onSelectNode?: (nodeId: string) => void;
}

export const DeadCodePanel = memo(function DeadCodePanel({ result, onClose, label, onSelectNode }: DeadCodePanelProps) {
  const t = useT();
  const [filter, setFilter] = useState<DeadCodeCategory | 'all'>('all');
  const [confidenceFilter, setConfidenceFilter] = useState<DeadCodeConfidence | 'all'>('all');

  const filtered = result.deadNodes.filter((d) => {
    if (filter !== 'all' && d.category !== filter) return false;
    if (confidenceFilter !== 'all' && d.confidence !== confidenceFilter) return false;
    return true;
  });

  return (
    <div className="cg-analysis-panel cg-deadcode-panel" role="region" aria-label={label} aria-live="polite">
      <div className="cg-analysis-panel-header">
        <span>{label}</span>
        <span className="cg-deadcode-count-badge">{result.stats.total}</span>
        <button onClick={onClose} className="cg-close-btn" aria-label={t('common.close')}>
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="cg-analysis-panel-content">
        <div className="cg-deadcode-stats">
          <div className="cg-deadcode-stat-row">
            <span className="cg-deadcode-stat-badge cg-confirmed">{t('deadcode.confirmed')}</span>
            <span className="cg-deadcode-stat-count">{result.stats.confirmed}</span>
          </div>
          <div className="cg-deadcode-stat-row">
            <span className="cg-deadcode-stat-badge cg-suspected">{t('deadcode.suspected')}</span>
            <span className="cg-deadcode-stat-count">{result.stats.suspected}</span>
          </div>
        </div>
        <div className="cg-deadcode-filters">
          <select value={filter} onChange={(e) => setFilter(e.target.value as DeadCodeCategory | 'all')}>
            <option value="all">{t('deadcode.filterAll')}</option>
            <option value="unreachable">{t('deadcode.unreachable')}</option>
            <option value="no-incoming">{t('deadcode.noIncoming')}</option>
            <option value="orphan">{t('deadcode.orphan')}</option>
          </select>
          <select value={confidenceFilter} onChange={(e) => setConfidenceFilter(e.target.value as DeadCodeConfidence | 'all')}>
            <option value="all">{t('deadcode.filterAll')}</option>
            <option value="confirmed">{t('deadcode.confirmed')}</option>
            <option value="suspected">{t('deadcode.suspected')}</option>
          </select>
        </div>
        {filtered.length === 0 ? (
          <div className="cg-deadcode-empty">{t('deadcode.empty')}</div>
        ) : (
          filtered.slice(0, 50).map((d) => (
            <div
              key={d.nodeId}
              className={`cg-deadcode-item cg-${d.confidence}`}
              onClick={() => onSelectNode?.(d.nodeId)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectNode?.(d.nodeId); } }}
              role="button"
              tabIndex={0}
            >
              <span className={`cg-deadcode-category-badge cg-${d.category}`}>{d.category}</span>
              <span className="cg-deadcode-label">{d.label}</span>
              <span className="cg-deadcode-filepath">{d.filePath}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
});