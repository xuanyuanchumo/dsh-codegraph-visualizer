/**
 * ViewsPanel — Π 视图划分面板（cycle-141 / workstream E）。
 *
 * ## 它展示什么
 *
 * 宿主 `GET /api/v1/codegraph/views` 把 `graph_views` 工具的正式 Π 划分
 * （`src/shared/views.ts` 的 `partitionByView`）搬到 HTTP 面。本面板是它的消费端：
 *
 * - **四张视图摘要卡**：结构 / 时序 / 所有权 / 领域，各带节点数与边数；
 * - **视图分布条**：以总节点数为分母的横向比例条（结构视图恒为满宽，因为它是基图）；
 * - **节点视图矩阵**：采样节点 × 四视图的 ✓/— 表格；
 * - **领域分解**：Louvain 社区名与节点数；
 * - **截断披露**：矩阵采样时显式说明「仅显示前 N 个（共 M 个）」。
 *
 * ## 设计取舍
 *
 * - 时序 / 所有权视图在缺少原始 git 输入时**显式降级**：卡片显示「不可用」，
 *   并把宿主返回的 `reason` 原样呈现（reason 是服务端诊断数据，不是本组件的文案）。
 * - 空态 / 加载态 / 错误态 / 未构建态四态互斥，且**都渲染**——用户点开开关必须看到反馈，
 *   否则会以为入口坏了（与 `RuntimePanel` 同一条判断）。
 * - 所有网络请求走 `fetchWithTimeout` + AbortController：切换工作区时中止上一个慢响应，
 *   避免旧工作区的 Π 覆盖新工作区。
 * - 领域视图由 Louvain 现算，因此恒可用（图为空时路由已回 `INDEX_NOT_FOUND`，不会到这里）。
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import { fetchWithTimeout, withAbortGuard } from '../api/requestCore.ts';
import { useT } from '../i18n/index.ts';
import '../styles/views-panel.css';

/** 四个正交视图的渲染顺序（与路由 `VIEW_SUMMARY_KEYS` 同序）。 */
const VIEW_ORDER = ['structural', 'temporal', 'ownership', 'domain'] as const;
type ViewKey = (typeof VIEW_ORDER)[number];

/** 视图摘要（宿主 `viewsRoute.ts` 的 `ViewSummary` 的客户端镜像）。 */
interface ViewSummary {
  structural: { nodeCount: number; edgeCount: number };
  temporal: { nodeCount: number; edgeCount: number; available: boolean; reason: string | null };
  ownership: { nodeCount: number; edgeCount: number; available: boolean; reason: string | null };
  domain: { nodeCount: number; edgeCount: number; domainCount: number; nodeCounts: Record<string, number> };
}

/** 采样后的节点视图矩阵行。 */
interface NodeViewRow {
  id: string;
  label: string;
  views: string[];
}

/** `/api/v1/codegraph/views` 的线上形状（与路由响应类型一一对应）。 */
interface ViewsResponse {
  success: boolean;
  errorCode: string | null;
  views: ViewSummary | null;
  totalNodes: number;
  totalEdges: number;
  nodeViewMatrix: NodeViewRow[];
  sampled: boolean;
  computedAt: number;
}

/** `GET /views`：返回 `null` 表示请求被中止或失败（`withAbortGuard` 的回落）。 */
async function fetchViews(workspacePath: string, signal: AbortSignal): Promise<ViewsResponse | null> {
  const url = `/api/v1/codegraph/views?workspace=${encodeURIComponent(workspacePath)}`;
  return withAbortGuard('fetchViews', async () => {
    const res = await fetchWithTimeout(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as ViewsResponse;
  }, null, { url });
}

/** 取某个视图的节点数（`Record` 在 `noUncheckedIndexedAccess` 下可能为 undefined）。 */
function viewNodeCount(summary: ViewSummary, key: ViewKey): number {
  const bucket = summary[key];
  return typeof bucket === 'object' && bucket !== null && 'nodeCount' in bucket
    ? (bucket as { nodeCount: number }).nodeCount
    : 0;
}

/** 取某个视图的边数。 */
function viewEdgeCount(summary: ViewSummary, key: ViewKey): number {
  const bucket = summary[key];
  return typeof bucket === 'object' && bucket !== null && 'edgeCount' in bucket
    ? (bucket as { edgeCount: number }).edgeCount
    : 0;
}

export interface ViewsPanelProps {
  onClose: () => void;
  /** 面板标题；缺省用 `views.title`。 */
  label?: string;
  /** 目标工作区绝对路径。 */
  workspacePath: string;
}

export const ViewsPanel = memo(function ViewsPanel({ onClose, label, workspacePath }: ViewsPanelProps) {
  const t = useT();
  const [data, setData] = useState<ViewsResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'notfound'>('loading');
  // 请求的中止控制器：切换工作区时中止上一个慢响应，避免旧工作区覆盖新工作区。
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    try {
      const result = await fetchViews(workspacePath, controller.signal);
      if (controller.signal.aborted) return; // 已被更新的请求取代，丢弃这次结果。
      if (!result) {
        setData(null);
        setStatus('error');
        return;
      }
      if (!result.success) {
        setData(null);
        setStatus('notfound');
        return;
      }
      setData(result);
      setStatus('ready');
    } catch {
      if (!controller.signal.aborted) {
        setData(null);
        setStatus('error');
      }
    }
  }, [workspacePath]);

  useEffect(() => {
    void load();
    return () => {
      // 卸载时中止在途请求，避免对已卸载组件 setState。
      abortRef.current?.abort();
    };
  }, [load]);

  const panelLabel = label ?? t('views.title');

  return (
    <AnalysisPanelShell variant="views" label={panelLabel} onClose={onClose}>
      {status === 'loading' ? (
        <div className="cg-views-state" role="status">{t('views.loading')}</div>
      ) : status === 'error' ? (
        <div className="cg-views-state cg-views-state-error" role="status">
          <span>{t('views.error')}</span>
          <button type="button" className="cg-views-retry" onClick={() => void load()}>
            {t('views.retry')}
          </button>
        </div>
      ) : status === 'notfound' ? (
        <div className="cg-views-state cg-views-state-empty" role="status">{t('views.notFound')}</div>
      ) : data && data.views ? (
        <ViewsBody data={data} views={data.views} t={t} />
      ) : null}
    </AnalysisPanelShell>
  );
});

/** 成功态正文（拆成子组件，避免每次父渲染重建内联 JSX 的引用）。 */
function ViewsBody({
  data,
  views,
  t,
}: {
  data: ViewsResponse;
  views: ViewSummary;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const { totalNodes, totalEdges, nodeViewMatrix, sampled } = data;

  // 分布条的分母是总节点数：结构视图恒为满宽（它是基图），其余视图是它的子集。
  const distribution = VIEW_ORDER.map((key) => ({
    key,
    count: viewNodeCount(views, key),
    edgeCount: viewEdgeCount(views, key),
  }));

  const domainEntries = Object.entries(views.domain.nodeCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return (
    <>
      {/* 四张视图摘要卡 */}
      <div className="cg-views-cards">
        {distribution.map((entry) => {
          const unavailable = entry.key === 'temporal'
            ? views.temporal.available === false
            : entry.key === 'ownership'
              ? views.ownership.available === false
              : false;
          const reason = entry.key === 'temporal' ? views.temporal.reason : entry.key === 'ownership' ? views.ownership.reason : null;
          return (
            <div
              key={entry.key}
              className={'cg-views-card' + (unavailable ? ' cg-views-card-off' : '')}
            >
              <div className="cg-views-card-title">{t('views.card.' + entry.key)}</div>
              <div className="cg-views-card-count">
                {entry.count}
                <span className="cg-views-card-unit">{t('views.nodes')}</span>
              </div>
              <div className="cg-views-card-hint">
                {t('views.cardHint', { nodes: entry.count, edges: entry.edgeCount })}
              </div>
              {unavailable && <div className="cg-views-card-reason">{t('views.' + entry.key + 'Unavailable')}</div>}
              {!unavailable && reason ? <div className="cg-views-card-reason">{reason}</div> : null}
              {entry.key === 'domain' && !unavailable && (
                <div className="cg-views-card-hint">{t('views.domainTitle')}: {views.domain.domainCount}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* 视图分布条 + 图例 */}
      <section className="cg-views-section">
        <h4 className="cg-views-section-title">{t('views.distributionTitle')}</h4>
        <div
          className="cg-views-bar"
          role="img"
          aria-label={distribution.map((d) => `${t('views.card.' + d.key)} ${d.count}`).join('，')}
        >
          {distribution.map((entry) => {
            const pct = totalNodes > 0 ? Math.max(0, Math.min(100, (entry.count / totalNodes) * 100)) : 0;
            return (
              <div
                key={entry.key}
                className={'cg-views-bar-seg cg-views-bar-' + entry.key}
                style={{ width: `${pct}%` }}
                title={`${t('views.card.' + entry.key)}: ${entry.count}`}
              />
            );
          })}
        </div>
        <div className="cg-views-legend">
          {distribution.map((entry) => (
            <span key={entry.key} className="cg-views-legend-item">
              <span className={'cg-views-dot cg-views-dot-' + entry.key} aria-hidden />
              {t('views.card.' + entry.key)} · {entry.count}
            </span>
          ))}
        </div>
      </section>

      {/* 节点视图矩阵 */}
      <section className="cg-views-section">
        <h4 className="cg-views-section-title">{t('views.matrixTitle')}</h4>
        {sampled ? (
          <div className="cg-views-sampled" role="status">
            {t('views.sampled', { shown: nodeViewMatrix.length, total: totalNodes })}
          </div>
        ) : null}
        {nodeViewMatrix.length === 0 ? (
          <div className="cg-views-empty">{t('views.emptyMatrix')}</div>
        ) : (
          <div className="cg-views-matrix" role="table" aria-label={t('views.matrixTitle')}>
            <div className="cg-views-matrix-row cg-views-matrix-head" role="row">
              <span role="columnheader">{t('views.nodes')}</span>
              {VIEW_ORDER.map((key) => (
                <span key={key} role="columnheader">{t('views.card.' + key)}</span>
              ))}
            </div>
            {nodeViewMatrix.map((row) => (
              <div className="cg-views-matrix-row" role="row" key={row.id}>
                <span className="cg-views-matrix-id" role="rowheader">{row.label}</span>
                {VIEW_ORDER.map((key) => {
                  const on = row.views.includes(key);
                  return (
                    <span
                      key={key}
                      role="cell"
                      className={'cg-views-cell' + (on ? ' cg-views-cell-on' : '')}
                      aria-label={`${row.label} ${t('views.card.' + key)} ${on ? t('views.yes') : t('views.no')}`}
                    >
                      {on ? t('views.yes') : t('views.no')}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 领域分解 */}
      {views.domain.domainCount > 0 ? (
        <section className="cg-views-section">
          <h4 className="cg-views-section-title">{t('views.domainTitle')}</h4>
          <div className="cg-views-domains">
            {domainEntries.map((entry) => (
              <div className="cg-views-domain" key={entry.name}>
                <span className="cg-views-domain-name">{entry.name}</span>
                <span className="cg-views-domain-count">{entry.count}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="cg-views-footnote">
        {t('views.nodes')} {totalNodes} · {t('views.edges')} {totalEdges}
      </div>
    </>
  );
}
