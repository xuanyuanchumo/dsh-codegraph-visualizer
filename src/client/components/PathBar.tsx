import { useState, useCallback, memo } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { useNodeSearch } from '../hooks/useNodeSearch.ts';
import { useT } from '../i18n/index.ts';
import { CloseIcon, PathIcon } from './Icons.tsx';
import { NodeId } from '../../types/index.ts';

interface PathBarProps {
  onFindPath: (sourceId: NodeId, targetId: NodeId) => void;
  onClearPath: () => void;
  pathResult: NodeId[] | null;
  pathLength: number | null;
  onClose: () => void;
}

export const PathBar = memo(function PathBar({ onFindPath, onClearPath, pathResult, pathLength, onClose }: PathBarProps) {
  const t = useT();
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
  }, [setPathStart, setPathEnd, setPathResult, onClearPath]);

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
            <div className="cg-path-suggestions">
              {startMatches.map((n) => (
                <button key={n.id} onClick={() => { setStartQuery(n.label); setPathStart(NodeId(n.id)); }}>
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
            <div className="cg-path-suggestions">
              {endMatches.map((n) => (
                <button key={n.id} onClick={() => { setEndQuery(n.label); setPathEnd(NodeId(n.id)); }}>
                  <span className="cg-suggestion-type">{n.type}</span>
                  <span className="cg-suggestion-label">{n.label}</span>
                </button>
              ))}
            </div>
          )}
          {pathEndId && <span className="cg-path-selected">{endLabel}</span>}
        </div>
        <div className="cg-path-actions">
          <button onClick={handleFind} disabled={!pathStartId || !pathEndId} className="cg-path-find-btn">
            {t('pathFind.find')}
          </button>
          <button onClick={handleClear} className="cg-path-clear-btn">
            {t('pathFind.clear')}
          </button>
        </div>
        {pathResult && (
          <div className="cg-path-result">
            <span>{t('pathFind.length')}: {pathLength}</span>
            <span>{t('pathFind.hops')}: {pathResult.length}</span>
          </div>
        )}
      </div>
    </div>
  );
})
