
import { memo } from 'react';
import { useT } from '../i18n/index.ts';
import { deriveWorkspaceName } from '../utils/deriveName.ts';
import { GithubIcon } from './Icons.tsx';
import { useExpandedFunctionBodyCount } from '../hooks/useExpandedFunctionBodyCount.ts';

import { REPO_URL, FUNCTION_BODY } from '../../shared/constants.ts';

interface StatusBarProps {
  error: string | null;
  isLoading: boolean;
  lastUpdated: number;
  watchEnabled: boolean;
  workspaceName?: string;
  truncated?: boolean;
  totalNodeCount?: number;
  displayedNodeCount?: number;
  performanceDegradations?: string[];
  /**
   * 图层来源声明（cycle-130 · T2）：'upstream' = 上游索引、'native' = 原生通道、
   * 'empty' = 空态。undefined = host 未提供——徽章缺席渲染（宁缺勿造）。
   */
  graphLayer?: 'upstream' | 'native' | 'empty';
  /**
   * 璇玑图增量引擎健康信号（cycle-122）：null/缺省 = 本轮非增量路径 ⇒ 不显示。
   * 显示规则（量化 + 白盒）：增量命中 ⇒「⚡ 增量 +N」；有规则被降级 ⇒ 追加「· R 降级」
   * 并染警示色。信号只在引擎真实跑过时出现（skipped/全量重建都不显示——
   * 不伪造观测）。
   */
  xuanjiSignal?: { applied: boolean; addedPaths?: number; degradedRules?: readonly string[]; invariantViolations?: readonly string[] } | null;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

const DEGRADATION_KEYS: Record<string, string> = {
  'cycle-detection-skipped': 'degradation.cycleDetectionSkipped',
  'community-detection-sampled': 'degradation.communityDetectionSampled',
  'large-graph-mode': 'degradation.largeGraphMode',
};

export const StatusBar = memo(function StatusBar({ error, isLoading, lastUpdated, watchEnabled, workspaceName, truncated, totalNodeCount, displayedNodeCount, performanceDegradations, xuanjiSignal, graphLayer }: StatusBarProps) {
  const t = useT();
  const statusDotClass = error ? 'cg-status-dot cg-error' : isLoading ? 'cg-status-dot cg-loading' : 'cg-status-dot';
  const statusText = error ? t('state.error') : isLoading ? t('state.loading') : t('state.ready');
  const wsName = workspaceName ? deriveWorkspaceName(workspaceName) : '';
  const hasDegradations = performanceDegradations && performanceDegradations.length > 0;
  const degradationLabels = hasDegradations
    ? performanceDegradations!.map((key) => DEGRADATION_KEYS[key] ? t(DEGRADATION_KEYS[key]) : key).join(', ')
    : '';
  // 璇玑图增量信号（cycle-122）：applied 才显示；降级/违例染色警示。
  const degradedRules = xuanjiSignal?.degradedRules ?? [];
  const violatedRules = xuanjiSignal?.invariantViolations ?? [];
  const showXuanji = xuanjiSignal?.applied === true;
  const xuanjiDegraded = degradedRules.length > 0 || violatedRules.length > 0;

  const { expandedFunctionCount, totalFunctionCount, expandedNodeIdsSize } = useExpandedFunctionBodyCount();
  const showFunctionBudget = expandedFunctionCount > 0 || (totalFunctionCount > FUNCTION_BODY.MAX_EXPANDED && expandedNodeIdsSize > 0);

  return (
    <div className="cg-status-bar" role="status" aria-live="polite">
      <div className="cg-status-item">
        <span className={statusDotClass} /><span>{statusText}</span>
      </div>
      {wsName && <span className="cg-status-workspace" title={workspaceName}>{wsName}</span>}
      {/* cycle-130 · T2：数据来源徽章——「数据来自上游索引还是原生通道」白盒透出。
          undefined = host 未提供（旧版 host / 未走原生链路），缺席渲染（宁缺勿造）。 */}
      {graphLayer && (
        <span className={`cg-status-graph-layer cg-status-graph-layer--${graphLayer}`} title={t(`state.graphLayer.${graphLayer}`)}>
          {t(`state.graphLayer.${graphLayer}`)}
        </span>
      )}
      {truncated ? (
        <span className="cg-status-truncated" title={t('state.truncatedHint')}>
          ⚠ {t('state.truncated', { shown: displayedNodeCount ?? 0, total: totalNodeCount ?? 0 })}
        </span>
      ) : totalNodeCount && totalNodeCount > 0 ? (
        <span className="cg-status-complete" title={t('state.complete', { total: totalNodeCount })}>
          ✓ {t('state.complete', { total: totalNodeCount })}
        </span>
      ) : null}
      {showFunctionBudget && (
        <span className="cg-status-function-budget" title={t('state.functionBudget', { expanded: expandedFunctionCount, total: totalFunctionCount })}>
          {t('state.functionBudget', { expanded: expandedFunctionCount, total: totalFunctionCount })}
        </span>
      )}
      {hasDegradations && (
        <span className="cg-status-degradation" title={t('degradation.tooltip')}>
          ⚠ {degradationLabels}
        </span>
      )}
      {watchEnabled && <span className="cg-watch-indicator" title={t('import.watchOn')}>●</span>}
      <div className="cg-status-spacer" />
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="cg-status-github"
        title={t('status.feedback')}
        aria-label={t('status.feedback')}
      >
        <GithubIcon size={14} />
      </a>
      <div className="cg-status-item">
        <span className="cg-status-time">
          {lastUpdated > 0 ? t('state.updated', { time: formatTime(lastUpdated) }) : t('state.noData')}
        </span>
      </div>
      {showXuanji && (
        <span
          className={`cg-status-xuanji${xuanjiDegraded ? ' cg-xuanji-degraded' : ''}`}
          title={[
            t('state.xuanjiHint'),
            ...(degradedRules.length > 0 ? [t('state.xuanjiDegraded', { rules: degradedRules.join(', ') })] : []),
            ...(violatedRules.length > 0 ? [t('state.xuanjiViolated', { rules: violatedRules.join(', ') })] : []),
          ].join('\n')}
        >
          ⚡ {t('state.xuanjiIncremental', { n: xuanjiSignal?.addedPaths ?? 0 })}
          {degradedRules.length > 0 && <> · {t('state.xuanjiDegradedShort', { n: degradedRules.length })}</>}
        </span>
      )}
    </div>
  );
});
