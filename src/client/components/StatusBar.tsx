import React from 'react';
import { useT } from '../i18n/index.ts';
import { deriveWorkspaceName } from '../utils/deriveName.ts';

interface StatusBarProps {
  error: string | null;
  isLoading: boolean;
  lastUpdated: number;
  watchEnabled: boolean;
  workspaceName?: string;
  truncated?: boolean;
  totalNodeCount?: number;
  totalEdgeCount?: number;
  displayedNodeCount?: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function StatusBar({ error, isLoading, lastUpdated, watchEnabled, workspaceName, truncated, totalNodeCount, totalEdgeCount, displayedNodeCount }: StatusBarProps) {
  const t = useT();
  const statusDotClass = error ? 'status-dot error' : isLoading ? 'status-dot loading' : 'status-dot';
  const statusText = error ? t('state.error') : isLoading ? t('state.loading') : t('state.ready');
  const wsName = workspaceName ? deriveWorkspaceName(workspaceName) : '';
  return (
    <div className="status-bar">
      <div className="status-item">
        <span className={statusDotClass} /><span>{statusText}</span>
      </div>
      {wsName && <span className="status-workspace" title={workspaceName}>{wsName}</span>}
      {truncated ? (
        <span className="status-truncated" title={t('state.truncatedHint')}>
          ⚠ {t('state.truncated', { shown: displayedNodeCount ?? 0, total: totalNodeCount ?? 0 })}
        </span>
      ) : totalNodeCount && totalNodeCount > 0 ? (
        <span className="status-complete" title={t('state.complete', { total: totalNodeCount })}>
          ✓ {t('state.complete', { total: totalNodeCount })}
        </span>
      ) : null}
      {watchEnabled && <span className="watch-indicator" title={t('import.watchOn')}>●</span>}
      <div className="status-spacer" />
      <div className="status-item">
        <span className="status-time">
          {lastUpdated > 0 ? t('state.updated', { time: formatTime(lastUpdated) }) : t('state.noData')}
        </span>
      </div>
    </div>
  );
}