import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { useT } from '../i18n/index.ts';
import { DOM_EVENTS } from '../../shared/domEvents.ts';
import { UI } from '../../shared/constants.ts';
import { GraphIcon, UploadIcon, AlertIcon, CheckIcon, CopyIcon, ZapIcon } from './Icons.tsx';

interface EmptyStateProps {
  prerequisites: { codegraph: boolean; lens: boolean; builtin?: boolean };
  onImport: () => void;
  onScanWorkspace: () => void;
  /** True while the host is still building the index for the active workspace. */
  indexing?: boolean;
}

export const EmptyState = memo(function EmptyState({ prerequisites, onImport, onScanWorkspace, indexing = false }: EmptyStateProps) {
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
    window.dispatchEvent(new CustomEvent(DOM_EVENTS.INSTALL_PLUGIN, {
      detail: { plugin },
    }));
    setInstalling(true);
    if (installTimerRef.current) clearTimeout(installTimerRef.current);
    installTimerRef.current = setTimeout(() => setInstalling(false), UI.INSTALL_HINT_TIMEOUT_MS);
  }, [t]);

  const codegraphMissing = !prerequisites.codegraph;
  const lensMissing = !prerequisites.lens;
  const anyMissing = codegraphMissing || lensMissing;
  const allMissing = codegraphMissing && lensMissing;
  const hasBuiltin = prerequisites.builtin ?? true;

  return (
    <div className="cg-empty-state">
      <GraphIcon size={48} className="cg-empty-icon" />
      <span className="cg-empty-title">{indexing ? t('empty.indexingTitle') : t('empty.title')}</span>
      <span className="cg-empty-subtitle">{indexing ? t('empty.indexingSubtitle') : t('empty.subtitle')}</span>
      {!indexing && allMissing && hasBuiltin && (
        <div className="cg-empty-degraded-notice">
          <span className="cg-degraded-label">{t('empty.degradedMode')}</span>
          <span className="cg-degraded-hint">{t('empty.degradedHint')}</span>
        </div>
      )}
      {!indexing && anyMissing && (
        <div className="cg-empty-prereq-warning">
          <div className="cg-prereq-header">
            <AlertIcon size={14} />
            <span className="cg-prereq-title">{t('empty.prereqTitle')}</span>
          </div>

          {codegraphMissing && (
            <div className="cg-prereq-item">
              <div className="cg-prereq-item-header">
                <span className={`cg-prereq-status-dot ${prerequisites.codegraph ? 'cg-ok' : 'cg-missing'}`} />
                <span className="cg-prereq-item-label">{t('prereq.codegraphLabel')}</span>
                <span className="cg-prereq-item-status">{t('prereq.notFound')}</span>
              </div>
              <span className="cg-prereq-item-desc">{t('prereq.codegraphDesc')}</span>
              <div className="cg-prereq-cmd-row">
                <code className="cg-prereq-cmd">{t('prereq.installCodegraph')}</code>
                <button
                  className="cg-prereq-copy-btn"
                  onClick={() => handleCopyCmd(t('prereq.installCodegraph'))}
                  aria-label={t('empty.copyCmd')}
                  title={t('empty.copyCmd')}
                >
                  {copiedCmd === t('prereq.installCodegraph') ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                </button>
              </div>
              <button
                className="cg-prereq-install-btn"
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
              <div className="cg-prereq-cmd-row">
                <code className="cg-prereq-cmd">{t('prereq.installLens')}</code>
                <button
                  className="cg-prereq-copy-btn"
                  onClick={() => handleCopyCmd(t('prereq.installLens'))}
                  aria-label={t('empty.copyCmd')}
                  title={t('empty.copyCmd')}
                >
                  {copiedCmd === t('prereq.installLens') ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                </button>
              </div>
              <button
                className="cg-prereq-install-btn"
                onClick={() => handleInstall('dsh-tool-lens')}
                disabled={installing}
                aria-label={installing ? t('prereq.detecting') : t('prereq.installTitle')}
              >
                <ZapIcon size={14} /> {installing ? (copiedCmd === t('prereq.installLens') ? t('empty.copied') : t('prereq.detecting')) : t('prereq.installTitle')}
              </button>
            </div>
          )}

          {copiedCmd && <span className="cg-prereq-copied">{t('empty.copied')}</span>}
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
