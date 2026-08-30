import React, { useState, useCallback, useRef } from 'react';
import { useGraphStore } from '../store/graphStore.ts';
import { scoped } from '../services/Logger.ts';
import { UploadIcon, FolderIcon, FileIcon, CloseIcon, AlertIcon } from './Icons.tsx';
import type { GraphNode, GraphEdge, NodeId, EdgeId, RepoId } from '../../types/index.ts';

const log = scoped('import');

type ImportTab = 'file' | 'paste' | 'repo';

interface ImportPanelProps {
  onClose: () => void;
}

// Minimal JSON shape we accept: { nodes: [...], edges: [...], metadata?: {...} }
// Tolerant: extra fields ignored, missing metadata synthesized.
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
  const source = typeof o.source === 'string' ? o.source : null;
  const target = typeof o.target === 'string' ? o.target : null;
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

export function ImportPanel({ onClose }: ImportPanelProps) {
  const [tab, setTab] = useState<ImportTab>('file');
  const [pasteText, setPasteText] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      setFeedback({ kind: 'ok', msg: `Imported ${nodes.length} nodes · ${edges.length} edges` });
      setTimeout(onClose, 700);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`import failed from ${source}`, msg);
      setError(`Import failed: ${msg}`);
      setFeedback({ kind: 'err', msg });
    } finally {
      setBusy(false);
    }
  }, [setGraphData, setError, onClose]);

  const handleFile = useCallback((file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setFeedback({ kind: 'err', msg: 'File too large (max 10 MB)' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => applyGraph(String(reader.result), `file:${file.name}`);
    reader.onerror = () => setFeedback({ kind: 'err', msg: 'File read error' });
    reader.readAsText(file);
  }, [applyGraph]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  }, [handleFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handlePasteSubmit = useCallback(() => {
    if (!pasteText.trim()) { setFeedback({ kind: 'err', msg: 'Paste JSON first' }); return; }
    applyGraph(pasteText, 'paste');
  }, [pasteText, applyGraph]);

  const handleRepoSubmit = useCallback(() => {
    const path = repoPath.trim();
    if (!path) { setFeedback({ kind: 'err', msg: 'Enter a repository path' }); return; }
    setBusy(true);
    setFeedback(null);
    setLoading(true);
    // Emit an event for the host to scan the repo and produce a graph.
    // The host adapter listens and responds via codegraph/graph/updated.
    window.dispatchEvent(new CustomEvent('codegraph:import-repo', { detail: { path } }));
    log.info('requested repo import', { path });
    setFeedback({ kind: 'ok', msg: `Requested scan of ${path}` });
    setTimeout(() => { setBusy(false); onClose(); }, 900);
  }, [repoPath, setLoading, onClose]);

  return (
    <div className="import-panel" role="dialog" aria-label="Import code graph">
      <div className="import-header">
        <span className="import-title">Import Graph</span>
        <button className="import-close" onClick={onClose} aria-label="Close import"><CloseIcon size={16} /></button>
      </div>

      <div className="import-tabs" role="tablist">
        <button className={tab === 'file' ? 'active' : ''} onClick={() => setTab('file')} role="tab" aria-selected={tab === 'file'}>
          <FileIcon size={14} /> File
        </button>
        <button className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')} role="tab" aria-selected={tab === 'paste'}>
          <UploadIcon size={14} /> Paste
        </button>
        <button className={tab === 'repo' ? 'active' : ''} onClick={() => setTab('repo')} role="tab" aria-selected={tab === 'repo'}>
          <FolderIcon size={14} /> Repo
        </button>
      </div>

      <div className="import-body">
        {tab === 'file' && (
          <div
            className="drop-zone"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <UploadIcon size={32} />
            <span className="drop-text">Drop JSON here or click to browse</span>
            <span className="drop-hint">Max 10 MB · {`{ nodes, edges }`} shape</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileInput}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {tab === 'paste' && (
          <div className="paste-zone">
            <textarea
              className="paste-input"
              placeholder='Paste graph JSON here, e.g. {"nodes":[...],"edges":[...]}'
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              aria-label="JSON paste input"
            />
            <button className="import-submit" onClick={handlePasteSubmit} disabled={busy}>
              {busy ? 'Importing…' : 'Import JSON'}
            </button>
          </div>
        )}

        {tab === 'repo' && (
          <div className="repo-zone">
            <input
              className="repo-input"
              type="text"
              placeholder="/path/to/repository or ."
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              aria-label="Repository path"
            />
            <span className="repo-hint">Host will scan the path and build a code graph.</span>
            <button className="import-submit" onClick={handleRepoSubmit} disabled={busy}>
              {busy ? 'Scanning…' : 'Scan Repository'}
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