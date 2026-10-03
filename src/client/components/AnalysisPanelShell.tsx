import { memo } from 'react';
import type { ReactNode } from 'react';
import { CloseIcon } from './Icons.tsx';
import { useT } from '../i18n/index.ts';

interface AnalysisPanelShellProps {
  variant: string;
  label: string;
  onClose: () => void;
  badge?: ReactNode;
  children: ReactNode;
}

export const AnalysisPanelShell = memo(function AnalysisPanelShell({
  variant,
  label,
  onClose,
  badge,
  children,
}: AnalysisPanelShellProps) {
  const t = useT();
  return (
    <div className={`cg-analysis-panel cg-${variant}-panel`} role="region" aria-label={label} aria-live="polite">
      <div className="cg-analysis-panel-header">
        <span>{label}</span>
        {badge}
        <button onClick={onClose} className="cg-close-btn" aria-label={t('common.close')}>
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="cg-analysis-panel-content">
        {children}
      </div>
    </div>
  );
});