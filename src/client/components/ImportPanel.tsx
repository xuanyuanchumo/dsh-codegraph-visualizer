import React, { useState, useCallback } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { scoped } from '../services/Logger.ts';
import { useT } from '../i18n/index.ts';
import { UploadIcon, FolderIcon, CloseIcon, AlertIcon, RefreshIcon, ZapIcon, WatchIcon } from './Icons.tsx';
import type { GraphNode, GraphEdge, NodeId, EdgeId, RepoId } from '../../types/index.ts';

const log = scoped('import');

type ImportTab = 'workspace' | 'paste';

interface ImportPanelProps {
  onClose: () => void;
  workspacePath: string;
}

interface ImportableGraph {
  nodes?: unknown[];
  edges?: unknown[];
  metadata?: { repoId?: string };
}

function coerceNode(raw: unknown, i: number): GraphNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : `node-${i}`;
  const label = typeof o.label === 'string' ? o.label : typeof o.name === 'string' ? o.name : id;
  const type = (['function', 'class', 'variable', 'module', 'interface', 'type'].includes(o.type as string)
    ? o.type : 'variable') as GraphNode['type'];
  const filePath = typeof o.filePath === 'string' ? o.filePath : typeof o.file === 'string' ? o.file : '';
  const lineNumber = typeof o.lineNumber === 'number' ? o.lineNumber : typeof o.line === 'number' ? o.line : 0;
  const properties = (o.properties && typeof o.properties === 'object' ? o.properties : {}) as Record<string, unknown>;
  return { id: id as NodeId, label, type, filePath, lineNumber, properties };
}

function coerceEdge(raw: unknown, i: number): GraphEdge | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : `edge-${i}`;
  const source = typeof o.source === 'string' ? o.source : typeof o.from === 'string' ? o.from : null;
  const target = typeof o.target === 'string' ? o.target : typeof o.to === 'string' ? o.to : null;
  if (!source || !target) return null;
  const type = (['call', 'import', 'extend', 'implement', 'dependency'].includes(o.type as string)
    ? o.type : 'dependency') as GraphEdge['type'];
  const properties = (o.properties && typeof o.properties === 'object' ? o.properties : {}) as Record<string, unknown>;
  return { id: id as EdgeId, source: source as NodeId, target: target as NodeId, type, properties };
}

function parseGraphJson(text: string): { nodes: GraphNode[]; edges: GraphEdge[]; repoId: string } {
  const parsed = JSON.parse(text) as ImportableGraph;
  if (!parsed || typeof parsed !== 'object') throw new Error('Root is not an object');
  const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
  const nodes = rawNodes.map(coerceNode).filter((n): n is GraphNode => n !== null);
  const edges = rawEdges.map(coerceEdge).filter((e): e is GraphEdge => e !== null);
  if (nodes.length === 0) throw new Error('No valid nodes found in JSON');
  const repoId = parsed.metadata?.repoId ?? `imported-${Date.now()}`;
  return { nodes, edges, repoId: repoId as RepoId };
}

export function ImportPanel({ onClose, workspacePath }: ImportPanelProps) {
  const t = useT();
  const [tab, setTab] = useState<ImportTab>('workspace');
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [customPath, setCustomPath] = useState('');
  const setGraphData = useGraphStore(s => s.setGraphData);
  const setLoading = useGraphStore(s => s.setLoading);
  const setError = useGraphStore(s => s.setError);
  const { prerequisites, initStatus, watchEnabled, setInitStatus, setWatchEnabled } = useGraphStore();

  const effectivePath = customPath.trim() || workspacePath || '.';
  const prereqMissing = !prerequisites.codegraph && !prerequisites.lens;

  const applyGraph = useCallback((text: string, source: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const { nodes, edges, repoId } = parseGraphJson(text);
      setGraphData(nodes, edges, repoId);
      log.info(`imported from ${source}`, { nodes: nodes.length, edges: edges.length });
      setFeedback({ kind: 'ok', msg: t('import.imported', { nodes: nodes.length, edges: edges.length }) });
      setTimeout(onClose, 700);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`import failed from ${source}`, msg);
      setError(t('import.importFailed', { msg }));
      setFeedback({ kind: 'err', msg });
    } finally {
      setBusy(false);
    }
  }, [setGraphData, setError, t, onClose]);

  const handlePasteSubmit = useCallback(() => {
    if (!pasteText.trim()) { setFeedback({ kind: 'err', msg: t('import.pasteFirst') }); return; }
    applyGraph(pasteText, 'paste');
  }, [pasteText, applyGraph, t]);

  const handleWorkspaceScan = useCallback(() => {
    setBusy(true);
    setFeedback(null);
    setLoading(true);
    window.dispatchEvent(new CustomEvent('codegraph:import-repo', { detail: { path: effectivePath } }));
    log.info('workspace scan requested', { path: effectivePath });
    setFeedback({ kind: 'ok', msg: t('import.requestedScan', { path: effectivePath }) });
    setTimeout(() => { setBusy(false); onClose(); }, 900);
  }, [effectivePath, setLoading, onClose, t]);

  const handleInit = useCallback(() => {
    setInitStatus('initializing');
    setFeedback(null);
    window.dispatchEvent(new CustomEvent('codegraph:init-graph', { detail: { path: effectivePath } }));
    log.info('init requested', { path: effectivePath });
    setFeedback({ kind: 'ok', msg: t('import.initStarted', { path: effectivePath }) });
  }, [effectivePath, setInitStatus, t]);

  const handleToggleWatch = useCallback(() => {
    const next = !watchEnabled;
    setWatchEnabled(next);
    window.dispatchEvent(new CustomEvent('codegraph:toggle-watch', { detail: { enabled: next, path: effectivePath } }));
    log.info('watch toggled', { enabled: next, path: effectivePath });
  }, [watchEnabled, setWatchEnabled, effectivePath]);

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
              placeholder={t('import.pastePlaceholder')}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              aria-label="JSON paste input"
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
