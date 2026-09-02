import React from 'react';
import { useT } from '../i18n/index.ts';

interface LoadingOverlayProps {
  visible: boolean;
}

export function LoadingOverlay({ visible }: LoadingOverlayProps) {
  const t = useT();
  if (!visible) return null;
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="spinner" /><span>{t('state.loading')}</span>
    </div>
  );
}