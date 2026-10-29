import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import { useT } from '../i18n/index.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { useShallow } from 'zustand/shallow';
import { summarizeKeywordResult, truncationReasonKey, seedIdsOf } from '../store/slices/keywordQuerySlice.ts';

/**
 * 关键词图检索面板（cycle-111 / N-5）。
 *
 * ## 这个面板补的是「能力只落到一半」的缺口
 *
 * 关键词 → 种子 → 有界子图 → token 预算内文本 这套算法一直在库里
 * （`src/xuanji/query/keyword-query.ts`），`src/tools.ts` 的 `graph_query` 也一直在用。
 * 但 `grep -rn "keywordQuery|graph_query" src/client/` = 0 命中：**只有 LLM 面，没有人类面**。
 * 本面板是那一半，且它不重写算法——所有判定（种子、跳数、预算、截断）都由宿主
 * `/query` 调库完成，面板只渲染。
 *
 * ## 四态为什么必须各自可见
 *
 * 「空查询 / 无结果 / 失败 / 超时」在画面上都可能是「什么都没有」。本仓反复记录过
 * 「失败伪装成没有数据」这一形态（空结果 = 图里没有这个符号？还是请求挂了？）。
 * 因此四种状态各有自己的 DOM 与文案，且互不兼得——由 `keywordQueryStatus` 一个字段裁决，
 * 不在组件里推导。
 *
 * ## 为什么输入框的受控值留在本地 state
 *
 * `keywordQuery`（已提交的词）进 store，因为它是"一次请求的结果"的一部分；
 * 而**击键中的值**是纯 UI 交互状态，放进 store 会让每次按键触发全局面板重渲染
 * （store 的订阅粒度是切片级）。这也是本仓 `searchQuery` 与 `SearchBar` 输入框的同一分工。
 */
interface KeywordQueryPanelProps {
  onClose: () => void;
  label: string;
}

/** 与宿主 `QUERY.MAX_QUERY_LENGTH` 同值：面板在本地先截断，避免发出注定 400 的请求。 */
const MAX_INPUT_LENGTH = 512;

export const KeywordQueryPanel = memo(function KeywordQueryPanel({ onClose, label }: KeywordQueryPanelProps) {
  const t = useT();
  // 逐字段选择而不是整片取：`useShallow` 保证只有这些字段真的变化时才重渲染。
  const {
    keywordQuery,
    keywordQueryStatus,
    keywordQueryResult,
    keywordQueryError,
    runKeywordQuery,
    clearKeywordQuery,
    selectKeywordSeed,
  } = useGraphStore(useShallow((s) => ({
    keywordQuery: s.keywordQuery,
    keywordQueryStatus: s.keywordQueryStatus,
    keywordQueryResult: s.keywordQueryResult,
    keywordQueryError: s.keywordQueryError,
    runKeywordQuery: s.runKeywordQuery,
    clearKeywordQuery: s.clearKeywordQuery,
    selectKeywordSeed: s.selectKeywordSeed,
  })));

  const [draft, setDraft] = useState(keywordQuery);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 面板打开即聚焦输入框：这是本面板唯一的主要动作，
  // 让用户先按 Tab 找输入框是纯粹的浪费（与 `SearchBar` 的自动聚焦同一取舍）。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // store 里的已提交词被外部清空（Esc / 清空按钮）时，把输入框同步回来。
  // 不做这一步的话，"清空"之后输入框里还留着旧词，用户会以为清空没生效。
  useEffect(() => {
    setDraft(keywordQuery);
  }, [keywordQuery]);

  const submit = useCallback(() => {
    const value = draft.trim();
    // 空查询不发请求：宿主会回 400，而"点了一下什么都没发生"比"明确告诉你先输入"更糟。
    if (value.length === 0) {
      clearKeywordQuery();
      return;
    }
    void runKeywordQuery(value);
  }, [draft, runKeywordQuery, clearKeywordQuery]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    // Esc 关闭面板。`stopPropagation` 是必需的：`usePanelKeyboard` 的全局 Esc 会
    // `panel.closeAll()` 一口气关掉所有面板，用户按一次 Esc 期望只关这一个。
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
  }, [onClose]);

  const summary = useMemo(() => summarizeKeywordResult(keywordQueryResult), [keywordQueryResult]);
  const seeds = keywordQueryResult?.seeds ?? [];
  const highlightIds = useMemo(() => new Set(seedIdsOf(keywordQueryResult) as string[]), [keywordQueryResult]);
  const isLoading = keywordQueryStatus === 'loading';
  const isTruncated = summary.truncated === true;

  /**
   * `aria-live` 的播报文本。
   *
   * 只播报**终态**（有结果 / 无结果 / 失败），不播报 `loading`：屏幕阅读器在用户每敲
   * 一次回车时读一遍"检索中"是噪声。`aria-live` 的语义要求是"内容变化时说一次"，
   * 因此这里在 `loading` 时返回空串（元素仍在，只是没有内容可播）。
   */
  const announcement = useMemo(() => {
    if (keywordQueryStatus === 'ready') {
      return t('keywordQuery.announce', { n: seeds.length, nodes: summary.nodes });
    }
    if (keywordQueryStatus === 'empty') return t('keywordQuery.empty');
    if (keywordQueryStatus === 'error') return t('keywordQuery.error');
    if (keywordQueryStatus === 'timeout') return t('keywordQuery.timeout');
    return '';
  }, [keywordQueryStatus, seeds.length, summary.nodes, t]);

  return (
    <AnalysisPanelShell
      variant="keywordquery"
      label={label}
      onClose={onClose}
      badge={keywordQueryStatus === 'ready' ? <span className="cg-keywordquery-count-badge">{seeds.length}</span> : undefined}
    >
      <div className="cg-keywordquery-body" onKeyDown={handleKeyDown}>
        <form
          className="cg-keywordquery-form"
          role="search"
          onSubmit={(event) => {
            // 表单提交承接 Enter：`<input>` 在 form 里回车会触发 submit。
            // 不用 input 的 onKeyDown 拦 Enter，是因为那样会绕过浏览器的表单语义
            // （包括移动端的"前往"键）。
            event.preventDefault();
            submit();
          }}
        >
          <label className="cg-visually-hidden" htmlFor="cg-keywordquery-input">
            {t('keywordQuery.inputLabel')}
          </label>
          <input
            ref={inputRef}
            id="cg-keywordquery-input"
            name="keywordQuery"
            className="cg-keywordquery-input"
            type="search"
            role="searchbox"
            aria-label={t('keywordQuery.inputLabel')}
            placeholder={t('keywordQuery.placeholder')}
            maxLength={MAX_INPUT_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter 必须**在输入框上**显式处理，不能只依赖 `<form>` 的隐式提交：
              // jsdom 不实现"回车隐式提交"，只靠 onSubmit 会让键盘路径在单测里走不通，
              // 而"单测走不通"通常会被人用 `fireEvent.submit` 绕过——那测的就不是键盘了。
              // 真实浏览器里两条路径都到 `submit()`，行为一致（`preventDefault` 防止重复提交）。
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
            disabled={isLoading}
          />
          <button
            type="submit"
            className="cg-keywordquery-submit"
            disabled={isLoading || draft.trim().length === 0}
            aria-busy={isLoading}
            title={t('keywordQuery.submit')}
          >
            {isLoading ? t('keywordQuery.loading') : t('keywordQuery.submit')}
          </button>
          <button
            type="button"
            className="cg-keywordquery-clear"
            disabled={draft.length === 0 && keywordQueryStatus === 'idle'}
            onClick={() => {
              setDraft('');
              clearKeywordQuery();
              inputRef.current?.focus();
            }}
            title={t('keywordQuery.clear')}
            aria-label={t('keywordQuery.clear')}
          >
            {t('keywordQuery.clear')}
          </button>
        </form>

        {/* 播报区：终态变化时说一次，`loading` 静默。 */}
        <div className="cg-keywordquery-live" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>

        {keywordQueryStatus === 'idle' && (
          <div className="cg-keywordquery-idle">
            <div className="cg-keywordquery-idle-title">{t('keywordQuery.idle')}</div>
            <div className="cg-keywordquery-idle-hint">{t('keywordQuery.emptyHint')}</div>
          </div>
        )}

        {isLoading && (
          <div className="cg-keywordquery-loading" aria-hidden="true">
            {t('keywordQuery.loading')}
          </div>
        )}

        {keywordQueryStatus === 'empty' && (
          <div className="cg-keywordquery-empty">
            <div className="cg-keywordquery-empty-title">{t('keywordQuery.empty')}</div>
            <div className="cg-keywordquery-empty-hint">{t('keywordQuery.emptyHint')}</div>
          </div>
        )}

        {keywordQueryStatus === 'error' && (
          <div className="cg-keywordquery-error">
            <div className="cg-keywordquery-error-title">{keywordQueryError ? t(keywordQueryError) : t('keywordQuery.error')}</div>
            <button
              type="button"
              className="cg-keywordquery-retry"
              onClick={() => { void runKeywordQuery(draft); }}
            >
              {t('keywordQuery.retry')}
            </button>
          </div>
        )}

        {keywordQueryStatus === 'timeout' && (
          <div className="cg-keywordquery-timeout">
            <div className="cg-keywordquery-timeout-title">{t('keywordQuery.timeout')}</div>
            <button
              type="button"
              className="cg-keywordquery-retry"
              onClick={() => { void runKeywordQuery(draft); }}
            >
              {t('keywordQuery.retry')}
            </button>
          </div>
        )}

        {(keywordQueryStatus === 'ready' || isTruncated) && keywordQueryResult && (
          <>
            {/*
              截断提示：graphify 原则「截断必须显式到不可能被误读」。
              它**独立于**四种状态渲染（放在 ready 之外的条件里同样是 `|| isTruncated`），
              因为截断是结果的一个属性，不是一种状态：`nodes-only` 分支下结果可用但边被省略，
              用户必须知道"这不是完整结果"，否则会以为图里没有那条边。
            */}
            {isTruncated && (
              <div className="cg-keywordquery-truncated" role="status">
                {t('keywordQuery.truncated', { reason: t(truncationReasonKey(keywordQueryResult.reason)) })}
              </div>
            )}

            <div className="cg-keywordquery-section">
              <div className="cg-keywordquery-section-header">
                <span className="cg-keywordquery-section-title">
                  {t('keywordQuery.seeds', { n: seeds.length })}
                </span>
                <span className="cg-keywordquery-section-meta">
                  {t(keywordQueryResult.meta.source === 'fetched' ? 'keywordQuery.sourceFetched' : 'keywordQuery.sourceSlot')}
                </span>
              </div>
              {seeds.length === 0 ? (
                <div className="cg-keywordquery-seeds-empty">{t('keywordQuery.empty')}</div>
              ) : (
                <ul className="cg-keywordquery-seed-list">
                  {seeds.map((seed) => (
                    <li key={seed.id}>
                      <button
                        type="button"
                        className={`cg-keywordquery-seed${highlightIds.has(seed.id) ? ' cg-active' : ''}`}
                        onClick={() => selectKeywordSeed(seed.id)}
                        title={`${seed.label} — ${t('keywordQuery.score', { score: seed.score })}`}
                      >
                        <span className="cg-keywordquery-seed-label">{seed.label}</span>
                        <span className="cg-keywordquery-seed-score">{seed.score}</span>
                        {seed.matchedTerms.length > 0 && (
                          <span className="cg-keywordquery-seed-terms">
                            {/* 命中词高亮：解释「为什么它被选中」，否则种子列表只是几个名字。 */}
                            {seed.matchedTerms.map((term) => (
                              <mark key={term} className="cg-keywordquery-term">{term}</mark>
                            ))}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="cg-keywordquery-section">
              <div className="cg-keywordquery-section-header">
                <span className="cg-keywordquery-section-title">{t('keywordQuery.subgraph')}</span>
                <span className="cg-keywordquery-section-meta">
                  {t('keywordQuery.depth', { depth: keywordQueryResult.meta.depthEffective })}
                  {' · '}
                  {t('keywordQuery.budget', { budget: keywordQueryResult.meta.tokenBudget })}
                </span>
              </div>
              <div className="cg-keywordquery-summary">
                {t('keywordQuery.summary', {
                  nodes: summary.nodes,
                  edges: summary.edges,
                  tokens: summary.tokens,
                })}
              </div>
              <div className="cg-keywordquery-summary-reason">
                <span className={`cg-keywordquery-reason${isTruncated ? ' cg-truncated' : ''}`}>
                  {t(truncationReasonKey(keywordQueryResult.reason))}
                </span>
              </div>
            </div>

            {keywordQueryResult.text.length > 0 && (
              <details className="cg-keywordquery-raw">
                <summary>{t('keywordQuery.rawText')}</summary>
                {/* 原始文本与工具面（`graph_query`）看到的是**同一份**渲染结果， */}
                {/* 保留它是为了让"面板说的"与"LLM 看到的"可以被用户直接对照。 */}
                <pre className="cg-keywordquery-raw-text">{keywordQueryResult.text}</pre>
              </details>
            )}
          </>
        )}
      </div>
    </AnalysisPanelShell>
  );
});
