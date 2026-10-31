import { useState, useCallback, memo } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { useNodeSearch } from '../hooks/useNodeSearch.ts';
import { useT } from '../i18n/index.ts';
import { CloseIcon, PathIcon } from './Icons.tsx';
import { NodeId } from '../../types/index.ts';
import { fetchPathEnumerate, type PathEnumerationResponse } from '../api/hostRequests.ts';

/** 路径查找模式：shortest = 客户端 BFS 最短路（既有）；enumerate = 璇玑图路径枚举（/paths）。 */
type PathMode = 'shortest' | 'enumerate';

interface PathBarProps {
  onFindPath: (sourceId: NodeId, targetId: NodeId) => void;
  onClearPath: () => void;
  /**
   * 枚举结果点击跳转（cycle-124 补遗）：选中节点 + revealNode 入视野。
   * 缺省（旧调用方/降级通道）⇒ 点击无跳转，仅文本展示（不渲染死交互）。
   */
  onJumpToNode?: (id: string) => void;
  pathResult: NodeId[] | null;
  pathLength: number | null;
  onClose: () => void;
}

export const PathBar = memo(function PathBar({ onFindPath, onClearPath, onJumpToNode, pathResult, pathLength, onClose }: PathBarProps) {
  const t = useT();
  const [mode, setMode] = useState<PathMode>('shortest');
  // 枚举模式的状态（本地态——查询参数与结果都是本次交互的，无持久化意义）
  const [maxHops, setMaxHops] = useState(5);
  const [enumerating, setEnumerating] = useState(false);
  const [enumResult, setEnumResult] = useState<PathEnumerationResponse | null>(null);
  const [enumError, setEnumError] = useState<string | null>(null);
  const pathStartId = useGraphStore((s) => s.pathStartId);
  const pathEndId = useGraphStore((s) => s.pathEndId);
  const setPathStart = useGraphStore((s) => s.setPathStart);
  const setPathEnd = useGraphStore((s) => s.setPathEnd);
  const setPathResult = useGraphStore((s) => s.setPathResult);
  const startLabel = useGraphStore((s) => pathStartId ? s.rawNodes.find((n) => n.id === pathStartId)?.label ?? pathStartId : null);
  const endLabel = useGraphStore((s) => pathEndId ? s.rawNodes.find((n) => n.id === pathEndId)?.label ?? pathEndId : null);
  const rawNodes = useGraphStore((s) => s.rawNodes);
  const { search: searchNodes } = useNodeSearch(rawNodes);
  const [startQuery, setStartQuery] = useState('');
  const [endQuery, setEndQuery] = useState('');

  const startMatches = searchNodes(startQuery, 10);
  const endMatches = searchNodes(endQuery, 10);

  const handleFind = useCallback(() => {
    if (pathStartId && pathEndId) {
      onFindPath(pathStartId, pathEndId);
    }
  }, [pathStartId, pathEndId, onFindPath]);

  const handleClear = useCallback(() => {
    setPathStart(null);
    setPathEnd(null);
    setPathResult(null);
    onClearPath();
    setStartQuery('');
    setEndQuery('');
    setEnumResult(null);
    setEnumError(null);
  }, [setPathStart, setPathEnd, setPathResult, onClearPath]);

  // 枚举模式查询：调 /paths（璇玑图路径规则读法的用户侧出口）。
  // 刻意区分三态：null = 查询没做成（404/网络）；reason 字段 = 端点不在图；
  // 空数组 = 图里真的没有路径——三者对用户的含义完全不同，不得互相冒充。
  const handleEnumerate = useCallback(async () => {
    if (!pathStartId || !pathEndId) return;
    setEnumerating(true);
    setEnumError(null);
    try {
      const workspace = useGraphStore.getState().currentWorkspace;
      const r = await fetchPathEnumerate(pathStartId, pathEndId, {
        maxHops,
        limit: 20,
        workspace,
      });
      if (r === null) {
        setEnumError(t('pathFind.enumUnavailable'));
        setEnumResult(null);
      } else {
        setEnumResult(r);
      }
    } catch {
      setEnumError(t('pathFind.enumUnavailable'));
      setEnumResult(null);
    } finally {
      setEnumerating(false);
    }
  }, [pathStartId, pathEndId, maxHops, t]);

  return (
    <div className="cg-path-bar" role="region" aria-label={t('pathFind.title')}>
      <div className="cg-path-bar-header">
        <PathIcon size={14} />
        <span>{t('pathFind.title')}</span>
        <button onClick={onClose} aria-label={t('pathFind.close')} className="cg-close-btn">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="cg-path-bar-content">
        <div className="cg-path-input-group">
          <label htmlFor="path-start-input">{t('pathFind.start')}</label>
          <input
            id="path-start-input"
            name="pathStart"
            type="text"
            value={startQuery}
            onChange={(e) => { setStartQuery(e.target.value); setPathStart(null); }}
            placeholder={t('pathFind.startPlaceholder')}
          />
          {startMatches.length > 0 && !pathStartId && (
            <div className="cg-path-suggestions" role="listbox" aria-label={t('pathFind.startSuggestions')}>
              {startMatches.map((n) => (
                <button key={n.id} role="option" aria-selected={false} onClick={() => { setStartQuery(n.label); setPathStart(NodeId(n.id)); }}>
                  <span className="cg-suggestion-type">{n.type}</span>
                  <span className="cg-suggestion-label">{n.label}</span>
                </button>
              ))}
            </div>
          )}
          {pathStartId && <span className="cg-path-selected">{startLabel}</span>}
        </div>
        <div className="cg-path-input-group">
          <label htmlFor="path-end-input">{t('pathFind.end')}</label>
          <input
            id="path-end-input"
            name="pathEnd"
            type="text"
            value={endQuery}
            onChange={(e) => { setEndQuery(e.target.value); setPathEnd(null); }}
            placeholder={t('pathFind.endPlaceholder')}
          />
          {endMatches.length > 0 && !pathEndId && (
            <div className="cg-path-suggestions" role="listbox" aria-label={t('pathFind.endSuggestions')}>
              {endMatches.map((n) => (
                <button key={n.id} role="option" aria-selected={false} onClick={() => { setEndQuery(n.label); setPathEnd(NodeId(n.id)); }}>
                  <span className="cg-suggestion-type">{n.type}</span>
                  <span className="cg-suggestion-label">{n.label}</span>
                </button>
              ))}
            </div>
          )}
          {pathEndId && <span className="cg-path-selected">{endLabel}</span>}
        </div>
        <div className="cg-path-actions">
          {/* 双模切换（cycle-124）：最短路 = 客户端 BFS；枚举 = 璇玑图路径规则读法（/paths）。
              radio 语义（role=radiogroup），两模式互斥——切换时清另一模式的结果。 */}
          <div className="cg-path-mode-switch" role="radiogroup" aria-label={t('pathFind.modeLabel')}>
            <button
              role="radio"
              aria-checked={mode === 'shortest'}
              className={`cg-path-mode-btn ${mode === 'shortest' ? 'cg-mode-active' : ''}`}
              onClick={() => { setMode('shortest'); setEnumResult(null); setEnumError(null); }}
            >
              {t('pathFind.modeShortest')}
            </button>
            <button
              role="radio"
              aria-checked={mode === 'enumerate'}
              className={`cg-path-mode-btn ${mode === 'enumerate' ? 'cg-mode-active' : ''}`}
              onClick={() => { setMode('enumerate'); setPathResult(null); }}
            >
              {t('pathFind.modeEnumerate')}
            </button>
          </div>
          {mode === 'shortest' ? (
            <button onClick={handleFind} disabled={!pathStartId || !pathEndId} className="cg-path-find-btn">
              {t('pathFind.find')}
            </button>
          ) : (
            <div className="cg-path-enum-controls">
              <label htmlFor="path-enum-hops">{t('pathFind.maxHops')}</label>
              <input
                id="path-enum-hops"
                name="pathEnumHops"
                type="number"
                min={1}
                max={10}
                value={maxHops}
                onChange={(e) => setMaxHops(Math.min(10, Math.max(1, Number(e.target.value) || 5)))}
              />
              <button onClick={handleEnumerate} disabled={!pathStartId || !pathEndId || enumerating} className="cg-path-find-btn">
                {enumerating ? t('pathFind.enumerating') : t('pathFind.enumerate')}
              </button>
            </div>
          )}
          <button onClick={handleClear} className="cg-path-clear-btn">
            {t('pathFind.clear')}
          </button>
        </div>
        {mode === 'shortest' && pathResult && (
          <div className="cg-path-result">
            <span>{t('pathFind.length')}: {pathLength}</span>
            <span>{t('pathFind.hops')}: {pathResult.length}</span>
          </div>
        )}
        {mode === 'enumerate' && enumError && (
          <div className="cg-path-enum-error" role="alert">{enumError}</div>
        )}
        {mode === 'enumerate' && enumResult && (
          <div className="cg-path-enum-result">
            {enumResult.reason === 'endpoint-not-in-graph' ? (
              <span className="cg-path-enum-hint">{t('pathFind.endpointMissing')}</span>
            ) : enumResult.paths.length === 0 ? (
              <span className="cg-path-enum-hint">{t('pathFind.noPaths')}</span>
            ) : (
              <>
                <div className="cg-path-enum-summary">
                  {t('pathFind.enumSummary', { n: enumResult.paths.length, total: enumResult.total })}
                  {enumResult.truncated && <span className="cg-path-enum-truncated"> · {t('pathFind.enumTruncated')}</span>}
                </div>
                <ol className="cg-path-enum-list">
                  {enumResult.paths.map((p, i) => {
                    // 点击跳转：路径上的每个节点都可定位（选中 + reveal 入视野）。
                    // onJumpToNode 缺省（旧调用方）⇒ 保持纯文本，不渲染死按钮。
                    const content = (
                      <>
                        <span className="cg-path-enum-index">{i + 1}.</span>
                        {p.labels.join(' → ')}
                      </>
                    );
                    return onJumpToNode ? (
                      <li key={i} className="cg-path-enum-item">
                        {p.ids.map((id, j) => (
                          <span key={id}>
                            {j > 0 && <span className="cg-path-enum-arrow"> → </span>}
                            <button
                              className="cg-path-enum-node"
                              title={t('pathFind.jumpHint')}
                              onClick={() => onJumpToNode(id)}
                            >
                              {p.labels[j]}
                            </button>
                          </span>
                        ))}
                      </li>
                    ) : (
                      <li key={i} className="cg-path-enum-item" title={p.ids.join(' → ')}>
                        {content}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
})
