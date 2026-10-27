import { memo, useState, useCallback } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import { useT } from '../i18n/index.ts';
import { DIFF_STATUSES, type DiffMarkStats } from '../../shared/diffStatus.ts';
import type { DiffState } from '../store/types.ts';

interface DiffPanelProps {
  /** 当前生效的对比结果；`null` 表示还没有发起过对比。 */
  diffResult: DiffState | null;
  /** 最近一次标记统计，含「diff 里有、但当前视图没渲染」的差额。 */
  markStats: DiffMarkStats | null;
  isComparing: boolean;
  /** 请求失败消息（已翻译）。`null` 表示没有错误。 */
  errorMessage: string | null;
  onCompare: (from: string, to: string) => void;
  onClear: () => void;
  onClose: () => void;
}

/**
 * 版本对比面板（研究报告 §六 #13）。
 *
 * 设计上有三条与验收直接相关的判断：
 *
 * 1. **失败与空 diff 必须视觉可分**。请求失败时显示错误块并**保留**上一次结果，
 *    而不是渲染成「0 处变更」。用户把一次失败读成「两版本完全一样」是这个功能最坏的失效形态。
 * 2. **必须披露「未渲染差额」**。`markStats.missing > 0` 表示 diff 覆盖的元素里有元素不在
 *    当前画布上（用户只展开了部分目录）。若面板只报总数而不提这一点，用户会数着「新增 3」
 *    却只看到 1 个绿框，然后认为标记丢了。
 * 3. **输入用受控本地状态，不用 store**。两个 git 引用只在这一次提交时有用，进 store 就要
 *    回答持久化与跨会话恢复的问题，而恢复一个用户没发起的对比状态只会造成困惑。
 */
export const DiffPanel = memo(function DiffPanel({
  diffResult, markStats, isComparing, errorMessage, onCompare, onClear, onClose,
}: DiffPanelProps) {
  const t = useT();
  const [from, setFrom] = useState('HEAD~1');
  const [to, setTo] = useState('HEAD');

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmedFrom = from.trim();
    const trimmedTo = to.trim();
    // 空引用不发请求：宿主会用 COMMITS_REQUIRED 拒绝，但让用户先看到一次往返错误是浪费。
    if (!trimmedFrom || !trimmedTo) return;
    onCompare(trimmedFrom, trimmedTo);
  }, [from, to, onCompare]);

  const totalChanges = markStats
    ? markStats.counts.added + markStats.counts.modified + markStats.counts.removed
    : 0;

  return (
    <AnalysisPanelShell variant="diff" label={t('diff.title')} onClose={onClose}>
      <form className="cg-diff-form" onSubmit={handleSubmit}>
        <label className="cg-diff-field" htmlFor="cg-diff-from">
          <span className="cg-diff-field-label">{t('diff.from')}</span>
          <input
            id="cg-diff-from"
            name="diff-from"
            className="cg-diff-input cg-diff-input-from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="HEAD~1"
            aria-label={t('diff.from')}
          />
        </label>
        <label className="cg-diff-field" htmlFor="cg-diff-to">
          <span className="cg-diff-field-label">{t('diff.to')}</span>
          <input
            id="cg-diff-to"
            name="diff-to"
            className="cg-diff-input cg-diff-input-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="HEAD"
            aria-label={t('diff.to')}
          />
        </label>
        <div className="cg-diff-actions">
          <button
            type="submit"
            className="cg-diff-run-btn"
            disabled={isComparing}
            aria-busy={isComparing}
          >
            {isComparing ? t('diff.comparing') : t('diff.compare')}
          </button>
          {diffResult && (
            <button type="button" className="cg-diff-clear-btn" onClick={onClear}>
              {t('diff.clear')}
            </button>
          )}
        </div>
      </form>

      {errorMessage && (
        <div className="cg-diff-error" role="alert">
          {errorMessage}
        </div>
      )}

      {!diffResult && !errorMessage && (
        <div className="cg-diff-empty">{t('diff.empty')}</div>
      )}

      {diffResult && markStats && (
        <>
          <div className="cg-diff-range">
            <span className="cg-diff-range-from">{diffResult.from}</span>
            <span className="cg-diff-range-arrow" aria-hidden="true">→</span>
            <span className="cg-diff-range-to">{diffResult.to}</span>
          </div>

          {/*
            粒度披露（cycle-105 P0-D）。这份 diff 来自 `git diff --raw`，是**文件级**的：
            `codegraph.db` 没有 revision 维度，符号级对比在数据面上不可实现。不写这一行，
            用户会理所当然地以为「新增 3」指的是 3 个函数。
          */}

          {/*
            截断披露。一份被截断的清单与完整清单长得一模一样，用户会以为「只改了这些文件」。
            只在真的截断时渲染——无条件渲染会让这条提示退化成装饰，用户学会忽略它。
          */}
          <div className="cg-diff-granularity" role="note">
            {t('diff.granularityFile')}
          </div>

          {diffResult.truncated && (
            <div className="cg-diff-truncated" role="alert">
              {t('diff.truncated')}
            </div>
          )}

          <div className="cg-diff-counts" role="list" aria-label={t('diff.countsLabel')}>
            {DIFF_STATUSES.map((status) => (
              <div key={status} className={`cg-diff-count-row cg-diff-count-${status}`} role="listitem">
                <span className={`cg-diff-badge cg-diff-badge-${status}`} aria-hidden="true" />
                <span className="cg-diff-count-label">{t(`diff.status.${status}`)}</span>
                <span className="cg-diff-count-value">{markStats.counts[status]}</span>
              </div>
            ))}
          </div>

          {/*
            「已标记 / 未渲染」这一行是这个面板的关键诚实披露：总数与画布上真实亮起的数量
            可以不同，差额必须写出来。`missing === 0` 时显示「全部已标记」，避免用户
            怀疑是否还有没看到的标记。
          */}
          <div className="cg-diff-marked" role="status" aria-live="polite">
            {markStats.missing > 0
              ? t('diff.markedPartial', { marked: markStats.marked, total: totalChanges, missing: markStats.missing })
              : t('diff.markedAll', { marked: markStats.marked })}
          </div>

          {totalChanges === 0 && (
            <div className="cg-diff-nochange">{t('diff.noFileChange')}</div>
          )}
        </>
      )}
    </AnalysisPanelShell>
  );
});
