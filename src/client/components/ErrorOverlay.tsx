import React from 'react';

interface ErrorOverlayProps {
  error: string | null;
}

export function ErrorOverlay({ error }: ErrorOverlayProps) {
  if (!error) return null;
  return (
    <div className="error-overlay" role="alert">
      <span>⚠ {error}</span>
    </div>
  );
}