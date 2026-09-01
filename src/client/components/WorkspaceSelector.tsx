import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { WorkspaceInfo } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import { WorkspaceIcon, ChevronDownIcon, PlusIcon, CloseIcon, CheckIcon, FolderIcon } from './Icons.tsx';

export interface WorkspaceSelectorProps {
  currentWorkspace: string;
  workspaceList: WorkspaceInfo[];
  onSwitchWorkspace: (path: string) => void;
  onAddWorkspace: (path: string) => void;
  onRemoveWorkspace: (path: string) => void;
}

function formatRelativeTime(ts: number): string {
  if (ts === 0) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '< 1m';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function deriveName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function WorkspaceSelector({
  currentWorkspace,
  workspaceList,
  onSwitchWorkspace,
  onAddWorkspace,
  onRemoveWorkspace,
}: WorkspaceSelectorProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const handleSwitch = useCallback((path: string) => {
    onSwitchWorkspace(path);
    setOpen(false);
  }, [onSwitchWorkspace]);

  const handleAdd = useCallback(() => {
    const path = newPath.trim();
    if (!path) return;
    onAddWorkspace(path);
    setNewPath('');
    setAdding(false);
    setOpen(false);
  }, [newPath, onAddWorkspace]);

  const handleRemove = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    onRemoveWorkspace(path);
  }, [onRemoveWorkspace]);

  const displayName = currentWorkspace === '.' ? t('workspace.default') : deriveName(currentWorkspace);
  const hasExplicit = currentWorkspace !== '.' && !workspaceList.some((w) => w.path === currentWorkspace);

  return (
    <div className="workspace-selector" ref={dropdownRef}>
      <button
        className="workspace-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('workspace.switch')}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={currentWorkspace}
      >
        <WorkspaceIcon size={14} />
        <span className="workspace-name">{displayName}</span>
        <ChevronDownIcon size={12} className="workspace-chevron" />
      </button>

      {open && (
        <div className="workspace-dropdown" role="listbox" aria-label={t('workspace.switch')}>
          <div className="workspace-dropdown-header">
            <span>{t('workspace.current')}</span>
            <button
              className="workspace-add-btn"
              onClick={() => setAdding((v) => !v)}
              aria-label={t('workspace.add')}
              title={t('workspace.add')}
            >
              <PlusIcon size={14} />
            </button>
          </div>

          {adding && (
            <div className="workspace-add-form">
              <input
                ref={inputRef}
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                  if (e.key === 'Escape') { setAdding(false); setNewPath(''); }
                }}
                placeholder={t('workspace.namePlaceholder')}
                aria-label={t('workspace.namePlaceholder')}
              />
              <button onClick={handleAdd} disabled={!newPath.trim()} aria-label={t('workspace.add')}>
                <CheckIcon size={14} />
              </button>
            </div>
          )}

          <div className="workspace-list">
            {hasExplicit && (
              <div className="workspace-item current" role="option" aria-selected>
                <FolderIcon size={14} />
                <span className="workspace-item-name">{deriveName(currentWorkspace)}</span>
                <span className="workspace-item-path">{currentWorkspace}</span>
                <span className="workspace-item-badge">{t('workspace.active')}</span>
              </div>
            )}

            {workspaceList.map((ws) => (
              <div
                key={ws.path}
                className={`workspace-item ${ws.path === currentWorkspace ? 'current' : ''}`}
                role="option"
                aria-selected={ws.path === currentWorkspace}
                onClick={() => handleSwitch(ws.path)}
              >
                <FolderIcon size={14} />
                <span className="workspace-item-name">{ws.name}</span>
                <span className="workspace-item-path">{ws.path}</span>
                <span className="workspace-item-time">{formatRelativeTime(ws.lastUsed)}</span>
                {ws.path === currentWorkspace && (
                  <span className="workspace-item-badge">{t('workspace.active')}</span>
                )}
                <button
                  className="workspace-item-remove"
                  onClick={(e) => handleRemove(e, ws.path)}
                  aria-label={t('workspace.remove')}
                  title={t('workspace.remove')}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            ))}

            {!hasExplicit && workspaceList.length === 0 && (
              <div className="workspace-empty">
                <span>{t('workspace.empty')}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
