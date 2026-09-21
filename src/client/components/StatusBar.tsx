
import { memo } from 'react';
import { useT } from '../i18n/index.ts';
import { deriveWorkspaceName } from '../utils/deriveName.ts';
import { GithubIcon } from './Icons.tsx';

const GITHUB_REPO_URL = 'https://github.com/xuanyuanchumo/dsh-codegraph-visualizer';

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

export const StatusBar = memo(function StatusBar({ error, isLoading, lastUpdated, watchEnabled, workspaceName, truncated, totalNodeCount, displayedNodeCount, performanceDegradations }: StatusBarProps) {
  const t = useT();
  const statusDotClass = error ? 'cg-status-dot cg-error' : isLoading ? 'cg-status-dot cg-loading' : 'cg-status-dot';
  const statusText = error ? t('state.error') : isLoading ? t('state.loading') : t('state.ready');
  const wsName = workspaceName ? deriveWorkspaceName(workspaceName) : '';
  const hasDegradations = performanceDegradations && performanceDegradations.length > 0;
  const degradationLabels = hasDegradations
    ? performanceDegradations!.map((key) => DEGRADATION_KEYS[key] ? t(DEGRADATION_KEYS[key]) : key).join(', ')
    : '';
  return (
    <div className="cg-status-bar" role="status" aria-live="polite">
      <div className="cg-status-item">
        <span className={statusDotClass} /><span>{statusText}</span>
      </div>
      {wsName && <span className="cg-status-workspace" title={workspaceName}>{wsName}</span>}
      {truncated ? (
        <span className="cg-status-truncated" title={t('state.truncatedHint')}>
          ⚠ {t('state.truncated', { shown: displayedNodeCount ?? 0, total: totalNodeCount ?? 0 })}
        </span>
      ) : totalNodeCount && totalNodeCount > 0 ? (
        <span className="cg-status-complete" title={t('state.complete', { total: totalNodeCount })}>
          ✓ {t('state.complete', { total: totalNodeCount })}
        </span>
      ) : null}
      {hasDegradations && (
        <span className="cg-status-degradation" title={t('degradation.tooltip')}>
          ⚠ {degradationLabels}
        </span>
      )}
      {watchEnabled && <span className="cg-watch-indicator" title={t('import.watchOn')}>●</span>}
      <div className="cg-status-spacer" />
      <a
        href={GITHUB_REPO_URL}
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
    </div>
  );
});
