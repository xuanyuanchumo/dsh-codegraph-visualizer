/**
 * GraphManagePanel — 代码图谱管理面板（cycle-141）。
 *
 * ## 功能
 *
 * - **构建**（build）：触发全量图谱构建（codegraph_init → scan）
 * - **更新**（update）：触发增量更新（codegraph_sync → scan）
 * - **删除**（delete）：删除原生索引 DB（下次构建重新生成）
 * - **状态**（status）：显示索引状态、节点数、边数、指纹、构建时间
 * - **指标**（metrics）：图指标（密度、聚类系数、介数中心性、PageRank、度数分布）
 *
 * ## 设计
 *
 * - 三个操作按钮（构建/更新/删除）+ 状态卡片 + 指标卡片
 * - 操作是异步的，显示 loading 状态
 * - 指标从 `/api/v1/codegraph/manage/metrics` 获取
 * - 状态从 `/api/v1/codegraph/status` 获取
 */

import { memo, useState, useCallback, useEffect } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import type { GraphNode, GraphEdge } from '../../types/index.ts';

export interface GraphManagePanelProps {
  onClose: () => void;
  workspacePath: string;
  onSetLoading: (loading: boolean) => void;
  onSetError: (error: string | null) => void;
  prerequisites: { codegraph: boolean; lens: boolean };
}

/** 图指标类型 */
interface GraphMetrics {
  nodeCount: number;
  edgeCount: number;
  density: number;
  avgClustering: number;
  degreeDistribution: {
    alpha: number;
    isPowerLaw: boolean;
    maxDegree: number;
    minDegree: number;
    meanDegree: number;
  };
  topBetweenness: Array<{ id: string; value: number }>;
  topPageRank: Array<{ id: string; value: number }>;
}

export const GraphManagePanel = memo(function GraphManagePanel({
  onClose,
  workspacePath,
  onSetLoading,
  onSetError,
  prerequisites,
}: GraphManagePanelProps) {
  const t = useT();
  const storeState = useGraphStore((s) => ({ indexStatus: s.isLoading ? 'building' : (s.nodes.length > 0 ? 'ready' : 'idle'), nodeCount: s.nodes.length, edgeCount: s.edges.length, builtAt: s.rawNodes.length > 0 ? Date.now() : null }));
  const indexStatus = storeState.indexStatus;
  const nodeCount = storeState.nodeCount;
  const edgeCount = storeState.edgeCount;
  const builtAt = storeState.builtAt;
  const [metrics, setMetrics] = useState<GraphMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'build' | 'update' | 'delete' | null>(null);

  // 加载指标
  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    try {
      const res = await fetch(`/api/v1/codegraph/manage/metrics?workspace=${encodeURIComponent(workspacePath)}`);
      const data = await res.json();
      if (data.success && data.metrics) {
        setMetrics(data.metrics);
      }
    } catch (e) {
      // 指标加载失败不阻塞面板
    } finally {
      setMetricsLoading(false);
    }
  }, [workspacePath]);

  // 状态变为 ready 时自动加载指标
  useEffect(() => {
    if (indexStatus === 'ready') {
      loadMetrics();
    }
  }, [indexStatus, loadMetrics]);

  // 操作处理
  const handleBuild = useCallback(async () => {
    setActionLoading('build');
    onSetLoading(true);
    onSetError(null);
    try {
      await fetch('/api/v1/codegraph/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspacePath }),
      });
    } finally {
      setActionLoading(null);
    }
  }, [workspacePath, onSetLoading, onSetError]);

  const handleUpdate = useCallback(async () => {
    setActionLoading('update');
    onSetLoading(true);
    onSetError(null);
    try {
      await fetch('/api/v1/codegraph/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspacePath }),
      });
    } finally {
      setActionLoading(null);
    }
  }, [workspacePath, onSetLoading, onSetError]);

  const handleDelete = useCallback(async () => {
    setActionLoading('delete');
    onSetLoading(true);
    onSetError(null);
    try {
      await fetch('/api/v1/codegraph/manage/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: workspacePath }),
      });
      // 状态由 store 驱动，无需手动刷新
      // 删除后指标清空
      setMetrics(null);
    } catch (e) {
      onSetError(String(e));
    } finally {
      setActionLoading(null);
      onSetLoading(false);
    }
  }, [workspacePath, onSetLoading, onSetError]);

  return (
    <div className="cg-manage-panel">
      {/* 头部 */}
      <div className="cg-manage-header">
        <h3 className="cg-manage-title">{t('manage.title')}</h3>
        <button className="cg-close-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {/* 工作区信息 */}
      <div className="cg-manage-workspace">
        <span className="cg-manage-label">{t('manage.workspace')}</span>
        <code className="cg-manage-path">{workspacePath}</code>
      </div>

      {/* 操作按钮 */}
      <div className="cg-manage-actions">
        <button
          className="cg-btn cg-btn-primary"
          onClick={handleBuild}
          disabled={actionLoading !== null || !prerequisites.codegraph}
        >
          {actionLoading === 'build' ? t('manage.building') : t('manage.build')}
        </button>
        <button
          className="cg-btn cg-btn-secondary"
          onClick={handleUpdate}
          disabled={actionLoading !== null || indexStatus !== 'ready'}
        >
          {actionLoading === 'update' ? t('manage.updating') : t('manage.update')}
        </button>
        <button
          className="cg-btn cg-btn-danger"
          onClick={handleDelete}
          disabled={actionLoading !== null || indexStatus !== 'ready'}
        >
          {actionLoading === 'delete' ? t('manage.deleting') : t('manage.delete')}
        </button>
        <button
          className="cg-btn cg-btn-ghost"
          onClick={() => loadMetrics()}
          disabled={actionLoading !== null}
        >
          {t('manage.refresh')}
        </button>
      </div>

      {/* 状态卡片 */}
      <div className="cg-manage-status">
        <div className="cg-manage-status-row">
          <span className="cg-manage-label">{t('manage.status')}</span>
          <span className={`cg-manage-status-value cg-status-${indexStatus}`}>
            {t(`manage.status_${indexStatus}`)}
          </span>
        </div>
        <div className="cg-manage-status-row">
          <span className="cg-manage-label">{t('manage.nodes')}</span>
          <span className="cg-manage-status-value">{nodeCount}</span>
        </div>
        <div className="cg-manage-status-row">
          <span className="cg-manage-label">{t('manage.edges')}</span>
          <span className="cg-manage-status-value">{edgeCount}</span>
        </div>
        {builtAt && (
          <div className="cg-manage-status-row">
            <span className="cg-manage-label">{t('manage.built_at')}</span>
            <span className="cg-manage-status-value">
              {new Date(builtAt).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* 指标卡片 */}
      {metrics && (
        <div className="cg-manage-metrics">
          <h4 className="cg-manage-metrics-title">{t('manage.metrics')}</h4>
          <div className="cg-manage-metric-grid">
            <div className="cg-manage-metric">
              <span className="cg-manage-metric-label">{t('manage.density')}</span>
              <span className="cg-manage-metric-value">{(metrics.density * 100).toFixed(2)}%</span>
            </div>
            <div className="cg-manage-metric">
              <span className="cg-manage-metric-label">{t('manage.clustering')}</span>
              <span className="cg-manage-metric-value">{metrics.avgClustering.toFixed(3)}</span>
            </div>
            <div className="cg-manage-metric">
              <span className="cg-manage-metric-label">{t('manage.power_law')}</span>
              <span className="cg-manage-metric-value">
                {metrics.degreeDistribution.isPowerLaw
                  ? `α=${metrics.degreeDistribution.alpha.toFixed(2)}`
                  : t('manage.not_power_law')}
              </span>
            </div>
            <div className="cg-manage-metric">
              <span className="cg-manage-metric-label">{t('manage.mean_degree')}</span>
              <span className="cg-manage-metric-value">
                {metrics.degreeDistribution.meanDegree.toFixed(1)}
              </span>
            </div>
          </div>

          {/* Top 介数中心性 */}
          {metrics.topBetweenness.length > 0 && (
            <div className="cg-manage-top-list">
              <h5 className="cg-manage-top-title">{t('manage.top_betweenness')}</h5>
              <ul className="cg-manage-top-items">
                {metrics.topBetweenness.map((item, i) => (
                  <li key={item.id} className="cg-manage-top-item">
                    <span className="cg-manage-top-rank">{i + 1}.</span>
                    <span className="cg-manage-top-id">{item.id}</span>
                    <span className="cg-manage-top-value">{item.value.toFixed(4)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Top PageRank */}
          {metrics.topPageRank.length > 0 && (
            <div className="cg-manage-top-list">
              <h5 className="cg-manage-top-title">{t('manage.top_pagerank')}</h5>
              <ul className="cg-manage-top-items">
                {metrics.topPageRank.map((item, i) => (
                  <li key={item.id} className="cg-manage-top-item">
                    <span className="cg-manage-top-rank">{i + 1}.</span>
                    <span className="cg-manage-top-id">{item.id}</span>
                    <span className="cg-manage-top-value">{item.value.toFixed(4)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {metricsLoading && (
        <div className="cg-manage-loading">{t('manage.loading_metrics')}</div>
      )}

      {/* 前置条件提示 */}
      {!prerequisites.codegraph && (
        <div className="cg-manage-warning">
          {t('manage.no_codegraph_prerequisite')}
        </div>
      )}
    </div>
  );
});
