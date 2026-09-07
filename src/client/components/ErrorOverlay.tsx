import React from 'react';
import { AlertCircleIcon } from './Icons.tsx';

interface ErrorOverlayProps {
  error: string | null;
}

export function ErrorOverlay({ error }: ErrorOverlayProps) {
  if (!error) return null;
  return (
    <div className="error-overlay" role="alert">
      <AlertCircleIcon size={16} className="error-overlay-icon" />
      <span>{error}</span>
    </div>
  );
}