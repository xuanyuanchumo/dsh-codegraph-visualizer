
import { memo } from 'react';
import { useT } from '../i18n/index.ts';
import type { ViewMode } from '../../types/index.ts';

interface LegendProps {
  viewMode: ViewMode;
  onClose: () => void;
}

const ALL_NODE_TYPES: { type: string; color: string; key: string }[] = [
  { type: 'function', color: 'var(--cg-node-function)', key: 'legend.function' },
  { type: 'class', color: 'var(--cg-node-class)', key: 'legend.class' },
  { type: 'variable', color: 'var(--cg-node-variable)', key: 'legend.variable' },
  { type: 'module', color: 'var(--cg-node-module)', key: 'legend.module' },
  { type: 'interface', color: 'var(--cg-node-interface)', key: 'legend.interface' },
  { type: 'type', color: 'var(--cg-node-type)', key: 'legend.type' },
];

const ALL_EDGE_TYPES: { type: string; style: 'solid' | 'dashed' | 'dotted'; color: string; key: string }[] = [
  { type: 'call', style: 'solid', color: 'var(--cg-edge-call)', key: 'legend.call' },
  { type: 'import', style: 'dashed', color: 'var(--cg-edge-import)', key: 'legend.import' },
  { type: 'extend', style: 'solid', color: 'var(--cg-edge-extend)', key: 'legend.extend' },
  { type: 'implement', style: 'dotted', color: 'var(--cg-edge-implement)', key: 'legend.implement' },
  { type: 'dependency', style: 'dashed', color: 'var(--cg-edge-dependency)', key: 'legend.dependency' },
  { type: 'contains', style: 'dotted', color: 'var(--cg-edge-contains)', key: 'legend.contains' },
];

const VIEW_MODE_NODE_FILTER: Record<ViewMode, Set<string>> = {
  code: new Set(['function', 'class', 'variable', 'module', 'interface', 'type']),
  dependencies: new Set(['module', 'class', 'type']),
  inheritance: new Set(['class', 'interface', 'type']),
  callgraph: new Set(['function', 'class', 'module']),
  package: new Set(['module', 'class']),
  class: new Set(['class', 'interface', 'type']),
  cfg: new Set(['function']),
  flowchart: new Set(['function']),
  sequence: new Set(['function', 'class', 'module']),
};

const VIEW_MODE_EDGE_FILTER: Record<ViewMode, Set<string>> = {
  code: new Set(['call', 'import', 'extend', 'implement', 'contains']),
  dependencies: new Set(['dependency']),
  inheritance: new Set(['extend', 'implement']),
  callgraph: new Set(['call']),
  package: new Set(['contains', 'dependency']),
  class: new Set(['extend', 'implement', 'contains']),
  cfg: new Set(['call']),
  flowchart: new Set(['call']),
  sequence: new Set(['call']),
};

export const Legend = memo(function Legend({ viewMode, onClose }: LegendProps) {
  const t = useT();
  const nodeTypes = ALL_NODE_TYPES.filter((n) => VIEW_MODE_NODE_FILTER[viewMode]?.has(n.type) ?? true);
  const edgeTypes = ALL_EDGE_TYPES.filter((e) => VIEW_MODE_EDGE_FILTER[viewMode]?.has(e.type) ?? true);

  return (
    <div className="cg-legend-panel" role="complementary" aria-label={t('legend.title')}>
      <div className="cg-legend-header">
        <span>{t('legend.title')}</span>
        <button className="cg-legend-close" onClick={onClose} aria-label={t('legend.close')}>×</button>
      </div>
      <div className="cg-legend-body">
        <div className="cg-legend-section">
          <div className="cg-legend-section-title">{t('legend.nodes')}</div>
          {nodeTypes.map((n) => (
            <div className="cg-legend-row" key={n.type}>
              <span className="cg-legend-swatch" style={{ background: n.color }} />
              <span>{t(n.key)}</span>
            </div>
          ))}
        </div>
        <div className="cg-legend-section">
          <div className="cg-legend-section-title">{t('legend.edges')}</div>
          {edgeTypes.map((e) => (
            <div className="cg-legend-row" key={e.type}>
              <span className="cg-legend-line" style={{ borderTopStyle: e.style, borderTopColor: e.color }} />
              <span>{t(e.key)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
