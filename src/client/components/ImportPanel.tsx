import React, { useState, useCallback, useRef } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { scoped } from '../services/Logger.ts';
import { useT } from '../i18n/index.ts';
import { UploadIcon, FolderIcon, FileIcon, CloseIcon, AlertIcon } from './Icons.tsx';
import type { GraphNode, GraphEdge, NodeId, EdgeId, RepoId } from '../../types/index.ts';

const log = scoped('import');

type ImportTab = 'folder' | 'paste' | 'repo';

interface ImportPanelProps {
  onClose: () => void;
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

// Merge multiple graph fragments into one.
function mergeGraphs(fragments: { nodes: GraphNode[]; edges: GraphEdge[] }[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = new Map<string, GraphNode>();
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const f of fragments) {
    for (const n of f.nodes) { if (!nodeMap.has(n.id)) nodeMap.set(n.id, n); }
    for (const e of f.edges) { if (!edgeSet.has(e.id)) { edgeSet.add(e.id); edges.push(e); } }
  }
  return { nodes: Array.from(nodeMap.values()), edges };
}

export function ImportPanel({ onClose }: ImportPanelProps) {
  const t = useT();
  const [tab, setTab] = useState<ImportTab>('folder');
  const [pasteText, setPasteText] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const setGraphData = useGraphStore(s => s.setGraphData);
  const setLoading = useGraphStore(s => s.setLoading);
  const setError = useGraphStore(s => s.setError);

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
  }, [setGraphData, setError, onClose, t]);

  // Folder selection: scan for .codegraph/ directory or all .json files.
  const handleFolder = useCallback(async (files: FileList) => {
    setBusy(true);
    setFeedback(null);
    try {
      const allFiles = Array.from(files);
      // Prefer files under .codegraph/ directory; fall back to all .json files.
      let jsonFiles = allFiles.filter(f => f.webkitRelativePath?.includes('.codegraph/') && f.name.endsWith('.json'));
      if (jsonFiles.length === 0) {
        jsonFiles = allFiles.filter(f => f.name.endsWith('.json'));
      }
      if (jsonFiles.length === 0) {
        setFeedback({ kind: 'err', msg: t('import.noJson') });
        setBusy(false);
        return;
      }
      log.info(`scanning folder: ${jsonFiles.length} json files`);
      const fragments: { nodes: GraphNode[]; edges: GraphEdge[] }[] = [];
      for (const f of jsonFiles) {
        if (f.size > 10 * 1024 * 1024) continue;
        try {
          const text = await f.text();
          const parsed = parseGraphJson(text);
          fragments.push({ nodes: parsed.nodes, edges: parsed.edges });
        } catch {
          // skip invalid files
        }
      }
      if (fragments.length === 0) {
        setFeedback({ kind: 'err', msg: t('import.noJson') });
        setBusy(false);
        return;
      }
      const merged = mergeGraphs(fragments);
      const repoId = `folder-${Date.now()}` as RepoId;
      setGraphData(merged.nodes, merged.edges, repoId);
      log.info('folder imported', { files: fragments.length, nodes: merged.nodes.length, edges: merged.edges.length });
      setFeedback({ kind: 'ok', msg: t('import.imported', { nodes: merged.nodes.length, edges: merged.edges.length }) });
      setTimeout(onClose, 700);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeedback({ kind: 'err', msg });
    } finally {
      setBusy(false);
    }
  }, [setGraphData, t, onClose]);

  const handleFolderInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFolder(e.target.files);
    }
    e.target.value = '';
  }, [handleFolder]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const items = e.dataTransfer.items;
    const firstItem = items?.[0];
    if (firstItem && typeof firstItem.webkitGetAsEntry === 'function') {
      // Directory drop support
      const entry = firstItem.webkitGetAsEntry();
      if (entry && entry.isDirectory) {
        setBusy(true);
        setFeedback(null);
        try {
          const jsonFiles: File[] = [];
          await new Promise<void>((resolve) => {
            const reader = (entry as FileSystemDirectoryEntry).createReader();
            const readEntries = () => {
              reader.readEntries(async (entries) => {
                if (entries.length === 0) { resolve(); return; }
                for (const ent of entries) {
                  if (ent.isFile) {
                    (ent as FileSystemFileEntry).file((f: File) => {
                      if (f.name.endsWith('.json')) jsonFiles.push(f);
                    });
                  }
                }
                readEntries();
              });
            };
            readEntries();
          });
          if (jsonFiles.length === 0) {
            setFeedback({ kind: 'err', msg: t('import.noJson') });
            setBusy(false);
            return;
          }
          const fragments: { nodes: GraphNode[]; edges: GraphEdge[] }[] = [];
          for (const f of jsonFiles) {
            try {
              const text = await f.text();
              fragments.push(parseGraphJson(text));
            } catch { /* skip */ }
          }
          if (fragments.length === 0) {
            setFeedback({ kind: 'err', msg: t('import.noJson') });
            setBusy(false);
            return;
          }
          const merged = mergeGraphs(fragments);
          setGraphData(merged.nodes, merged.edges, `folder-${Date.now()}` as RepoId);
          setFeedback({ kind: 'ok', msg: t('import.imported', { nodes: merged.nodes.length, edges: merged.edges.length }) });
          setTimeout(onClose, 700);
        } catch (e2) {
          setFeedback({ kind: 'err', msg: e2 instanceof Error ? e2.message : String(e2) });
        } finally {
          setBusy(false);
        }
        return;
      }
    }
    // Fallback: file drop
    const f = e.dataTransfer.files?.[0];
    if (f) applyGraph(await f.text(), `file:${f.name}`);
  }, [applyGraph, handleFolder, setGraphData, t, onClose]);

  const handlePasteSubmit = useCallback(() => {
    if (!pasteText.trim()) { setFeedback({ kind: 'err', msg: t('import.pasteFirst') }); return; }
    applyGraph(pasteText, 'paste');
  }, [pasteText, applyGraph, t]);

  const handleRepoSubmit = useCallback(() => {
    const path = repoPath.trim();
    if (!path) { setFeedback({ kind: 'err', msg: t('import.enterPath') }); return; }
    setBusy(true);
    setFeedback(null);
    setLoading(true);
    window.dispatchEvent(new CustomEvent('codegraph:import-repo', { detail: { path } }));
    log.info('requested repo import', { path });
    setFeedback({ kind: 'ok', msg: t('import.requestedScan', { path }) });
    setTimeout(() => { setBusy(false); onClose(); }, 900);
  }, [repoPath, setLoading, onClose, t]);

  return (
    <div className="import-panel" role="dialog" aria-label={t('import.title')}>
      <div className="import-header">
        <span className="import-title">{t('import.title')}</span>
        <button className="import-close" onClick={onClose} aria-label={t('import.close')}><CloseIcon size={16} /></button>
      </div>

      <div className="import-tabs" role="tablist">
        <button className={tab === 'folder' ? 'active' : ''} onClick={() => setTab('folder')} role="tab" aria-selected={tab === 'folder'}>
          <FolderIcon size={14} /> {t('import.folder')}
        </button>
        <button className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')} role="tab" aria-selected={tab === 'paste'}>
          <UploadIcon size={14} /> {t('import.paste')}
        </button>
        <button className={tab === 'repo' ? 'active' : ''} onClick={() => setTab('repo')} role="tab" aria-selected={tab === 'repo'}>
          <FileIcon size={14} /> {t('import.repo')}
        </button>
      </div>

      <div className="import-body">
        {tab === 'folder' && (
          <div
            className="drop-zone"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => folderInputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <FolderIcon size={32} />
            <span className="drop-text">{busy ? t('import.scanning') : t('import.dropText')}</span>
            <span className="drop-hint">{t('import.dropHint')}</span>
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error -- webkitdirectory is non-standard but widely supported
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFolderInput}
              style={{ display: 'none' }}
            />
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

        {tab === 'repo' && (
          <div className="repo-zone">
            <input
              className="repo-input"
              type="text"
              placeholder={t('import.repoPlaceholder')}
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              aria-label="Repository path"
            />
            <span className="repo-hint">{t('import.repoHint')}</span>
            <button className="import-submit" onClick={handleRepoSubmit} disabled={busy}>
              {busy ? t('import.scanningRepo') : t('import.scanRepo')}
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
