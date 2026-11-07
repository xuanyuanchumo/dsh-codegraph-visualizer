
import { memo, useCallback } from 'react';
import { useT } from '../i18n/index.ts';
import type { ViewMode } from '../../types/index.ts';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { useGraphStore } from '../store/graphStore.ts';

interface LegendProps {
  viewMode: ViewMode;
  onClose: () => void;
}

const ALL_NODE_TYPES: { type: GraphNode['type']; color: string; key: string }[] = [
  { type: 'function', color: 'var(--cg-node-function)', key: 'legend.function' },
  { type: 'class', color: 'var(--cg-node-class)', key: 'legend.class' },
  { type: 'variable', color: 'var(--cg-node-variable)', key: 'legend.variable' },
  { type: 'module', color: 'var(--cg-node-module)', key: 'legend.module' },
  { type: 'interface', color: 'var(--cg-node-interface)', key: 'legend.interface' },
  { type: 'type', color: 'var(--cg-node-type)', key: 'legend.type' },
];

const ALL_EDGE_TYPES: { type: GraphEdge['type']; style: 'solid' | 'dashed' | 'dotted'; color: string; key: string }[] = [
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
  // 运行时层不渲染图谱子图（`assembleDiagram('runtime', …)` 无装配器返回 null），
  // 因此图例里没有任何节点/边类型可显示。空集是正确表达，而不是"缺省全显示"。
  runtime: new Set([]),
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
  runtime: new Set([]),
};

/**
 * 图例交互化（cycle-146 T146-4）：每一行从静态展示变成**可点击的类型开关**。
 *
 * - 点击节点类型行 ⇄ 切换 `visibleNodeTypes` 中该类型（FilterController 已消费这两个集合，
 *   因此图例开关与筛选面板共享同一状态源——两条数据路径同一实现）。
 * - 关键护栏：**不允许把一个 viewMode 的可见类型清空**。每个 viewMode 有自己的类型白名单
 *   （VIEW_MODE_*_FILTER），关闭操作只在「还有其他类型可见」时生效——最后一个可见类型
 *   是「全部隐藏」的单点故障（画布全空且没有任何图例行可点击回来），这是刻意的防呆。
 * - 视觉状态：行内 swatch 半透明 = 该类型当前被隐藏；aria-pressed 表达开关语义（可访问性）。
 */
export const Legend = memo(function Legend({ viewMode, onClose }: LegendProps) {
  const t = useT();
  const nodeTypes = ALL_NODE_TYPES.filter((n) => VIEW_MODE_NODE_FILTER[viewMode]?.has(n.type) ?? true);
  const edgeTypes = ALL_EDGE_TYPES.filter((e) => VIEW_MODE_EDGE_FILTER[viewMode]?.has(e.type) ?? true);

  const visibleNodeTypes = useGraphStore((s) => s.visibleNodeTypes);
  const visibleEdgeTypes = useGraphStore((s) => s.visibleEdgeTypes);
  const setVisibleNodeTypes = useGraphStore((s) => s.setVisibleNodeTypes);
  const setVisibleEdgeTypes = useGraphStore((s) => s.setVisibleEdgeTypes);

  const toggleNodeType = useCallback((type: GraphNode['type']) => {
    const next = new Set(visibleNodeTypes);
    if (next.has(type)) {
      // 防呆：至少保留一个可见节点类型（见组件头注释）。
      if (next.size <= 1) return;
      next.delete(type);
    } else {
      next.add(type);
    }
    setVisibleNodeTypes(next);
  }, [visibleNodeTypes, setVisibleNodeTypes]);

  const toggleEdgeType = useCallback((type: GraphEdge['type']) => {
    const next = new Set(visibleEdgeTypes);
    if (next.has(type)) {
      if (next.size <= 1) return;
      next.delete(type);
    } else {
      next.add(type);
    }
    setVisibleEdgeTypes(next);
  }, [visibleEdgeTypes, setVisibleEdgeTypes]);

  return (
    <div className="cg-legend-panel" role="complementary" aria-label={t('legend.title')}>
      <div className="cg-legend-header">
        <span>{t('legend.title')}</span>
        <button className="cg-legend-close" onClick={onClose} aria-label={t('legend.close')}>×</button>
      </div>
      <div className="cg-legend-body">
        <div className="cg-legend-section">
          <div className="cg-legend-section-title">{t('legend.nodes')}</div>
          {nodeTypes.map((n) => {
            const active = visibleNodeTypes.has(n.type);
            return (
              <button
                type="button"
                className={`cg-legend-row cg-legend-toggle${active ? '' : ' cg-legend-row-hidden'}`}
                key={n.type}
                onClick={() => toggleNodeType(n.type)}
                aria-pressed={active}
                title={t('legend.toggleHint')}
              >
                <span className="cg-legend-swatch" style={{ background: n.color }} />
                <span>{t(n.key)}</span>
              </button>
            );
          })}
        </div>
        <div className="cg-legend-section">
          <div className="cg-legend-section-title">{t('legend.edges')}</div>
          {edgeTypes.map((e) => {
            const active = visibleEdgeTypes.has(e.type);
            return (
              <button
                type="button"
                className={`cg-legend-row cg-legend-toggle${active ? '' : ' cg-legend-row-hidden'}`}
                key={e.type}
                onClick={() => toggleEdgeType(e.type)}
                aria-pressed={active}
                title={t('legend.toggleHint')}
              >
                <span className="cg-legend-line" style={{ borderTopStyle: e.style, borderTopColor: e.color }} />
                <span>{t(e.key)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
