import { useMemo, memo } from 'react';
import type { GraphNode } from '../../types/index.ts';
import { useT } from '../i18n/index.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { CloseIcon } from './Icons.tsx';
import { FUNCTION_BODY } from '../../shared/constants.ts';

const TYPE_ICONS: Record<string, string> = {
  function: 'fn',
  class: 'C',
  variable: 'V',
  module: 'M',
  interface: 'I',
  type: 'T',
};

const TYPE_COLORS: Record<string, string> = {
  function: 'var(--cg-node-function)',
  class: 'var(--cg-node-class)',
  variable: 'var(--cg-node-variable)',
  module: 'var(--cg-node-module)',
  interface: 'var(--cg-node-interface)',
  type: 'var(--cg-node-type)',
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

export const NodeDetail = memo(function NodeDetail({ node, onClose, isExpanded, connectionCount, onCollapse, onSelectFunction, onAggregateCallChain }: NodeDetailProps) {
  const t = useT();
  const rawNodes = useGraphStore((s) => s.rawNodes);
  const expandedNodeIds = useGraphStore((s) => s.expandedNodeIds);
  const icon = TYPE_ICONS[node.type] ?? '?';
  const color = TYPE_COLORS[node.type] ?? 'var(--cg-accent)';
  const canExpand = EXPANDABLE_TYPES.has(node.type);

  const expandedFunctionBodyCount = useMemo(() => {
    const functionIdSet = new Set<string>();
    for (const n of rawNodes) {
      if (n.type === 'function') functionIdSet.add(n.id as string);
    }
    let count = 0;
    for (const id of expandedNodeIds) {
      if (functionIdSet.has(id)) count++;
    }
    return count;
  }, [rawNodes, expandedNodeIds]);

  const isClusterNode = 'isCluster' in node && node.isCluster === true;
  const clusterChildCount = isClusterNode ? (node as { childCount?: number }).childCount ?? 0 : 0;
  const clusterChildIds = isClusterNode ? (node as { childIds?: string[] }).childIds ?? [] : [];

  const childFunctionNodes = useMemo(() => {
    if (!isClusterNode || clusterChildIds.length === 0) return [];
    const nodeMap = new Map<string, GraphNode>(rawNodes.map((n) => [n.id as string, n]));
    const result: GraphNode[] = [];
    for (const id of clusterChildIds) {
      const child = nodeMap.get(id);
      if (child && child.type === 'function') {
        result.push(child);
      }
    }
    return result.slice(0, 50);
  }, [isClusterNode, clusterChildIds, rawNodes]);

  const signature = node.properties?.signature as string | undefined;
  const docstring = node.properties?.docstring as string | undefined;
  const exported = node.properties?.exported as boolean | undefined;
  const kind = node.properties?.kind as string | undefined;

  const extraProps = useMemo(() => {
    const knownKeys = new Set(['signature', 'docstring', 'exported', 'kind']);
    return Object.entries(node.properties ?? {})
      .filter(([k]) => !knownKeys.has(k)) as [string, unknown][];
  }, [node]);

  return (
    <div className="cg-node-detail-panel" role="complementary" aria-label={t('detail.ariaLabel')} aria-live="polite">
      <button className="cg-close-btn" onClick={onClose} aria-label={t('detail.close')}>
        <CloseIcon size={14} />
      </button>
      <div className="cg-detail-header">
        <span className="cg-detail-type-icon" style={{ color, borderColor: color }}>{icon}</span>
        <h3>{node.label}</h3>
      {exported && <span className="cg-detail-exported-badge">{t('detail.exportedBadge')}</span>}
      {isExpanded && <span className="cg-detail-expanded-badge">{t('detail.expandedBadge')}</span>}
      </div>
      <div className="cg-detail-row"><span className="cg-detail-label">{t('detail.type')}</span><span className="cg-detail-value">{node.type}</span></div>
      {kind && kind !== node.type && (
        <div className="cg-detail-row"><span className="cg-detail-label">{t('detail.kind')}</span><span className="cg-detail-value">{kind}</span></div>
      )}
      <div className="cg-detail-row"><span className="cg-detail-label">{t('detail.file')}</span><span className="cg-detail-value">{node.filePath}</span></div>
      <div className="cg-detail-row"><span className="cg-detail-label">{t('detail.line')}</span><span className="cg-detail-value">{node.lineNumber}</span></div>
      {connectionCount !== undefined && connectionCount > 0 && (
        <div className="cg-detail-row"><span className="cg-detail-label">{t('detail.connections')}</span><span className="cg-detail-value">{connectionCount}</span></div>
      )}
      {signature && (
        <div className="cg-detail-signature">
          <div className="cg-detail-section-title">{t('detail.signature')}</div>
          <code className="cg-detail-code">{signature}</code>
        </div>
      )}
      {docstring && (
        <div className="cg-detail-docstring">
          <div className="cg-detail-section-title">{t('detail.docstring')}</div>
          <pre className="cg-detail-doc-text">{docstring}</pre>
        </div>
      )}
      {canExpand && !isExpanded && (
        <div className="cg-detail-expand-hint">
          {t('detail.doubleClickExpand')}
        </div>
      )}
      {canExpand && isExpanded && onCollapse && (
        <div className="cg-detail-expand-hint cg-detail-expand-hint--expanded">
          {t('detail.expanded')}
          <button onClick={onCollapse} className="cg-detail-collapse-btn">
            {t('detail.collapse')}
          </button>
        </div>
      )}
      {node.type === 'function' && onSelectFunction && (
        <div className="cg-detail-micro-actions">
          <div className="cg-detail-function-body-budget" role="status" aria-live="polite">
            <span className="cg-detail-budget-label">
              {t('detail.functionBodyBudget', { expanded: expandedFunctionBodyCount, max: FUNCTION_BODY.MAX_EXPANDED })}
            </span>
            <div className="cg-detail-budget-bar" aria-hidden="true">
              <div
                className="cg-detail-budget-fill"
                style={{ width: `${Math.min(expandedFunctionBodyCount / FUNCTION_BODY.MAX_EXPANDED * 100, 100)}%` }}
              />
            </div>
            {expandedFunctionBodyCount >= FUNCTION_BODY.MAX_EXPANDED && (
              <span className="cg-detail-budget-hint">
                {t('detail.functionBodyBudgetHint', { max: FUNCTION_BODY.MAX_EXPANDED })}
              </span>
            )}
          </div>
          <div className="cg-detail-section-title">{t('detail.microViews')}</div>
          <div className="cg-detail-micro-btns">
            <button className="cg-detail-micro-btn" onClick={() => onSelectFunction(node, 'cfg')} aria-label={t('toolbar.viewModeCfg')}>
              {t('viewMode.cfg')}
            </button>
            <button className="cg-detail-micro-btn" onClick={() => onSelectFunction(node, 'flowchart')} aria-label={t('toolbar.viewModeFlowchart')}>
              {t('viewMode.flowchart')}
            </button>
            <button className="cg-detail-micro-btn" onClick={() => onSelectFunction(node, 'sequence')} aria-label={t('toolbar.viewModeSequence')}>
              {t('viewMode.sequence')}
            </button>
          </div>
          {onAggregateCallChain && (
            <button className="cg-detail-micro-btn cg-detail-chain-btn" onClick={() => onAggregateCallChain(node.id)}>
              {t('detail.aggregateCallChain')}
            </button>
          )}
        </div>
      )}
      {node.type !== 'function' && !isClusterNode && onSelectFunction && (
        <div className="cg-detail-micro-hint">
          {t('detail.microHint')}
        </div>
      )}
      {isClusterNode && childFunctionNodes.length > 0 && onSelectFunction && (
        <div className="cg-detail-cluster-functions">
          <div className="cg-detail-section-title">{t('detail.functionsInCluster')} ({childFunctionNodes.length}{clusterChildCount > 50 ? '+' : ''})</div>
          <div className="cg-detail-function-list">
            {childFunctionNodes.map((fn) => (
              <div className="cg-detail-function-item" key={fn.id}>
                <span className="cg-detail-function-name" title={fn.filePath}>{fn.label}</span>
                <div className="cg-detail-function-micro-btns">
                  <button className="cg-detail-micro-btn cg-detail-micro-btn--small" onClick={() => onSelectFunction(fn, 'cfg')} aria-label={t('toolbar.viewModeCfg')}>
                    {t('viewMode.cfg')}
                  </button>
                  <button className="cg-detail-micro-btn cg-detail-micro-btn--small" onClick={() => onSelectFunction(fn, 'flowchart')} aria-label={t('toolbar.viewModeFlowchart')}>
                    {t('viewMode.flowchart')}
                  </button>
                  <button className="cg-detail-micro-btn cg-detail-micro-btn--small" onClick={() => onSelectFunction(fn, 'sequence')} aria-label={t('toolbar.viewModeSequence')}>
                    {t('viewMode.sequence')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {extraProps.length > 0 && (
        <div className="cg-detail-extra">
          <div className="cg-detail-extra-title">{t('detail.properties')}</div>
          {extraProps.map(([k, v]) => (
            <div className="cg-detail-row" key={k}>
              <span className="cg-detail-label">{k}</span>
              <span className="cg-detail-value">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
