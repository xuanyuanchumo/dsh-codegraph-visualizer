import { memo } from 'react';
import { useT } from '../i18n/index.ts';

interface OverlayBarProps {
  heatmapMode: string;
  setHeatmapMode: (mode: 'none' | 'instability' | 'lines' | 'complexity') => void;
  todoMarkerMode: string;
  setTodoMarkerMode: (mode: 'none' | 'todo' | 'fixme' | 'all') => void;
}

export const OverlayBar = memo(function OverlayBar({ heatmapMode, setHeatmapMode, todoMarkerMode, setTodoMarkerMode }: OverlayBarProps) {
  const t = useT();
  return (
    <div className="cg-overlay-bar" role="group" aria-label={t('overlay.title')}>
      <div className={`cg-overlay-section ${heatmapMode === 'none' ? 'cg-overlay-section--collapsed' : ''}`}>
        {heatmapMode === 'none' ? (
          <button
            className="cg-overlay-btn cg-overlay-btn--activate"
            onClick={() => setHeatmapMode('instability')}
            aria-label={t('heatmap.title')}
          >
            {t('heatmap.title')}
          </button>
        ) : (
          <>
            <span className="cg-overlay-label">{t('heatmap.title')}:</span>
            {(['none', 'instability', 'lines', 'complexity'] as const).map((m) => (
              <button
                key={m}
                className={`cg-overlay-btn ${heatmapMode === m ? 'cg-active' : ''}`}
                onClick={() => setHeatmapMode(m)}
                aria-pressed={heatmapMode === m}
                aria-label={t(`heatmap.${m}`)}
              >
                {t(`heatmap.${m}`)}
              </button>
            ))}
          </>
        )}
      </div>
      <span className="cg-overlay-divider" aria-hidden="true" />
      <div className={`cg-overlay-section ${todoMarkerMode === 'none' ? 'cg-overlay-section--collapsed' : ''}`}>
        {todoMarkerMode === 'none' ? (
          <button
            className="cg-overlay-btn cg-overlay-btn--activate"
            onClick={() => setTodoMarkerMode('all')}
            aria-label={t('todoMarker.title')}
          >
            {t('todoMarker.title')}
          </button>
        ) : (
          <>
            <span className="cg-overlay-label">{t('todoMarker.title')}:</span>
            {(['none', 'todo', 'fixme', 'all'] as const).map((m) => (
              <button
                key={m}
                className={`cg-overlay-btn ${todoMarkerMode === m ? 'cg-active' : ''}`}
                onClick={() => setTodoMarkerMode(m)}
                aria-pressed={todoMarkerMode === m}
                aria-label={t(`todoMarker.${m}`)}
              >
                {t(`todoMarker.${m}`)}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
});