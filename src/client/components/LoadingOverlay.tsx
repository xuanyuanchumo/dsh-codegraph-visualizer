import { memo } from 'react';
import { useT } from '../i18n/index.ts';

interface LoadingOverlayProps {
  visible: boolean;
}

export const LoadingOverlay = memo(function LoadingOverlay({ visible }: LoadingOverlayProps) {
  const t = useT();
  if (!visible) return null;
  return (
    <div className="cg-loading-overlay" role="status" aria-live="polite">
      <div className="cg-spinner" /><span>{t('state.loading')}</span>
    </div>
  );
});