import { memo, useState } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import type { GraphNode, GraphEdge } from '../../types/index.ts';

const NODE_TYPES: GraphNode['type'][] = ['function', 'class', 'variable', 'module', 'interface'];
const EDGE_TYPES: GraphEdge['type'][] = ['call', 'extend', 'implement', 'import', 'dependency', 'contains'];

interface FilterPanelProps {
  onClose: () => void;
}

export const FilterPanel = memo(function FilterPanel({ onClose }: FilterPanelProps) {
  const t = useT();
  const fanInThreshold = useGraphStore((s) => s.fanInThreshold);
  const fanOutThreshold = useGraphStore((s) => s.fanOutThreshold);
  const visibleNodeTypes = useGraphStore((s) => s.visibleNodeTypes);
  const visibleEdgeTypes = useGraphStore((s) => s.visibleEdgeTypes);
  const setFanInThreshold = useGraphStore((s) => s.setFanInThreshold);
  const setFanOutThreshold = useGraphStore((s) => s.setFanOutThreshold);
  const setVisibleNodeTypes = useGraphStore((s) => s.setVisibleNodeTypes);
  const setVisibleEdgeTypes = useGraphStore((s) => s.setVisibleEdgeTypes);
  const pathFilterInclude = useGraphStore((s) => s.pathFilterInclude);
  const pathFilterExclude = useGraphStore((s) => s.pathFilterExclude);
  const setPathFilter = useGraphStore((s) => s.setPathFilter);

  const [includeInput, setIncludeInput] = useState(pathFilterInclude ?? '');
  const [excludeInput, setExcludeInput] = useState(pathFilterExclude ?? '');

  const toggleNodeType = (type: GraphNode['type']) => {
    const next = new Set(visibleNodeTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setVisibleNodeTypes(next);
  };

  const toggleEdgeType = (type: GraphEdge['type']) => {
    const next = new Set(visibleEdgeTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setVisibleEdgeTypes(next);
  };

  const resetAll = () => {
    setFanInThreshold(0);
    setFanOutThreshold(0);
    setVisibleNodeTypes(new Set(NODE_TYPES));
    setVisibleEdgeTypes(new Set(EDGE_TYPES));
    setPathFilter(null, null);
    setIncludeInput('');
    setExcludeInput('');
  };

  const applyPathFilter = () => {
    const inc = includeInput.trim() || null;
    const exc = excludeInput.trim() || null;
    setPathFilter(inc, exc);
  };

  const clearPathFilter = () => {
    setIncludeInput('');
    setExcludeInput('');
    setPathFilter(null, null);
  };

  return (
    <div className="cg-filter-panel" role="region" aria-label={t('filterPanel.title')}>
      <div className="cg-filter-panel-header">
        <span className="cg-filter-panel-title">{t('filterPanel.title')}</span>
        <button className="cg-filter-panel-close" onClick={onClose} aria-label={t('filterPanel.close')}>×</button>
      </div>

      <div className="cg-filter-panel-section">
        <div className="cg-filter-section-label">{t('filterPanel.pathFilter')}</div>
        <input
          id="cg-filter-include"
          name="cg-filter-include"
          type="text"
          className="cg-filter-path-input"
          placeholder={t('filterPanel.includePlaceholder')}
          value={includeInput}
          onChange={(e) => setIncludeInput(e.target.value)}
          aria-label={t('filterPanel.includeLabel')}
        />
        <input
          id="cg-filter-exclude"
          name="cg-filter-exclude"
          type="text"
          className="cg-filter-path-input"
          placeholder={t('filterPanel.excludePlaceholder')}
          value={excludeInput}
          onChange={(e) => setExcludeInput(e.target.value)}
          aria-label={t('filterPanel.excludeLabel')}
        />

        <div className="cg-filter-path-actions">
          <button className="cg-filter-quick-btn" onClick={applyPathFilter}>{t('filterPanel.applyPath')}</button>
          <button className="cg-filter-quick-btn" onClick={clearPathFilter}>{t('filterPanel.clearPath')}</button>
        </div>
        <div className="cg-filter-hint">{t('filterPanel.pathHint')}</div>
      </div>

      <div className="cg-filter-panel-section">
        <div className="cg-filter-section-label">{t('filterPanel.fanIn')}</div>
        <div className="cg-filter-slider-row">
          <input
            id="cg-filter-fanin"
            name="cg-filter-fanin"
            type="range"
            min={0}
            max={50}
            value={fanInThreshold}
            onChange={(e) => setFanInThreshold(Number(e.target.value))}
            aria-label={t('filterPanel.fanIn')}
          />
          <span className="cg-filter-slider-value">{fanInThreshold}</span>
        </div>
        <div className="cg-filter-hint">{t('filterPanel.fanInHint')}</div>
      </div>

      <div className="cg-filter-panel-section">
        <div className="cg-filter-section-label">{t('filterPanel.fanOut')}</div>
        <div className="cg-filter-slider-row">
          <input
            id="cg-filter-fanout"
            name="cg-filter-fanout"
            type="range"
            min={0}
            max={50}
            value={fanOutThreshold}
            onChange={(e) => setFanOutThreshold(Number(e.target.value))}
            aria-label={t('filterPanel.fanOut')}
          />
          <span className="cg-filter-slider-value">{fanOutThreshold}</span>
        </div>
        <div className="cg-filter-hint">{t('filterPanel.fanOutHint')}</div>
      </div>

      <div className="cg-filter-panel-section">
        <div className="cg-filter-section-label">{t('filterPanel.nodeTypes')}</div>
        <div className="cg-filter-checkbox-grid">
          {NODE_TYPES.map((type) => (
            <label key={type} className="cg-filter-checkbox-item">
              <input
                type="checkbox"
                checked={visibleNodeTypes.has(type)}
                onChange={() => toggleNodeType(type)}
              />
              <span className="cg-filter-type-badge" data-type={type}>{t(`filter.${type}`)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="cg-filter-panel-section">
        <div className="cg-filter-section-label">{t('filterPanel.edgeTypes')}</div>
        <div className="cg-filter-checkbox-grid">
          {EDGE_TYPES.map((type) => (
            <label key={type} className="cg-filter-checkbox-item">
              <input
                type="checkbox"
                checked={visibleEdgeTypes.has(type)}
                onChange={() => toggleEdgeType(type)}
              />
              <span className="cg-filter-edge-badge" data-type={type}>{t(`legend.${type}`)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="cg-filter-panel-section">
        <div className="cg-filter-section-label">{t('filterPanel.quickActions')}</div>
        <div className="cg-filter-quick-actions">
          <button
            className="cg-filter-quick-btn"
            onClick={() => setFanInThreshold(fanInThreshold > 0 ? 0 : 1)}
            title={t('filterPanel.orphansHint')}
          >
            {t('filterPanel.hideOrphans')}
          </button>
          <button
            className="cg-filter-quick-btn"
            onClick={() => setFanOutThreshold(fanOutThreshold > 0 ? 0 : 1)}
            title={t('filterPanel.leavesHint')}
          >
            {t('filterPanel.hideLeaves')}
          </button>
        </div>
      </div>

      <button className="cg-filter-reset-btn" onClick={resetAll}>{t('filterPanel.reset')}</button>
    </div>
  );
});