import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { useT } from '../i18n/index.ts';
import { UI } from '../../shared/constants.ts';
import { GraphIcon, UploadIcon, AlertIcon, CheckIcon, CopyIcon, ZapIcon } from './Icons.tsx';

interface EmptyStateProps {
  prerequisites: { codegraph: boolean; lens: boolean };
  onImport: () => void;
  onScanWorkspace: () => void;
}

export const EmptyState = memo(function EmptyState({ prerequisites, onImport, onScanWorkspace }: EmptyStateProps) {
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
      copyTimerRef.current = setTimeout(() => setCopiedCmd(null), UI.COPY_HINT_TIMEOUT_MS);
    } catch { /* clipboard unavailable — best-effort */ }
  }, []);

  const handleInstall = useCallback((plugin: string) => {
    const cmd = plugin === 'dsh-codegraph' ? t('prereq.installCodegraph') : t('prereq.installLens');
    try {
      navigator.clipboard?.writeText(cmd);
      setCopiedCmd(cmd);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedCmd(null), UI.INSTALL_HINT_TIMEOUT_MS);
    } catch { /* clipboard unavailable — best-effort */ }
    window.dispatchEvent(new CustomEvent('codegraph:install-plugin', {
      detail: { plugin },
    }));
    setInstalling(true);
    if (installTimerRef.current) clearTimeout(installTimerRef.current);
    installTimerRef.current = setTimeout(() => setInstalling(false), UI.INSTALL_HINT_TIMEOUT_MS);
  }, [t]);

  const codegraphMissing = !prerequisites.codegraph;
  const lensMissing = !prerequisites.lens;
  const anyMissing = codegraphMissing || lensMissing;

  return (
    <div className="cg-empty-state">
      <GraphIcon size={48} className="cg-empty-icon" />
      <span className="cg-empty-title">{t('empty.title')}</span>
      <span className="cg-empty-subtitle">{t('empty.subtitle')}</span>
      {anyMissing && (
        <div className="cg-empty-prereq-warning">
          <div className="prereq-header">
            <AlertIcon size={14} />
            <span className="prereq-title">{t('empty.prereqTitle')}</span>
          </div>

          {codegraphMissing && (
            <div className="cg-prereq-item">
              <div className="cg-prereq-item-header">
                <span className={`cg-prereq-status-dot ${prerequisites.codegraph ? 'cg-ok' : 'cg-missing'}`} />
                <span className="cg-prereq-item-label">{t('prereq.codegraphLabel')}</span>
                <span className="cg-prereq-item-status">{t('prereq.notFound')}</span>
              </div>
              <span className="cg-prereq-item-desc">{t('prereq.codegraphDesc')}</span>
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
                onClick={() => handleInstall('dsh-codegraph')}
                disabled={installing}
                aria-label={installing ? t('prereq.detecting') : t('prereq.installTitle')}
              >
                <ZapIcon size={14} /> {installing ? (copiedCmd === t('prereq.installCodegraph') ? t('empty.copied') : t('prereq.detecting')) : t('prereq.installTitle')}
              </button>
            </div>
          )}

          {lensMissing && (
            <div className="cg-prereq-item">
              <div className="cg-prereq-item-header">
                <span className={`cg-prereq-status-dot ${prerequisites.lens ? 'cg-ok' : 'cg-missing'}`} />
                <span className="cg-prereq-item-label">{t('prereq.lensLabel')}</span>
                <span className="cg-prereq-item-status">{t('prereq.notFound')}</span>
              </div>
              <span className="cg-prereq-item-desc">{t('prereq.lensDesc')}</span>
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
              <button
                className="prereq-install-btn"
                onClick={() => handleInstall('dsh-tool-lens')}
                disabled={installing}
                aria-label={installing ? t('prereq.detecting') : t('prereq.installTitle')}
              >
                <ZapIcon size={14} /> {installing ? (copiedCmd === t('prereq.installLens') ? t('empty.copied') : t('prereq.detecting')) : t('prereq.installTitle')}
              </button>
            </div>
          )}

          {copiedCmd && <span className="prereq-copied">{t('empty.copied')}</span>}
        </div>
      )}
      <div className="cg-empty-actions">
        <button className="cg-empty-import-btn" onClick={onImport}>
          <UploadIcon size={15} /> {t('empty.import')}
        </button>
        <button className="cg-empty-scan-btn" onClick={onScanWorkspace}>
          <GraphIcon size={15} /> {t('empty.scanWorkspace')}
        </button>
      </div>
    </div>
  );
});
