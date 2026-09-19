import React from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import type { GraphNode, GraphEdge } from '../../types/index.ts';

const NODE_TYPES: GraphNode['type'][] = ['function', 'class', 'variable', 'module', 'interface'];
const EDGE_TYPES: GraphEdge['type'][] = ['call', 'extend', 'implement', 'import', 'dependency', 'contains'];

interface FilterPanelProps {
  onClose: () => void;
}

export function FilterPanel({ onClose }: FilterPanelProps) {
  const t = useT();
  const fanInThreshold = useGraphStore((s) => s.fanInThreshold);
  const fanOutThreshold = useGraphStore((s) => s.fanOutThreshold);
  const visibleNodeTypes = useGraphStore((s) => s.visibleNodeTypes);
  const visibleEdgeTypes = useGraphStore((s) => s.visibleEdgeTypes);
  const setFanInThreshold = useGraphStore((s) => s.setFanInThreshold);
  const setFanOutThreshold = useGraphStore((s) => s.setFanOutThreshold);
  const setVisibleNodeTypes = useGraphStore((s) => s.setVisibleNodeTypes);
  const setVisibleEdgeTypes = useGraphStore((s) => s.setVisibleEdgeTypes);

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
    setVisibleNodeTypes(new Set());
    setVisibleEdgeTypes(new Set());
  };

  return (
    <div className="filter-panel" role="region" aria-label={t('filterPanel.title')}>
      <div className="filter-panel-header">
        <span className="filter-panel-title">{t('filterPanel.title')}</span>
        <button className="filter-panel-close" onClick={onClose} aria-label={t('filterPanel.close')}>×</button>
      </div>

      <div className="filter-panel-section">
        <div className="filter-section-label">{t('filterPanel.fanIn')}</div>
        <div className="filter-slider-row">
          <input
            type="range"
            min={0}
            max={50}
            value={fanInThreshold}
            onChange={(e) => setFanInThreshold(Number(e.target.value))}
            aria-label={t('filterPanel.fanIn')}
          />
          <span className="filter-slider-value">{fanInThreshold}</span>
        </div>
        <div className="filter-hint">{t('filterPanel.fanInHint')}</div>
      </div>

      <div className="filter-panel-section">
        <div className="filter-section-label">{t('filterPanel.fanOut')}</div>
        <div className="filter-slider-row">
          <input
            type="range"
            min={0}
            max={50}
            value={fanOutThreshold}
            onChange={(e) => setFanOutThreshold(Number(e.target.value))}
            aria-label={t('filterPanel.fanOut')}
          />
          <span className="filter-slider-value">{fanOutThreshold}</span>
        </div>
        <div className="filter-hint">{t('filterPanel.fanOutHint')}</div>
      </div>

      <div className="filter-panel-section">
        <div className="filter-section-label">{t('filterPanel.nodeTypes')}</div>
        <div className="filter-checkbox-grid">
          {NODE_TYPES.map((type) => (
            <label key={type} className="filter-checkbox-item">
              <input
                type="checkbox"
                checked={visibleNodeTypes.has(type)}
                onChange={() => toggleNodeType(type)}
              />
              <span className="filter-type-badge" data-type={type}>{t(`filter.${type}`)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="filter-panel-section">
        <div className="filter-section-label">{t('filterPanel.edgeTypes')}</div>
        <div className="filter-checkbox-grid">
          {EDGE_TYPES.map((type) => (
            <label key={type} className="filter-checkbox-item">
              <input
                type="checkbox"
                checked={visibleEdgeTypes.has(type)}
                onChange={() => toggleEdgeType(type)}
              />
              <span className="filter-edge-badge" data-type={type}>{type}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="filter-panel-section">
        <div className="filter-section-label">{t('filterPanel.title')}</div>
        <div className="filter-quick-actions">
          <button
            className="filter-quick-btn"
            onClick={() => setFanInThreshold(fanInThreshold > 0 ? 0 : 1)}
            title={t('filterPanel.orphansHint')}
          >
            {t('filterPanel.hideOrphans')}
          </button>
          <button
            className="filter-quick-btn"
            onClick={() => setFanOutThreshold(fanOutThreshold > 0 ? 0 : 1)}
            title={t('filterPanel.leavesHint')}
          >
            {t('filterPanel.hideLeaves')}
          </button>
        </div>
      </div>

      <button className="filter-reset-btn" onClick={resetAll}>{t('filterPanel.reset')}</button>
    </div>
  );
}