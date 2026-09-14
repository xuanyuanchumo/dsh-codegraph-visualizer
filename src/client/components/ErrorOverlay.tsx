
import { AlertCircleIcon } from './Icons.tsx';
import { useT } from '../i18n/index.ts';

interface ErrorOverlayProps {
  error: string | null;
  onBack?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
}

export function ErrorOverlay({ error, onBack, onRetry }: ErrorOverlayProps) {
  const t = useT();
  if (!error) return null;
  return (
    <div className="error-overlay" role="alert">
      <div className="error-overlay-content">
        <AlertCircleIcon size={16} className="error-overlay-icon" />
        <span>{error}</span>
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
