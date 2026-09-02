import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useT } from '../i18n/index.ts';
import { GraphIcon, UploadIcon, AlertIcon, CheckIcon, CopyIcon, ZapIcon } from './Icons.tsx';

interface EmptyStateProps {
  prerequisites: { codegraph: boolean; lens: boolean };
  onImport: () => void;
}

export function EmptyState({ prerequisites, onImport }: EmptyStateProps) {
  const t = useT();
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const installTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (installTimerRef.current) clearTimeout(installTimerRef.current);
    };
  }, []);

  const handleCopyCmd = useCallback((cmd: string) => {
    try {
      navigator.clipboard?.writeText(cmd);
      setCopiedCmd(cmd);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedCmd(null), 2000);
    } catch {
      // best-effort
    }
  }, []);

  const handleInstall = useCallback(() => {
    setInstalling(true);
    window.dispatchEvent(new CustomEvent('codegraph:install-plugin', {
      detail: { plugin: 'dsh-codegraph' },
    }));
    if (installTimerRef.current) clearTimeout(installTimerRef.current);
    installTimerRef.current = setTimeout(() => setInstalling(false), 3000);
  }, []);

  const codegraphMissing = !prerequisites.codegraph;
  const lensMissing = !prerequisites.lens;
  const anyMissing = codegraphMissing || lensMissing;

  return (
    <div className="empty-state">
      <GraphIcon size={48} className="empty-icon" />
      <span className="empty-title">{t('empty.title')}</span>
      <span className="empty-subtitle">{t('empty.subtitle')}</span>
      {anyMissing && (
        <div className="empty-prereq-warning">
          <div className="prereq-header">
            <AlertIcon size={14} />
            <span className="prereq-title">{t('empty.prereqTitle')}</span>
          </div>

          {codegraphMissing && (
            <div className="prereq-item">
              <div className="prereq-item-header">
                <span className={`prereq-status-dot ${prerequisites.codegraph ? 'ok' : 'missing'}`} />
                <span className="prereq-item-label">{t('prereq.codegraphLabel')}</span>
                <span className="prereq-item-status">{t('prereq.notFound')}</span>
              </div>
              <span className="prereq-item-desc">{t('prereq.codegraphDesc')}</span>
              <div className="prereq-cmd-row">
                <code className="prereq-cmd">{t('prereq.installCodegraph')}</code>
                <button
                  className="prereq-copy-btn"
                  onClick={() => handleCopyCmd(t('prereq.installCodegraph'))}
                  aria-label={t('empty.copyCmd')}
                  title={t('empty.copyCmd')}
                >
                  {copiedCmd === t('prereq.installCodegraph') ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                </button>
              </div>
              <button
                className="prereq-install-btn"
                onClick={handleInstall}
                disabled={installing}
              >
                <ZapIcon size={14} /> {installing ? t('prereq.detecting') : t('prereq.installTitle')}
              </button>
            </div>
          )}

          {lensMissing && (
            <div className="prereq-item">
              <div className="prereq-item-header">
                <span className={`prereq-status-dot ${prerequisites.lens ? 'ok' : 'missing'}`} />
                <span className="prereq-item-label">{t('prereq.lensLabel')}</span>
                <span className="prereq-item-status">{t('prereq.notFound')}</span>
              </div>
              <span className="prereq-item-desc">{t('prereq.lensDesc')}</span>
              <div className="prereq-cmd-row">
                <code className="prereq-cmd">{t('prereq.installLens')}</code>
                <button
                  className="prereq-copy-btn"
                  onClick={() => handleCopyCmd(t('prereq.installLens'))}
                  aria-label={t('empty.copyCmd')}
                  title={t('empty.copyCmd')}
                >
                  {copiedCmd === t('prereq.installLens') ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                </button>
              </div>
            </div>
          )}

          {copiedCmd && <span className="prereq-copied">{t('empty.copied')}</span>}
        </div>
      )}
      <button className="empty-import-btn" onClick={onImport}>
        <UploadIcon size={15} /> {t('empty.import')}
      </button>
    </div>
  );
}
