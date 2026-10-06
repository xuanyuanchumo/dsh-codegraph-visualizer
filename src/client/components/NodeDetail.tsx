import { useCallback, useEffect, useMemo, useState, memo } from 'react';
import type { GraphNode } from '../../types/index.ts';
import { useT } from '../i18n/index.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { CloseIcon } from './Icons.tsx';
import { NodeEdgeList } from './NodeEdgeList.tsx';
import { FUNCTION_BODY } from '../../shared/constants.ts';
import { useExpandedFunctionBodyCount } from '../hooks/useExpandedFunctionBodyCount.ts';
import { collectFunctionBodyCandidates } from '../utils/functionBudgetCandidates.ts';

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
  /**
   * 「只看调用链」的轻通路：只高亮调用链，不切换视图、不重建子图。
   *
   * 刻意不用 onAggregateCallChain（那条通路会调 assembleMultiFunction 并把
   * viewMode 强制改成 'cfg'），因为文档里的语义是「只看」，而「看」不应改写
   * 用户当前的视图选择。回调由 GraphPanel 注入，因为高亮需要 rendererRef。
   */
  onHighlightCallChain?: (nodeId: string) => void;
}

export const NodeDetail = memo(function NodeDetail({ node, onClose, isExpanded, connectionCount, onCollapse, onSelectFunction, onAggregateCallChain, onHighlightCallChain }: NodeDetailProps) {
  const t = useT();
  const rawNodes = useGraphStore((s) => s.rawNodes);
  const rawEdges = useGraphStore((s) => s.rawEdges);
  const expandedNodeIds = useGraphStore((s) => s.expandedNodeIds);
  const expandNode = useGraphStore((s) => s.expandNode);
  const pinNode = useGraphStore((s) => s.pinNode);
  const unpinNode = useGraphStore((s) => s.unpinNode);
  const batchExpandNodes = useGraphStore((s) => s.batchExpandNodes);
  const collapseNode = useGraphStore((s) => s.collapseNode);

  const icon = TYPE_ICONS[node.type] ?? '?';
  const color = TYPE_COLORS[node.type] ?? 'var(--cg-accent)';
  const canExpand = EXPANDABLE_TYPES.has(node.type);

  const { expandedFunctionCount: expandedFunctionBodyCount, totalFunctionCount } = useExpandedFunctionBodyCount();

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
    return result;
  }, [isClusterNode, clusterChildIds, rawNodes]);

  const displayedChildFunctions = childFunctionNodes.slice(0, 50);
  const hiddenChildFunctionCount = childFunctionNodes.length - displayedChildFunctions.length;

  const signature = node.properties?.signature as string | undefined;
  const docstring = node.properties?.docstring as string | undefined;
  const exported = node.properties?.exported as boolean | undefined;
  const kind = node.properties?.kind as string | undefined;

  const extraProps = useMemo(() => {
    const knownKeys = new Set(['signature', 'docstring', 'exported', 'kind']);
    return Object.entries(node.properties ?? {})
      .filter(([k]) => !knownKeys.has(k)) as [string, unknown][];
  }, [node]);

  // ── 函数体展开预算的出口（docs/图谱按需加载.md 第五节 + 风险 8） ──────────────
  // 候选顺序由 collectFunctionBodyCandidates 决定（自身 → 聚类子函数 → 调用邻居 → 兜底）。
  const functionCandidates = useMemo(
    () => collectFunctionBodyCandidates({ node, rawNodes, rawEdges, clusterChildIds }),
    [node, rawNodes, rawEdges, clusterChildIds],
  );
  // 已展开的候选（供「收起已展开」用）；未展开的候选（供「展开更多 / 展开全部」用）。
  const expandedFunctionIds = useMemo(
    () => functionCandidates.filter((id) => expandedNodeIds.has(id)),
    [functionCandidates, expandedNodeIds],
  );
  const expandableFunctionIds = useMemo(
    () => functionCandidates.filter((id) => !expandedNodeIds.has(id)),
    [functionCandidates, expandedNodeIds],
  );
  const nextExpandableId = expandableFunctionIds[0];

  // 「展开全部」会一次性把多个函数体钉住并展开，属于有代价的批量动作，
  // 因此走内联二次确认（不用 window.confirm：它会阻塞渲染器且无法在测试里驱动）。
  const [confirmingExpandAll, setConfirmingExpandAll] = useState(false);
  useEffect(() => {
    setConfirmingExpandAll(false);
  }, [node.id]);

  const handleExpandMore = useCallback(() => {
    if (nextExpandableId) expandNode(nextExpandableId);
  }, [nextExpandableId, expandNode]);

  // 「展开全部」= 先 pin 再批量展开。pin 是必须的：enforceFunctionBodyBudget 会按插入序
  // 驱逐超出 MAX_EXPANDED 的函数体，只有 pinned 豁免才能让用户显式确认过的批量展开存活。
  const handleExpandAll = useCallback(() => {
    for (const id of expandableFunctionIds) pinNode(id);
    batchExpandNodes(expandableFunctionIds);
    setConfirmingExpandAll(false);
  }, [expandableFunctionIds, pinNode, batchExpandNodes]);

  const handleCollapseExpanded = useCallback(() => {
    for (const id of expandedFunctionIds) {
      unpinNode(id);
      collapseNode(id);
    }
  }, [expandedFunctionIds, unpinNode, collapseNode]);

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
      {!isClusterNode && <NodeEdgeList nodeId={node.id as string} />}
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
            <div className="cg-detail-budget-actions">
              <button
                className="cg-detail-micro-btn cg-detail-budget-btn"
                onClick={handleExpandMore}
                disabled={!nextExpandableId}
                title={t('detail.budgetExpandMoreHint', { count: expandableFunctionIds.length })}
              >
                {t('detail.budgetExpandMore')}
              </button>
              <button
                className="cg-detail-micro-btn cg-detail-budget-btn"
                onClick={handleCollapseExpanded}
                disabled={expandedFunctionIds.length === 0}
                title={t('detail.budgetCollapseHint', { count: expandedFunctionIds.length })}
              >
                {t('detail.budgetCollapse')}
              </button>
              {onHighlightCallChain && (
                <button
                  className="cg-detail-micro-btn cg-detail-budget-btn"
                  onClick={() => onHighlightCallChain(node.id as string)}
                  title={t('detail.budgetChainHint')}
                >
                  {t('detail.budgetChainOnly')}
                </button>
              )}
            </div>
            {confirmingExpandAll ? (
              <div className="cg-detail-budget-confirm" role="alert">
                <span className="cg-detail-budget-warning">
                  {t('detail.budgetExpandAllWarning', { count: expandableFunctionIds.length })}
                </span>
                <div className="cg-detail-budget-actions">
                  <button className="cg-detail-micro-btn cg-detail-budget-btn cg-detail-budget-btn--danger" onClick={handleExpandAll}>
                    {t('detail.budgetExpandAllConfirm')}
                  </button>
                  <button className="cg-detail-micro-btn cg-detail-budget-btn" onClick={() => setConfirmingExpandAll(false)}>
                    {t('detail.budgetExpandAllCancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="cg-detail-micro-btn cg-detail-budget-btn cg-detail-budget-btn--wide"
                onClick={() => setConfirmingExpandAll(true)}
                disabled={expandableFunctionIds.length === 0}
                title={t('detail.budgetExpandAllHint', { count: expandableFunctionIds.length, total: totalFunctionCount })}
              >
                {t('detail.budgetExpandAll')}
              </button>
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
      {isClusterNode && displayedChildFunctions.length > 0 && onSelectFunction && (
        <div className="cg-detail-cluster-functions">
          <div className="cg-detail-section-title">{t('detail.functionsInCluster')} ({childFunctionNodes.length}{clusterChildCount > 50 ? '+' : ''})</div>
          <div className="cg-detail-function-list">
            {displayedChildFunctions.map((fn) => (
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
            {hiddenChildFunctionCount > 0 && (
              <div className="cg-detail-function-truncated">{t('detail.moreFunctions', { count: hiddenChildFunctionCount })}</div>
            )}
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
