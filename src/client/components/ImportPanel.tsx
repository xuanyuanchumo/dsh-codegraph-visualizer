import React, { useState, useCallback, useRef, useEffect } from 'react';
import { scoped } from '../../shared/Logger.ts';
import { useT } from '../i18n/index.ts';
import { UploadIcon, FolderIcon, CloseIcon, AlertIcon, RefreshIcon, ZapIcon, WatchIcon } from './Icons.tsx';
import { coerceNode, coerceEdge } from '../validators.ts';
import type { GraphNode, GraphEdge, RepoId } from '../../types/index.ts';

const log = scoped('import');

const MAX_PASTE_BYTES = 10 * 1024 * 1024;

type ImportTab = 'workspace' | 'paste';

export interface ImportPanelProps {
  onClose: () => void;
  workspacePath: string;
  prerequisites: { codegraph: boolean; lens: boolean };
  initStatus: 'idle' | 'initializing' | 'done' | 'error';
  watchEnabled: boolean;
  onSetGraphData: (nodes: GraphNode[], edges: GraphEdge[], repoId: string) => void;
  onSetLoading: (loading: boolean) => void;
  onSetError: (error: string | null) => void;
  onSetInitStatus: (status: 'idle' | 'initializing' | 'done' | 'error') => void;
  onSetWatchEnabled: (enabled: boolean) => void;
}

function parseGraphJson(text: string): { nodes: GraphNode[]; edges: GraphEdge[]; repoId: string } {
  const parsed = JSON.parse(text) as { nodes?: unknown[]; edges?: unknown[]; metadata?: { repoId?: string } };
  if (!parsed || typeof parsed !== 'object') throw new Error('Root is not an object');
  const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
  const nodes = rawNodes.map(coerceNode).filter((n): n is GraphNode => n !== null);
  const edges = rawEdges.map(coerceEdge).filter((e): e is GraphEdge => e !== null);
  if (nodes.length === 0) throw new Error('No valid nodes found in JSON');
  const repoId = parsed.metadata?.repoId ?? `imported-${Date.now()}`;
  return { nodes, edges, repoId: repoId as RepoId };
}

export function ImportPanel({
  onClose,
  workspacePath,
  prerequisites,
  initStatus,
  watchEnabled,
  onSetGraphData,
  onSetLoading,
  onSetError,
  onSetInitStatus,
  onSetWatchEnabled,
}: ImportPanelProps) {
  const t = useT();
  const [tab, setTab] = useState<ImportTab>('workspace');
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [customPath, setCustomPath] = useState('');

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  const [copied, setCopied] = useState(false);
  const copyInstallCmd = useCallback(async () => {
    try {
      await navigator.clipboard.writeText('dsh plugin --profile web add dsh-codegraph');
      setCopied(true);
      timersRef.current.push(setTimeout(() => setCopied(false), 1600));
    } catch { /* clipboard unavailable — ignore */ }
  }, []);

  const effectivePath = customPath.trim() || workspacePath || '.';
  const prereqMissing = !prerequisites.codegraph && !prerequisites.lens;

  const applyGraph = useCallback((text: string, source: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      if (text.length > MAX_PASTE_BYTES) throw new Error(`JSON exceeds ${MAX_PASTE_BYTES / 1024 / 1024}MB limit`);
      const { nodes, edges, repoId } = parseGraphJson(text);
      onSetGraphData(nodes, edges, repoId);
      log.info(`imported from ${source}`, { nodes: nodes.length, edges: edges.length });
      setFeedback({ kind: 'ok', msg: t('import.imported', { nodes: nodes.length, edges: edges.length }) });
      timersRef.current.push(setTimeout(onClose, 700));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`import failed from ${source}`, msg);
      onSetError(t('import.importFailed', { msg }));
      setFeedback({ kind: 'err', msg });
    } finally {
      setBusy(false);
    }
  }, [onSetGraphData, onSetError, t, onClose]);

  const handlePasteSubmit = useCallback(() => {
    if (!pasteText.trim()) { setFeedback({ kind: 'err', msg: t('import.pasteFirst') }); return; }
    applyGraph(pasteText, 'paste');
  }, [pasteText, applyGraph, t]);

  const handleWorkspaceScan = useCallback(() => {
    setBusy(true);
    setFeedback(null);
    onSetLoading(true);
    window.dispatchEvent(new CustomEvent('codegraph:import-repo', { detail: { path: effectivePath } }));
    log.info('workspace scan requested', { path: effectivePath });
    setFeedback({ kind: 'ok', msg: t('import.requestedScan', { path: effectivePath }) });
    timersRef.current.push(setTimeout(() => { setBusy(false); onClose(); }, 900));
  }, [effectivePath, onSetLoading, onClose, t]);

  const handleInit = useCallback(() => {
    onSetInitStatus('initializing');
    setFeedback(null);
    window.dispatchEvent(new CustomEvent('codegraph:init-graph', { detail: { path: effectivePath } }));
    log.info('init requested', { path: effectivePath });
    setFeedback({ kind: 'ok', msg: t('import.initStarted', { path: effectivePath }) });
  }, [effectivePath, onSetInitStatus, t]);

  const handleToggleWatch = useCallback(() => {
    const next = !watchEnabled;
    onSetWatchEnabled(next);
    window.dispatchEvent(new CustomEvent('codegraph:toggle-watch', { detail: { enabled: next, path: effectivePath } }));
    log.info('watch toggled', { enabled: next, path: effectivePath });
  }, [watchEnabled, onSetWatchEnabled, effectivePath]);

  return (
    <div className="import-panel" role="dialog" aria-label={t('import.title')}>
      <div className="import-header">
        <span className="import-title">{t('import.title')}</span>
        <button className="import-close" onClick={onClose} aria-label={t('import.close')}><CloseIcon size={16} /></button>
      </div>

      {prereqMissing && (
        <div className="prereq-warning" role="alert">
          <AlertIcon size={14} />
          <span>{t('import.prereqMissing')}</span>
          <div className="prereq-install">
            <code>{t('import.prereqCmd', { cmd: 'dsh plugin --profile web add dsh-codegraph' })}</code>
            <button className="prereq-copy" onClick={() => { void copyInstallCmd(); }} disabled={copied}
              aria-label={t('import.prereqCopy')}>
              {copied ? t('import.copied') : t('import.prereqCopy')}
            </button>
          </div>
        </div>
      )}

      <div className="import-tabs" role="tablist">
        <button className={tab === 'workspace' ? 'active' : ''} onClick={() => setTab('workspace')} role="tab" aria-selected={tab === 'workspace'}>
          <FolderIcon size={14} /> {t('import.workspace')}
        </button>
        <button className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')} role="tab" aria-selected={tab === 'paste'}>
          <UploadIcon size={14} /> {t('import.paste')}
        </button>
      </div>

      <div className="import-body">
        {tab === 'workspace' && (
          <div className="workspace-zone">
            <div className="workspace-path-row">
              <FolderIcon size={16} className="workspace-path-icon" />
              <span className="workspace-path-label">{t('import.workspacePath')}</span>
            </div>
            <input
              className="workspace-path-input"
              id="import-workspace-path"
              name="import-workspace-path"
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder={workspacePath || '.'}
              aria-label={t('import.workspacePath')}
            />
            <span className="workspace-hint">{t('import.workspaceHint')}</span>

            <div className="workspace-actions">
              <button className="import-submit" onClick={handleWorkspaceScan} disabled={busy}>
                <RefreshIcon size={14} /> {busy ? t('import.scanning') : t('import.scanWorkspace')}
              </button>
              <button className="import-submit secondary" onClick={handleInit} disabled={initStatus === 'initializing'}>
                <ZapIcon size={14} /> {initStatus === 'initializing' ? t('import.initializing') : t('import.initGraph')}
              </button>
            </div>

            <button className={`watch-toggle ${watchEnabled ? 'active' : ''}`} onClick={handleToggleWatch}>
              <WatchIcon size={14} /> {watchEnabled ? t('import.watchOn') : t('import.watchOff')}
            </button>

            {initStatus === 'done' && (
              <div className="init-feedback ok">{t('import.initSuccess')}</div>
            )}
            {initStatus === 'error' && (
              <div className="init-feedback err">{t('import.initFailed')}</div>
            )}
          </div>
        )}

        {tab === 'paste' && (
          <div className="paste-zone">
            <textarea
              className="paste-input"
              id="import-paste-json"
              name="import-paste-json"
              placeholder={t('import.pastePlaceholder')}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              aria-label={t('import.pastePlaceholder')}
            />
            <button className="import-submit" onClick={handlePasteSubmit} disabled={busy}>
              {busy ? t('import.importing') : t('import.importJson')}
            </button>
          </div>
        )}
      </div>

      {feedback && (
        <div className={`import-feedback ${feedback.kind}`} role="status">
          {feedback.kind === 'err' && <AlertIcon size={14} />}
          <span>{feedback.msg}</span>
        </div>
      )}
    </div>
  );
}
