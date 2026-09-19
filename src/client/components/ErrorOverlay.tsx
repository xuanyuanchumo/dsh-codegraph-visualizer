
import { AlertCircleIcon } from './Icons.tsx';
import { useT } from '../i18n/index.ts';

interface ErrorOverlayProps {
  error: string | null;
  onBack?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
}

function friendlyError(raw: string, t: (k: string) => string): string {
  if (raw.startsWith('Failed to load dependencies')) return t('error.loadDependencies');
  if (raw.startsWith('Failed to load code graph data')) return t('error.loadGraphData');
  if (raw.startsWith('Failed to load code graph')) return t('error.loadGraph');
  return t('error.generic');
}

export function ErrorOverlay({ error, onBack, onRetry }: ErrorOverlayProps) {
  const t = useT();
  if (!error) return null;
  const message = friendlyError(error, t);
  return (
    <div className="error-overlay" role="alert">
      <div className="error-overlay-content">
        <AlertCircleIcon size={16} className="error-overlay-icon" />
        <span>{message}</span>
      </div>
      {(onBack || onRetry) && (
        <div className="error-overlay-actions">
          {onRetry && (
            <button className="error-overlay-btn error-overlay-retry" onClick={onRetry}>
              {t('error.retry')}
            </button>
          )}
          {onBack && (
            <button className="error-overlay-btn error-overlay-back" onClick={onBack}>
              {t('micro.backToCode')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
