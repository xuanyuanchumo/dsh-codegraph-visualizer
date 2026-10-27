import { memo } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import { useT } from '../i18n/index.ts';
import type { HotspotNode, ChurnStatus } from '../hooks/useAnalysisPanels.ts';

interface HotspotPanelProps {
  hotspotNodes: HotspotNode[];
  /** git 变更频率数据的状态（cycle-105：churn 端到端闭环）。 */
  churnStatus?: ChurnStatus;
  onClose: () => void;
  label: string;
}

/**
 * 热点分析面板（cycle-105：接入 git 变更频率）。
 *
 * 面板有四种 churn 状态，每种都必须在 UI 上可区分：
 * - `idle`：面板刚打开，还没发请求——不显示状态行；
 * - `loading`：请求进行中——显示「正在读取」，**不能**说「未获取到」，那是在报一个还没发生的结果；
 * - `unavailable`：宿主答复了但没拿到 git 数据（不是仓库 / git 未装 / 超时）——显示原因；
 * - `ready`：拿到了真实数据——显示来源提交数，`truncated` 时另加截断提示。
 *
 * 刻意不把失败归一成「空数据」：那会让热点排序看起来正常，而用户完全不知道
 * 支撑这份排序的变更频率其实是空的（cycle-105 P1-5 教训）。
 */
export const HotspotPanel = memo(function HotspotPanel({ hotspotNodes, churnStatus, onClose, label }: HotspotPanelProps) {
  const t = useT();

  return (
    <AnalysisPanelShell variant="hotspot" label={label} onClose={onClose}>
      {churnStatus && churnStatus.state !== 'idle' && (
        <div className="cg-hotspot-churn-status" role="status" aria-live="polite">
          {churnStatus.state === 'loading' && t('hotspot.churn.loading')}
          {churnStatus.state === 'unavailable' && (
            <>
              <span>{t('hotspot.churn.unavailable')}</span>
              {churnStatus.error && (
                <span className="cg-hotspot-churn-reason">
                  {t('hotspot.churn.unavailableReason').replace('{reason}', churnStatus.error)}
                </span>
              )}
            </>
          )}
          {churnStatus.state === 'ready' && (
            <>
              <span>{t('hotspot.churn.ready').replace('{count}', String(churnStatus.commitCount))}</span>
              {churnStatus.truncated && (
                <span className="cg-hotspot-churn-truncated">
                  {t('hotspot.churn.truncated').replace('{count}', String(churnStatus.commitCount))}
                </span>
              )}
            </>
          )}
        </div>
      )}
      {hotspotNodes.length > 0 && (
        <div className="cg-hotspot-column-header" role="row">
          <span className="cg-hotspot-level-badge" aria-hidden="true"> </span>
          <span className="cg-hotspot-label">{t('hotspot.title')}</span>
          <span className="cg-hotspot-indegree" title={t('hotspot.churn.columnIndegree')}>{t('hotspot.churn.columnIndegree')}</span>
          <span className="cg-hotspot-churn" title={t('hotspot.churn.columnChurn')}>{t('hotspot.churn.columnChurn')}</span>
          <span className="cg-hotspot-score" title={t('hotspot.churn.columnScore')}>{t('hotspot.churn.columnScore')}</span>
        </div>
      )}
      {hotspotNodes.slice(0, 20).map((h) => (
        <div key={h.nodeId} className={`cg-hotspot-item cg-${h.level}`} role="row">
          <span className="cg-hotspot-level-badge">{h.level}</span>
          <span className="cg-hotspot-label" title={h.filePath}>{h.label}</span>
          <span className="cg-hotspot-indegree">{h.indegree}</span>
          <span className="cg-hotspot-churn">{h.churn}</span>
          <span className="cg-hotspot-score">{h.hotspotScore}</span>
        </div>
      ))}
    </AnalysisPanelShell>
  );
});
