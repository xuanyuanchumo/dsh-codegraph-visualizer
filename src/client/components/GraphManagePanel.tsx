/**
 * GraphManagePanel — 代码图谱管理面板（cycle-141 / workstream C）。
 *
 * ## 功能
 *
 * - **构建**（build）：`requestScan` → `POST /api/v1/codegraph/scan`（全量；宿主后台完成，
 *   通过 SSE 回推，因此这里只认领请求回执）。
 * - **更新**（update）：`POST /api/v1/codegraph/manage/update`（**增量同步**，与构建是不同端点）。
 * - **删除**（delete）：内联两步确认 → `POST /api/v1/codegraph/manage/delete`；成功清空指标并
 *   复位 store（`clearGraph()`）。区分 `INDEX_NOT_FOUND`（尚未构建）与 `DELETE_FAILED`（失败）。
 * - **状态**：索引状态（idle/ready/building/error）、节点数、边数、**真实**构建时间
 *   （来自 `store.lastUpdated`，不是每次渲染的 `Date.now()`）。
 * - **指标**：`GET /api/v1/codegraph/manage/metrics`，带 AbortController 的过期请求守卫
 *   （切换工作区时中止上一个慢响应，避免旧工作区覆盖新工作区）。
 * - **白盒**：repoId、图层来源、指纹（宿主提供时才显示）、truncation 明细与附加图指标。
 *
 * ## 设计
 *
 * - 三个操作按钮（构建/更新/删除）+ 状态卡片 + 指标卡片 + 白盒信息。
 * - 所有网络请求走 `fetchWithTimeout`（超时/中止）；`finally` 必复位 loading。
 * - 删除是破坏性操作，使用内联两步确认（不使用 `window.confirm`，便于测试与无障碍）。
 * - 指标加载失败不再静默吞掉：渲染一条可见的错误提示。
 */

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import { requestScan } from '../api/hostRequests.ts';
import { fetchWithTimeout, withAbortGuard } from '../api/requestCore.ts';
import { API } from '../../shared/constants.ts';

export interface GraphManagePanelProps {
  onClose: () => void;
  workspacePath: string;
  onSetLoading: (loading: boolean) => void;
  onSetError: (error: string | null) => void;
  prerequisites: { codegraph: boolean };
}

/** 图指标类型（宿主 `computeGraphMetrics` 的线上形状）。 */
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
  // cycle-141：原生代码图谱数学增强（workstream B）新增的附加字段。
  // 全部可选：旧宿主不返回时必须缺席，绝不用 0 冒充（0 本身是合法值，会伪装成「算过了」）。
  components?: { weaklyConnected: number; stronglyConnected: number };
  articulationPoints?: number;
  diameter?: number;
  avgShortestPath?: number;
  modularity?: number;
  cyclomaticNumber?: number;
  kCore?: number;
  pageRankMass?: number;
}

/** truncation 明细（截断必须显式披露，不能只给一个布尔）。 */
interface TruncationInfo {
  nodesTotal: number;
  nodesSampled: number;
  edgesTotal: number;
  edgesSampled: number;
  truncated: boolean;
  sampled: boolean;
  computeMs: number;
}

/** 索引覆盖范围（cycle-141 第七轮：gitignore 过滤的白盒数据，原生索引才有）。 */
interface CoverageInfo {
  gitignorePresent: boolean;
  gitignoreRules: number;
  ignoredEntries: number;
  indexedAt: number;
}

interface ManageMetricsResponse {
  success: boolean;
  errorCode: string | null;
  metrics: GraphMetrics | null;
  truncation: TruncationInfo | null;
  /** 结构指纹：冻结契约未承诺，仅当宿主提供时才显示（宁缺勿造）。 */
  fingerprint?: string;
  /** 覆盖范围：仅原生索引提供（上游索引为 null，面板不渲染该行——宁缺勿造）。 */
  coverage?: CoverageInfo | null;
  error?: string;
}

interface ManageUpdateResponse {
  success: boolean;
  errorCode: string | null;
  synced: boolean;
  scanned: number;
  error?: string;
}

interface ManageDeleteResponse {
  success: boolean;
  deleted: boolean;
  errorCode: string | null;
  error?: string;
}

/** `GET /manage/metrics`：返回 `null` 表示请求被中止或失败（`withAbortGuard` 的回落）。 */
async function fetchManageMetrics(workspacePath: string, signal: AbortSignal): Promise<ManageMetricsResponse | null> {
  const url = `/api/v1/codegraph/manage/metrics?workspace=${encodeURIComponent(workspacePath)}`;
  return withAbortGuard('fetchManageMetrics', async () => {
    const res = await fetchWithTimeout(url, { signal });
    if (!res.ok) return { success: false, errorCode: 'METRICS_FAILED', metrics: null, truncation: null };
    return (await res.json()) as ManageMetricsResponse;
  }, null, { url });
}

/** `POST /manage/update`：增量同步。失败语义见冻结契约（HTTP 500 + `SYNC_FAILED`）。 */
async function requestManageUpdate(workspacePath: string): Promise<ManageUpdateResponse | null> {
  const url = '/api/v1/codegraph/manage/update';
  return withAbortGuard('requestManageUpdate', async () => {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: workspacePath }),
    }, API.SCAN_TIMEOUT_MS);
    if (!res.ok) {
      // 冻结契约要求失败体是 `{success:false,errorCode:'SYNC_FAILED',...}`；
      // 老宿主可能给别的状态码——至少保住「失败」语义，绝不伪装成功。
      try {
        return (await res.json()) as ManageUpdateResponse;
      } catch {
        return { success: false, errorCode: 'SYNC_FAILED', synced: false, scanned: 0, error: `HTTP ${res.status}` };
      }
    }
    return (await res.json()) as ManageUpdateResponse;
  }, null, { url });
}

/** `POST /manage/delete`：删除原生索引。 */
async function requestManageDelete(workspacePath: string): Promise<ManageDeleteResponse | null> {
  const url = '/api/v1/codegraph/manage/delete';
  return withAbortGuard('requestManageDelete', async () => {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: workspacePath }),
    }, API.SCAN_TIMEOUT_MS);
    if (!res.ok) {
      // 冻结契约：失败是 HTTP 500 + `{success:false,deleted:false,errorCode:'DELETE_FAILED',error}`。
      try {
        return (await res.json()) as ManageDeleteResponse;
      } catch {
        return { success: false, deleted: false, errorCode: 'DELETE_FAILED', error: `HTTP ${res.status}` };
      }
    }
    return (await res.json()) as ManageDeleteResponse;
  }, null, { url });
}

export const GraphManagePanel = memo(function GraphManagePanel({
  onClose,
  workspacePath,
  onSetLoading,
  onSetError,
  prerequisites,
}: GraphManagePanelProps) {
  const t = useT();
  // 逐字段选择器（而不是返回新对象的选择器）：避免每次渲染生成新引用带来的多余重渲染。
  const isLoading = useGraphStore((s) => s.isLoading);
  const storeError = useGraphStore((s) => s.error);
  const nodeCount = useGraphStore((s) => s.nodes.length);
  const edgeCount = useGraphStore((s) => s.edges.length);
  const hasGraph = useGraphStore((s) => s.rawNodes.length > 0);
  const lastUpdated = useGraphStore((s) => s.lastUpdated);
  const repoId = useGraphStore((s) => s.repoId);
  const graphLayer = useGraphStore((s) => s.graphLayer);

  // 状态机：error 优先（有错误就显示错误），其次 loading，再按有没有图区分 ready/idle。
  const indexStatus: 'idle' | 'ready' | 'building' | 'error' =
    storeError ? 'error' : (isLoading ? 'building' : (nodeCount > 0 ? 'ready' : 'idle'));
  // 真实构建时间：来自 `store.lastUpdated`（服务端 `metadata.timestamp` 或本地时钟），
  // 不是每次渲染的 `Date.now()`（那会让时间每帧跳动，测试也无法钉住）。
  const builtAt = hasGraph ? lastUpdated : null;

  const [metrics, setMetrics] = useState<GraphMetrics | null>(null);
  const [truncation, setTruncation] = useState<TruncationInfo | null>(null);
  const [coverage, setCoverage] = useState<CoverageInfo | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'build' | 'update' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 指标请求的中止控制器：切换工作区时中止上一个慢请求，避免旧响应覆盖新工作区。
  const metricsAbortRef = useRef<AbortController | null>(null);

  // 加载指标（带过期请求守卫 + 可见的错误面）。
  const loadMetrics = useCallback(async () => {
    metricsAbortRef.current?.abort();
    const controller = new AbortController();
    metricsAbortRef.current = controller;
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const data = await fetchManageMetrics(workspacePath, controller.signal);
      if (controller.signal.aborted) return; // 已被更新的请求取代，丢弃这次结果。
      if (!data) {
        setMetrics(null);
        setTruncation(null);
        setCoverage(null);
        setFingerprint(null);
        setMetricsError(t('manage.metrics_error'));
        return;
      }
      if (!data.success) {
        setMetrics(null);
        setTruncation(null);
        setCoverage(null);
        setFingerprint(null);
        setMetricsError(
          data.errorCode === 'INDEX_NOT_FOUND'
            ? t('manage.metrics_not_built')
            : (data.errorCode ?? t('manage.metrics_error')),
        );
        return;
      }
      setMetrics(data.metrics ?? null);
      setTruncation(data.truncation ?? null);
      setCoverage(data.coverage ?? null);
      setFingerprint(data.fingerprint ?? null);
    } catch (e) {
      if (!controller.signal.aborted) {
        setMetrics(null);
        setTruncation(null);
        setCoverage(null);
        setFingerprint(null);
        setMetricsError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!controller.signal.aborted) setMetricsLoading(false);
    }
  }, [workspacePath, t]);

  // 状态变为 ready 时自动加载指标。
  useEffect(() => {
    if (indexStatus === 'ready') loadMetrics();
  }, [indexStatus, loadMetrics]);

  // 操作处理：全部走 `fetchWithTimeout`（超时/中止），`finally` 必复位 loading。
  const handleBuild = useCallback(async () => {
    setActionLoading('build');
    onSetLoading(true);
    onSetError(null);
    try {
      const result = await requestScan(workspacePath);
      if (!result || !result.success) onSetError(t('manage.build_failed'));
    } catch (e) {
      onSetError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
      onSetLoading(false);
    }
  }, [workspacePath, onSetLoading, onSetError, t]);

  const handleUpdate = useCallback(async () => {
    setActionLoading('update');
    onSetLoading(true);
    onSetError(null);
    try {
      const result = await requestManageUpdate(workspacePath);
      if (!result || !result.success) onSetError(t('manage.update_failed'));
    } catch (e) {
      onSetError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
      onSetLoading(false);
    }
  }, [workspacePath, onSetLoading, onSetError, t]);

  const handleDeleteConfirmed = useCallback(async () => {
    setActionLoading('delete');
    onSetLoading(true);
    onSetError(null);
    try {
      const result = await requestManageDelete(workspacePath);
      if (result?.success && result.deleted) {
        // 删除成功：清空指标/白盒，并让 store 复位（节点/边/repoId/lastUpdated 一并清零）。
        setMetrics(null);
        setTruncation(null);
        setCoverage(null);
        setFingerprint(null);
        setMetricsError(null);
        useGraphStore.getState().clearGraph();
        setConfirmDelete(false);
      } else if (result?.errorCode === 'INDEX_NOT_FOUND') {
        setConfirmDelete(false);
        onSetError(t('manage.delete_not_found'));
      } else {
        setConfirmDelete(false);
        onSetError(t('manage.delete_failed'));
      }
    } catch (e) {
      setConfirmDelete(false);
      onSetError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
      onSetLoading(false);
    }
  }, [workspacePath, onSetLoading, onSetError, t]);

  // 附加指标是否有任一字段到场（决定是否渲染附加网格）。
  const additiveMetrics = Boolean(
    metrics && (
      metrics.components !== undefined ||
      metrics.articulationPoints !== undefined ||
      metrics.diameter !== undefined ||
      metrics.avgShortestPath !== undefined ||
      metrics.modularity !== undefined ||
      metrics.cyclomaticNumber !== undefined ||
      metrics.kCore !== undefined ||
      metrics.pageRankMass !== undefined
    ),
  );

  return (
    <div className="cg-manage-panel">
      {/* 头部 */}
      <div className="cg-manage-header">
        <h3 className="cg-manage-title">{t('manage.title')}</h3>
        <button className="cg-close-btn" onClick={onClose} aria-label={t('manage.close')}>
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
          onClick={() => setConfirmDelete(true)}
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

      {/* 删除确认（内联两步确认，便于测试与无障碍） */}
      {confirmDelete && (
        <div className="cg-manage-confirm" role="alertdialog" aria-label={t('manage.confirm_delete')}>
          <span className="cg-manage-confirm-text">{t('manage.confirm_delete')}</span>
          <button
            className="cg-btn cg-btn-danger"
            onClick={handleDeleteConfirmed}
            disabled={actionLoading !== null}
          >
            {actionLoading === 'delete' ? t('manage.deleting') : t('manage.confirm')}
          </button>
          <button
            className="cg-btn cg-btn-ghost"
            onClick={() => setConfirmDelete(false)}
            disabled={actionLoading !== null}
          >
            {t('manage.cancel')}
          </button>
        </div>
      )}

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
        {builtAt !== null && builtAt > 0 && (
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

          {/* 附加图指标（原生代码图谱数学增强，字段缺席时不渲染） */}
          {additiveMetrics && (
            <div className="cg-manage-metric-grid cg-manage-metric-grid--extra">
              {metrics.components && (
                <div className="cg-manage-metric">
                  <span className="cg-manage-metric-label">{t('manage.components')}</span>
                  <span className="cg-manage-metric-value">
                    {t('manage.weakly_connected')} {metrics.components.weaklyConnected} / {t('manage.strongly_connected')} {metrics.components.stronglyConnected}
                  </span>
                </div>
              )}
              {metrics.articulationPoints !== undefined && (
                <div className="cg-manage-metric">
                  <span className="cg-manage-metric-label">{t('manage.articulation_points')}</span>
                  <span className="cg-manage-metric-value">{metrics.articulationPoints}</span>
                </div>
              )}
              {metrics.diameter !== undefined && (
                <div className="cg-manage-metric">
                  <span className="cg-manage-metric-label">{t('manage.diameter')}</span>
                  <span className="cg-manage-metric-value">{metrics.diameter}</span>
                </div>
              )}
              {metrics.avgShortestPath !== undefined && (
                <div className="cg-manage-metric">
                  <span className="cg-manage-metric-label">{t('manage.avg_shortest_path')}</span>
                  <span className="cg-manage-metric-value">{metrics.avgShortestPath}</span>
                </div>
              )}
              {metrics.modularity !== undefined && (
                <div className="cg-manage-metric">
                  <span className="cg-manage-metric-label">{t('manage.modularity')}</span>
                  <span className="cg-manage-metric-value">{metrics.modularity}</span>
                </div>
              )}
              {metrics.cyclomaticNumber !== undefined && (
                <div className="cg-manage-metric">
                  <span className="cg-manage-metric-label">{t('manage.cyclomatic_number')}</span>
                  <span className="cg-manage-metric-value">{metrics.cyclomaticNumber}</span>
                </div>
              )}
              {metrics.kCore !== undefined && (
                <div className="cg-manage-metric">
                  <span className="cg-manage-metric-label">{t('manage.k_core')}</span>
                  <span className="cg-manage-metric-value">{metrics.kCore}</span>
                </div>
              )}
              {metrics.pageRankMass !== undefined && (
                <div className="cg-manage-metric">
                  <span className="cg-manage-metric-label">{t('manage.page_rank_mass')}</span>
                  <span className="cg-manage-metric-value">{metrics.pageRankMass}</span>
                </div>
              )}
            </div>
          )}

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

      {/* 白盒信息（repoId / 图层来源 / 指纹 / truncation 明细） */}
      {(repoId !== null || graphLayer !== undefined || fingerprint !== null || truncation !== null) && (
        <div className="cg-manage-whitebox">
          <h4 className="cg-manage-whitebox-title">{t('manage.whitebox_title')}</h4>
          {repoId !== null && (
            <div className="cg-manage-whitebox-row">
              <span className="cg-manage-label">{t('manage.repo_id')}</span>
              <code className="cg-manage-whitebox-value">{repoId}</code>
            </div>
          )}
          {graphLayer !== undefined && (
            <div className="cg-manage-whitebox-row">
              <span className="cg-manage-label">{t('manage.graph_layer')}</span>
              <span className="cg-manage-whitebox-value">{t(`manage.graph_layer_${graphLayer}`)}</span>
            </div>
          )}
          {fingerprint !== null && (
            <div className="cg-manage-whitebox-row">
              <span className="cg-manage-label">{t('manage.fingerprint')}</span>
              <code className="cg-manage-whitebox-value">{fingerprint}</code>
            </div>
          )}
          {truncation !== null && (
            <div className="cg-manage-truncation">
              <span className="cg-manage-label">{t('manage.truncation')}</span>
              <div className="cg-manage-truncation-grid">
                <div className="cg-manage-whitebox-row">
                  <span className="cg-manage-label">{t('manage.nodes_total')}</span>
                  <span className="cg-manage-whitebox-value">{truncation.nodesTotal}</span>
                </div>
                <div className="cg-manage-whitebox-row">
                  <span className="cg-manage-label">{t('manage.nodes_sampled')}</span>
                  <span className="cg-manage-whitebox-value">{truncation.nodesSampled}</span>
                </div>
                <div className="cg-manage-whitebox-row">
                  <span className="cg-manage-label">{t('manage.edges_total')}</span>
                  <span className="cg-manage-whitebox-value">{truncation.edgesTotal}</span>
                </div>
                <div className="cg-manage-whitebox-row">
                  <span className="cg-manage-label">{t('manage.edges_sampled')}</span>
                  <span className="cg-manage-whitebox-value">{truncation.edgesSampled}</span>
                </div>
                <div className="cg-manage-whitebox-row">
                  <span className="cg-manage-label">{t('manage.truncated')}</span>
                  <span className="cg-manage-whitebox-value">{truncation.truncated ? t('manage.yes') : t('manage.no')}</span>
                </div>
                <div className="cg-manage-whitebox-row">
                  <span className="cg-manage-label">{t('manage.sampled')}</span>
                  <span className="cg-manage-whitebox-value">{truncation.sampled ? t('manage.yes') : t('manage.no')}</span>
                </div>
                <div className="cg-manage-whitebox-row">
                  <span className="cg-manage-label">{t('manage.compute_ms')}</span>
                  <span className="cg-manage-whitebox-value">{truncation.computeMs}</span>
                </div>
              </div>
            </div>
          )}
          {/* 索引覆盖范围（cycle-141 第七轮）：gitignore 过滤的白盒数据——
              「图谱为什么少了某目录」的唯一可诊断入口。仅原生索引提供（coverage
              为 null 不渲染——上游索引没有这个数据面，宁缺勿造）。 */}
          {coverage && (
            <div className="cg-manage-truncation">
              <span className="cg-manage-label">{t('manage.coverage_title')}</span>
              <div className="cg-manage-truncation-grid">
                <div className="cg-manage-whitebox-row">
                  <span className="cg-manage-label">{t('manage.coverage_gitignore')}</span>
                  <span className="cg-manage-whitebox-value">{coverage.gitignorePresent ? t('manage.yes') : t('manage.no')}</span>
                </div>
                <div className="cg-manage-whitebox-row">
                  <span className="cg-manage-label">{t('manage.coverage_rules')}</span>
                  <span className="cg-manage-whitebox-value">{coverage.gitignoreRules}</span>
                </div>
                <div className="cg-manage-whitebox-row">
                  <span className="cg-manage-label">{t('manage.coverage_ignored')}</span>
                  <span className="cg-manage-whitebox-value">{coverage.ignoredEntries}</span>
                </div>
                <div className="cg-manage-whitebox-row">
                  <span className="cg-manage-label">{t('manage.coverage_indexed_at')}</span>
                  <span className="cg-manage-whitebox-value">{new Date(coverage.indexedAt).toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {metricsError && <div className="cg-manage-warning">{metricsError}</div>}

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
