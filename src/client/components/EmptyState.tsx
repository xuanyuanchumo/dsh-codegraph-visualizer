import React, { useState, useCallback } from 'react';
import { useT } from '../i18n/index.ts';
import { GraphIcon, UploadIcon, AlertIcon, CheckIcon, CopyIcon } from './Icons.tsx';

interface EmptyStateProps {
  prerequisites: { codegraph: boolean; lens: boolean };
  onImport: () => void;
}

export function EmptyState({ prerequisites, onImport }: EmptyStateProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const prereqMissing = !prerequisites.codegraph && !prerequisites.lens;

  const handleCopyCmd = useCallback(() => {
    const cmd = t('prereq.installCodegraph');
    try {
      navigator.clipboard?.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // best-effort
    }
  }, [t]);

  return (
    <div className="empty-state">
      <GraphIcon size={48} className="empty-icon" />
      <span className="empty-title">{t('empty.title')}</span>
      <span className="empty-subtitle">{t('empty.subtitle')}</span>
      {prereqMissing && (
        <div className="empty-prereq-warning">
          <div className="prereq-header">
            <AlertIcon size={14} />
            <span className="prereq-title">{t('empty.prereqTitle')}</span>
          </div>
          <span className="prereq-desc">{t('empty.prereqDesc')}</span>
          <div className="prereq-cmd-row">
            <code className="prereq-cmd">{t('prereq.installCodegraph')}</code>
            <button
              className="prereq-copy-btn"
              onClick={handleCopyCmd}
              aria-label={t('empty.copyCmd')}
              title={t('empty.copyCmd')}
            >
              {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            </button>
          </div>
          {copied && <span className="prereq-copied">{t('empty.copied')}</span>}
        </div>
      )}
      <button className="empty-import-btn" onClick={onImport}>
        <UploadIcon size={15} /> {t('empty.import')}
      </button>
    </div>
  );
}
