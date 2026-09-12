import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceInfo } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import { deriveWorkspaceName as deriveName } from '../utils/deriveName.ts';
import { WorkspaceIcon, ChevronDownIcon, PlusIcon, CloseIcon, CheckIcon, FolderIcon } from './Icons.tsx';

export interface WorkspaceSelectorProps {
  currentWorkspace: string;
  workspaceList: WorkspaceInfo[];
  onSwitchWorkspace: (path: string) => void;
  onAddWorkspace: (path: string) => void;
  onRemoveWorkspace: (path: string) => void;
}

function formatRelativeTime(ts: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (ts === 0) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('workspace.timeJustNow');
  if (diff < 3_600_000) return t('workspace.timeMinutesAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('workspace.timeHoursAgo', { n: Math.floor(diff / 3_600_000) });
  return t('workspace.timeDaysAgo', { n: Math.floor(diff / 86_400_000) });
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
  const [, setTick] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(interval);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownWidth = 280;
    const dropdownMaxHeight = 400;
    let top = rect.bottom + 4;
    let left = rect.left;
    if (left + dropdownWidth > window.innerWidth) {
      left = Math.max(8, window.innerWidth - dropdownWidth - 8);
    }
    if (top + dropdownMaxHeight > window.innerHeight) {
      top = Math.max(8, rect.top - dropdownMaxHeight - 4);
    }
    setDropdownPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
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
    <div className="workspace-selector">
      <button
        ref={triggerRef}
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

      {open && createPortal(
        <div
          className="workspace-dropdown workspace-dropdown-portal"
          role="listbox"
          aria-label={t('workspace.switch')}
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left }}
          ref={dropdownRef}
        >
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
                id="workspace-add-path"
                name="workspace-add-path"
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
                <span className="workspace-item-time">{formatRelativeTime(ws.lastUsed, t)}</span>
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
        </div>,
        document.body
      )}
    </div>
  );
}
