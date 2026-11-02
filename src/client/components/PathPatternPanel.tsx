import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalysisPanelShell } from './AnalysisPanelShell.tsx';
import { useT } from '../i18n/index.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { useShallow } from 'zustand/shallow';
import { summarizePathPatternResult, pathHopsOf } from '../store/slices/pathPatternSlice.ts';
import type { PathPatternOptions } from '../store/slices/pathPatternSlice.ts';
import { fetchPathPatternSyntax } from '../api/pathPattern.ts';

/**
 * 璇玑图 ρ（边类型序列正则）面板（cycle-135）。
 *
 * ## 这个面板补的是「ρ 只有模型能调」的缺口
 *
 * `graph_path_enumerate` 与宿主路由 `/api/v1/codegraph/paths?pattern=` 都已存在，
 * 但 `grep -rn "pathPattern" src/client/` 此前为 0 命中：**只有模型面，没有人类面**。
 * 本面板是那一半，且它不重写枚举算法——ρ 的编译、Σ 校验、分页全部由宿主完成，
 * 面板只负责「把 ρ 发出去」与「把五态讲清楚」。
 *
 * ## 五态为什么必须各自可见
 *
 * 「没有匹配 / 拼错类型名 / 语法错误 / 没有图 / 失败 / 超时」在画面上都可能是
 * 「什么都没有」。本仓反复记录过「空集冒充结论」这一形态（`calls+` 与「图上没有
 * call 边」返回同形，若不区分，用户必然误判）。因此每一种终态各有自己的 DOM 与
 * 文案，且互不兼得——由 `pathPatternStatus` 一个字段裁决，不在组件里推导。
 *
 * **核心不变量**：「拼错类型名」（`unknown-types`）绝不允许渲染成「没有匹配」
 * （`empty`）。`tests/component/PathPatternPanel.test.tsx` 对此有逐态的正向与反向断言。
 *
 * ## 为什么输入框的受控值留在本地 state
 *
 * 已提交的 ρ 进 store（它是「一次请求的结果」的一部分）；击键中的值是纯 UI 交互
 * 状态，放进 store 会让每次按键触发全局面板重渲染（store 的订阅粒度是切片级）。
 * 这也是本仓 `searchQuery` 与 `KeywordQueryPanel` 输入框的同一分工。
 */
interface PathPatternPanelProps {
  onClose: () => void;
  label: string;
}

/** 与宿主路由的 clamp 同口径（`pathsRoute.ts` 的 `clampInt`）。 */
const LIMITS = Object.freeze({
  MIN_HOPS: 0,
  MAX_HOPS: 12,
  DEFAULT_MIN_HOPS: 0,
  DEFAULT_MAX_HOPS: 8,
  MIN_LIMIT: 1,
  MAX_LIMIT: 50,
  DEFAULT_LIMIT: 20,
  /** 输入框长度上限，避免发出注定 400 的长 ρ。 */
  MAX_INPUT_LENGTH: 2048,
} as const);

/** 夹紧到 [lo, hi] 并取整；NaN/空输入回落到缺省（number input 的空串 parse 出 NaN）。 */
function clampInt(raw: string, lo: number, hi: number, fallback: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export const PathPatternPanel = memo(function PathPatternPanel({ onClose, label }: PathPatternPanelProps) {
  const t = useT();
  // 逐字段选择而不是整片取：`useShallow` 保证只有这些字段真的变化时才重渲染。
  const {
    pathPattern,
    pathPatternStatus,
    pathPatternResult,
    pathPatternError,
    pathPatternEdgeTypes,
    pathPatternEdgeTypesStatus,
    runPathPattern,
    clearPathPattern,
    runPathPatternNextPage,
    fetchPathPatternEdgeTypes,
  } = useGraphStore(useShallow((s) => ({
    pathPattern: s.pathPattern,
    pathPatternStatus: s.pathPatternStatus,
    pathPatternResult: s.pathPatternResult,
    pathPatternError: s.pathPatternError,
    pathPatternEdgeTypes: s.pathPatternEdgeTypes,
    pathPatternEdgeTypesStatus: s.pathPatternEdgeTypesStatus,
    runPathPattern: s.runPathPattern,
    clearPathPattern: s.clearPathPattern,
    runPathPatternNextPage: s.runPathPatternNextPage,
    fetchPathPatternEdgeTypes: s.fetchPathPatternEdgeTypes,
  })));

  const [draft, setDraft] = useState(pathPattern);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 控件是击键中的纯 UI 交互状态，只在提交时夹紧并传给 store（与 threshold 控件同分工）。
  const [startDraft, setStartDraft] = useState('');
  const [endDraft, setEndDraft] = useState('');
  const [minHopsDraft, setMinHopsDraft] = useState(String(LIMITS.DEFAULT_MIN_HOPS));
  const [maxHopsDraft, setMaxHopsDraft] = useState(String(LIMITS.DEFAULT_MAX_HOPS));
  const [limitDraft, setLimitDraft] = useState(String(LIMITS.DEFAULT_LIMIT));

  // 面板打开即聚焦输入框：这是本面板唯一的主要动作。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // cycle-136：Σ 是宿主侧事实，打开面板时取一次（store 里幂等：已 ready 就不重复取）。
  // 放在 store 而不是本地 state：面板关闭再打开不应该重新付一次网络成本。
  useEffect(() => {
    void fetchPathPatternEdgeTypes();
  }, [fetchPathPatternEdgeTypes]);

  // cycle-136：ρ 的**逐键语法预检**（防抖 250ms）。
  //
  // 为什么必须有：提交按钮在语法非法时禁用，避免发出注定 400 的请求（本仓库反复记录过
  // 「发注定失败的请求」家族）。为什么防抖：逐键调用 `/path-pattern/syntax` 会在每次击键
  // 付一次网络往返；250ms 对打字足够连续、对网络足够收敛。
  //
  // `syntaxOk === null` 表示「还没查完」——此时**不禁用**提交按钮（用户可能输入完立刻
  // 回车）；只有 `false`（确定语法非法）才禁用。这是刻意的：把「未查完」当成「非法」
  // 会让用户在首次输入后无法提交，而服务端本来就会校验。
  const [syntaxOk, setSyntaxOk] = useState<boolean | null>(null);
  const [syntaxDiagnostic, setSyntaxDiagnostic] = useState('');
  const syntaxTimer = useRef<number | undefined>(undefined);
  const syntaxSeq = useRef(0);

  useEffect(() => {
    const value = draft.trim();
    if (value.length === 0) {
      setSyntaxOk(null);
      setSyntaxDiagnostic('');
      return;
    }
    window.clearTimeout(syntaxTimer.current);
    syntaxTimer.current = window.setTimeout(() => {
      const seq = syntaxSeq.current + 1;
      syntaxSeq.current = seq;
      void (async () => {
        const outcome = await fetchPathPatternSyntax(value);
        if (seq !== syntaxSeq.current) return; // 过期响应：用户已输入新内容
        if (outcome.ok) {
          setSyntaxOk(true);
          setSyntaxDiagnostic('');
        } else {
          setSyntaxOk(false);
          setSyntaxDiagnostic(outcome.diagnostic || outcome.error || '');
        }
      })();
    }, 250);
    return () => window.clearTimeout(syntaxTimer.current);
  }, [draft]);

  // store 里的已提交 ρ 被外部清空（Esc / 清空按钮）时，把输入框同步回来。
  useEffect(() => {
    setDraft(pathPattern);
  }, [pathPattern]);

  /** 统一的「按当前控件发一次枚举」：submit 与 error/timeout 的 retry 都走它。 */
  const submit = useCallback((raw: string) => {
    const value = raw.trim();
    if (value.length === 0) {
      clearPathPattern();
      return;
    }
    const options: PathPatternOptions = {
      ...(startDraft.trim() ? { startNode: startDraft.trim() } : {}),
      ...(endDraft.trim() ? { endNode: endDraft.trim() } : {}),
      minHops: clampInt(minHopsDraft, LIMITS.MIN_HOPS, LIMITS.MAX_HOPS, LIMITS.DEFAULT_MIN_HOPS),
      maxHops: clampInt(maxHopsDraft, LIMITS.MIN_HOPS, LIMITS.MAX_HOPS, LIMITS.DEFAULT_MAX_HOPS),
      limit: clampInt(limitDraft, LIMITS.MIN_LIMIT, LIMITS.MAX_LIMIT, LIMITS.DEFAULT_LIMIT),
    };
    void runPathPattern(value, options);
  }, [startDraft, endDraft, minHopsDraft, maxHopsDraft, limitDraft, runPathPattern, clearPathPattern]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    // Esc 关闭面板。`stopPropagation` 是必需的：`usePanelKeyboard` 的全局 Esc 会
    // `panel.closeAll()` 一口气关掉所有面板，用户按一次 Esc 期望只关这一个。
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
  }, [onClose]);

  const summary = useMemo(() => summarizePathPatternResult(pathPatternResult), [pathPatternResult]);
  const isLoading = pathPatternStatus === 'loading';
  const hasMore = pathPatternResult !== null && pathPatternResult.nextCursor !== null;
  const paths = pathPatternResult?.paths ?? [];
  const unknownTypes = pathPatternResult?.unknownEdgeTypes ?? [];

  /**
   * `aria-live` 的播报文本。
   *
   * 只播报**终态**（有结果 / 无结果 / 拼错 / 语法错 / 无图 / 失败 / 超时），
   * 不播报 `loading`：屏幕阅读器在用户每敲一次回车时读一遍"枚举中"是噪声。
   * `loading` 时返回空串（元素仍在，只是没有内容可播）。
   */
  const announcement = useMemo(() => {
    if (pathPatternStatus === 'ready') return t('pathPattern.announce', { n: paths.length });
    if (pathPatternStatus === 'empty') return t('pathPattern.empty');
    if (pathPatternStatus === 'unknown-types') return t('pathPattern.unknownTypes', { types: unknownTypes.join(', ') });
    if (pathPatternStatus === 'invalid') return t('pathPattern.invalidSyntax');
    if (pathPatternStatus === 'not-found') return t('pathPattern.notFound');
    if (pathPatternStatus === 'error') return t('pathPattern.error');
    if (pathPatternStatus === 'timeout') return t('pathPattern.timeout');
    return '';
  }, [pathPatternStatus, paths.length, unknownTypes, t]);

  return (
    <AnalysisPanelShell
      variant="pathpattern"
      label={label}
      onClose={onClose}
      badge={pathPatternStatus === 'ready' ? <span className="cg-pathpattern-count-badge">{summary.paths}</span> : undefined}
    >
      <div className="cg-pathpattern-body" onKeyDown={handleKeyDown}>
        <form
          className="cg-pathpattern-form"
          role="search"
          onSubmit={(event) => {
            // 表单提交承接 Enter：`<input>` 在 form 里回车会触发 submit。
            event.preventDefault();
            submit(draft);
          }}
        >
          <label className="cg-visually-hidden" htmlFor="cg-pathpattern-input">
            {t('pathPattern.inputLabel')}
          </label>
          <input
            ref={inputRef}
            id="cg-pathpattern-input"
            name="pathPattern"
            className="cg-pathpattern-input"
            type="search"
            role="searchbox"
            aria-label={t('pathPattern.inputLabel')}
            placeholder={t('pathPattern.placeholder')}
            maxLength={LIMITS.MAX_INPUT_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter 必须**在输入框上**显式处理，不能只依赖 `<form>` 的隐式提交：
              // jsdom 不实现"回车隐式提交"，只靠 onSubmit 会让键盘路径在单测里走不通。
              if (event.key === 'Enter') {
                event.preventDefault();
                submit(draft);
              }
            }}
            disabled={isLoading}
          />
          <button
            type="submit"
            className="cg-pathpattern-submit"
            disabled={isLoading || draft.trim().length === 0 || syntaxOk === false}
            aria-busy={isLoading}
            title={t('pathPattern.submit')}
          >
            {isLoading ? t('pathPattern.loading') : t('pathPattern.submit')}
          </button>
          <div className="cg-pathpattern-tuning" role="group" aria-label={t('pathPattern.tuningLabel')}>
            <label className="cg-pathpattern-tune-item">
              <span className="cg-pathpattern-tune-name">{t('pathPattern.startNode')}</span>
              <input
                id="cg-pathpattern-start"
                name="pathPatternStart"
                className="cg-pathpattern-tune-input"
                type="text"
                value={startDraft}
                aria-label={t('pathPattern.startNode')}
                onChange={(event) => setStartDraft(event.target.value)}
                disabled={isLoading}
              />
            </label>
            <label className="cg-pathpattern-tune-item">
              <span className="cg-pathpattern-tune-name">{t('pathPattern.endNode')}</span>
              <input
                id="cg-pathpattern-end"
                name="pathPatternEnd"
                className="cg-pathpattern-tune-input"
                type="text"
                value={endDraft}
                aria-label={t('pathPattern.endNode')}
                onChange={(event) => setEndDraft(event.target.value)}
                disabled={isLoading}
              />
            </label>
            <label className="cg-pathpattern-tune-item">
              <span className="cg-pathpattern-tune-name">{t('pathPattern.minHops')}</span>
              <input
                id="cg-pathpattern-min-hops"
                name="pathPatternMinHops"
                className="cg-pathpattern-tune-input"
                type="number"
                min={LIMITS.MIN_HOPS}
                max={LIMITS.MAX_HOPS}
                step={1}
                value={minHopsDraft}
                aria-label={t('pathPattern.minHops')}
                onChange={(event) => setMinHopsDraft(event.target.value)}
                disabled={isLoading}
              />
            </label>
            <label className="cg-pathpattern-tune-item">
              <span className="cg-pathpattern-tune-name">{t('pathPattern.maxHops')}</span>
              <input
                id="cg-pathpattern-max-hops"
                name="pathPatternMaxHops"
                className="cg-pathpattern-tune-input"
                type="number"
                min={LIMITS.MIN_HOPS}
                max={LIMITS.MAX_HOPS}
                step={1}
                value={maxHopsDraft}
                aria-label={t('pathPattern.maxHops')}
                onChange={(event) => setMaxHopsDraft(event.target.value)}
                disabled={isLoading}
              />
            </label>
            <label className="cg-pathpattern-tune-item">
              <span className="cg-pathpattern-tune-name">{t('pathPattern.limit')}</span>
              <input
                id="cg-pathpattern-limit"
                name="pathPatternLimit"
                className="cg-pathpattern-tune-input"
                type="number"
                min={LIMITS.MIN_LIMIT}
                max={LIMITS.MAX_LIMIT}
                step={1}
                value={limitDraft}
                aria-label={t('pathPattern.limit')}
                onChange={(event) => setLimitDraft(event.target.value)}
                disabled={isLoading}
              />
            </label>
          </div>
          <button
            type="button"
            className="cg-pathpattern-clear"
            disabled={draft.length === 0 && pathPatternStatus === 'idle'}
            onClick={() => {
              setDraft('');
              setStartDraft('');
              setEndDraft('');
              clearPathPattern();
              inputRef.current?.focus();
            }}
            title={t('pathPattern.clear')}
            aria-label={t('pathPattern.clear')}
          >
            {t('pathPattern.clear')}
          </button>
        </form>

        {/*
          cycle-136：逐键语法预检的诊断。
          `role="alert"` 而非 `aria-live`：它是「用户输入导致的错误」，需要立刻读出，
          而 `aria-live` 的播报时机在实现间不一致。空串时元素不渲染（见下面的判据）。
        */}
        {syntaxOk === false && syntaxDiagnostic.length > 0 && (
          <div className="cg-pathpattern-syntax-error" role="alert">
            <pre className="cg-pathpattern-diagnostic">{syntaxDiagnostic}</pre>
          </div>
        )}

        {/*
          cycle-136：Σ 提示条——**动态**取自宿主（`pathPatternEdgeTypes`），不硬编码。
          它让面板自文档化（用户不用猜边类型名是什么），同时把「Σ 是宿主侧事实」这条
          不变量变成**可见的界面**：宿主改了 Σ，这里立刻跟着变。
          取失败时不渲染（避免显示空条或假列表）。
        */}
        {pathPatternEdgeTypesStatus === 'ready' && pathPatternEdgeTypes.length > 0 && (
          <div className="cg-pathpattern-sigma" role="list" aria-label={t('pathPattern.sigmaLabel')}>
            <span className="cg-pathpattern-sigma-label">{t('pathPattern.sigmaLabel')}</span>
            {pathPatternEdgeTypes.map((type) => (
              <span key={type} className="cg-pathpattern-sigma-chip" role="listitem">{type}</span>
            ))}
          </div>
        )}

        {/* 播报区：终态变化时说一次，`loading` 静默。 */}
        <div className="cg-pathpattern-live" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>

        {pathPatternStatus === 'idle' && (
          <div className="cg-pathpattern-idle">
            <div className="cg-pathpattern-idle-title">{t('pathPattern.idle')}</div>
            <div className="cg-pathpattern-idle-hint">{t('pathPattern.idleHint')}</div>
          </div>
        )}

        {isLoading && (
          <div className="cg-pathpattern-loading" aria-hidden="true">
            {t('pathPattern.loading')}
          </div>
        )}

        {pathPatternStatus === 'empty' && (
          <div className="cg-pathpattern-empty">
            <div className="cg-pathpattern-empty-title">{t('pathPattern.empty')}</div>
            <div className="cg-pathpattern-empty-hint">{t('pathPattern.emptyHint')}</div>
          </div>
        )}

        {pathPatternStatus === 'unknown-types' && (
          <div className="cg-pathpattern-unknown">
            <div className="cg-pathpattern-unknown-title">
              {t('pathPattern.unknownTypes', { types: unknownTypes.join(', ') })}
            </div>
            <div className="cg-pathpattern-unknown-hint">
              {/*
                Σ 列表**动态**取自宿主（`pathPatternEdgeTypes`），不硬编码在 i18n 里——
                cycle-135 曾把 Σ 写进文案，违反「Σ 是宿主侧事实、复制会静默分叉」这条纪律。
                取失败时退化为「无法获取类型列表」的诚实降级，而不是假装 Σ 为空。
              */}
              {pathPatternEdgeTypes.length > 0
                ? t('pathPattern.unknownHint', { types: pathPatternEdgeTypes.join(' / ') })
                : t('pathPattern.unknownHintNoList')}
            </div>
          </div>
        )}

        {pathPatternStatus === 'invalid' && (
          <div className="cg-pathpattern-invalid">
            <div className="cg-pathpattern-invalid-title">{t('pathPattern.invalidSyntax')}</div>
            <pre className="cg-pathpattern-diagnostic">{pathPatternError ?? ''}</pre>
            <button
              type="button"
              className="cg-pathpattern-retry"
              onClick={() => { submit(draft); }}
            >
              {t('pathPattern.retry')}
            </button>
          </div>
        )}

        {pathPatternStatus === 'not-found' && (
          <div className="cg-pathpattern-notfound">
            <div className="cg-pathpattern-notfound-title">{t('pathPattern.notFound')}</div>
            <div className="cg-pathpattern-notfound-hint">{t('pathPattern.notFoundHint')}</div>
          </div>
        )}

        {pathPatternStatus === 'error' && (
          <div className="cg-pathpattern-error">
            <div className="cg-pathpattern-error-title">
              {pathPatternError ? t(pathPatternError) : t('pathPattern.error')}
            </div>
            <button
              type="button"
              className="cg-pathpattern-retry"
              onClick={() => { submit(draft); }}
            >
              {t('pathPattern.retry')}
            </button>
          </div>
        )}

        {pathPatternStatus === 'timeout' && (
          <div className="cg-pathpattern-timeout">
            <div className="cg-pathpattern-timeout-title">{t('pathPattern.timeout')}</div>
            <button
              type="button"
              className="cg-pathpattern-retry"
              onClick={() => { submit(draft); }}
            >
              {t('pathPattern.retry')}
            </button>
          </div>
        )}

        {(pathPatternStatus === 'ready' || summary.truncated) && pathPatternResult && (
          <>
            {/*
              截断提示：与关键词检索同一条 graphify 原则「截断必须显式到不可能被误读」。
              它**独立于**终态渲染，因为截断是结果的一个属性，不是一种状态。
            */}
            {summary.truncated && (
              <div className="cg-pathpattern-truncated" role="status">
                {t('pathPattern.truncated')}
              </div>
            )}

            <div className="cg-pathpattern-section">
              <div className="cg-pathpattern-section-header">
                <span className="cg-pathpattern-section-title">
                  {t('pathPattern.resultsTitle', { n: paths.length })}
                </span>
              </div>
              {paths.length === 0 ? (
                <div className="cg-pathpattern-no-paths">{t('pathPattern.noPaths')}</div>
              ) : (
                <ul className="cg-pathpattern-path-list">
                  {paths.map((path, index) => (
                    <li key={`${path.ids.join('->')}:${index}`}>
                      <span className="cg-pathpattern-path-labels">{path.labels.join(' → ')}</span>
                      <span className="cg-pathpattern-path-hops">
                        ({t('pathPattern.hops', { n: pathHopsOf(path) })})
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {hasMore && (
                <button
                  type="button"
                  className="cg-pathpattern-more"
                  disabled={isLoading}
                  onClick={() => { void runPathPatternNextPage(); }}
                >
                  {t('pathPattern.loadingMore')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </AnalysisPanelShell>
  );
});
