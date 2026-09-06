import React, { useState, useCallback, useMemo } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import { CloseIcon, PathIcon } from './Icons.tsx';
import type { NodeId } from '../../types/index.ts';

interface PathBarProps {
  onFindPath: (sourceId: NodeId, targetId: NodeId) => void;
  onClearPath: () => void;
  pathResult: NodeId[] | null;
  pathLength: number | null;
  onClose: () => void;
}

export function PathBar({ onFindPath, onClearPath, pathResult, pathLength, onClose }: PathBarProps) {
  const t = useT();
  const rawNodes = useGraphStore((s) => s.rawNodes);
  const pathStartId = useGraphStore((s) => s.pathStartId);
  const pathEndId = useGraphStore((s) => s.pathEndId);
  const setPathStart = useGraphStore((s) => s.setPathStart);
  const setPathEnd = useGraphStore((s) => s.setPathEnd);
  const setPathResult = useGraphStore((s) => s.setPathResult);
  const [startQuery, setStartQuery] = useState('');
  const [endQuery, setEndQuery] = useState('');

  const startMatches = useMemo(
    () => (startQuery ? rawNodes.filter((n) => n.label.toLowerCase().includes(startQuery.toLowerCase())).slice(0, 10) : []),
    [startQuery, rawNodes],
  );
  const endMatches = useMemo(
    () => (endQuery ? rawNodes.filter((n) => n.label.toLowerCase().includes(endQuery.toLowerCase())).slice(0, 10) : []),
    [endQuery, rawNodes],
  );

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
    <div className="path-bar" role="region" aria-label={t('pathFind.title')}>
      <div className="path-bar-header">
        <PathIcon size={14} />
        <span>{t('pathFind.title')}</span>
        <button onClick={onClose} aria-label={t('pathFind.close')} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 'auto' }}>
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="path-bar-content">
        <div className="path-input-group">
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
            <div className="path-suggestions">
              {startMatches.map((n) => (
                <button key={n.id} onClick={() => { setStartQuery(n.label); setPathStart(n.id as NodeId); }}>
                  <span className="suggestion-type">{n.type}</span>
                  <span className="suggestion-label">{n.label}</span>
                </button>
              ))}
            </div>
          )}
          {pathStartId && <span className="path-selected">{rawNodes.find((n) => n.id === pathStartId)?.label ?? pathStartId}</span>}
        </div>
        <div className="path-input-group">
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
            <div className="path-suggestions">
              {endMatches.map((n) => (
                <button key={n.id} onClick={() => { setEndQuery(n.label); setPathEnd(n.id as NodeId); }}>
                  <span className="suggestion-type">{n.type}</span>
                  <span className="suggestion-label">{n.label}</span>
                </button>
              ))}
            </div>
          )}
          {pathEndId && <span className="path-selected">{rawNodes.find((n) => n.id === pathEndId)?.label ?? pathEndId}</span>}
        </div>
        <div className="path-actions">
          <button onClick={handleFind} disabled={!pathStartId || !pathEndId} className="path-find-btn">
            {t('pathFind.find')}
          </button>
          <button onClick={handleClear} className="path-clear-btn">
            {t('pathFind.clear')}
          </button>
        </div>
        {pathResult && (
          <div className="path-result">
            <span>{t('pathFind.length')}: {pathLength}</span>
            <span>{t('pathFind.hops')}: {pathResult.length}</span>
          </div>
        )}
      </div>
    </div>
  );
}
