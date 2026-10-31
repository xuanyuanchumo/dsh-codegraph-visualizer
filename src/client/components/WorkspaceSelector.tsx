import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceInfo } from '../store/graphStore.ts';
import { useT } from '../i18n/index.ts';
import { deriveWorkspaceName as deriveName } from '../utils/deriveName.ts';
import { WorkspaceIcon, ChevronDownIcon, PlusIcon, CloseIcon, CheckIcon, FolderIcon } from './Icons.tsx';
import { POLLING } from '../../shared/constants.ts';

export interface WorkspaceSelectorProps {
  currentWorkspace: string;
  workspaceList: WorkspaceInfo[];
  /** 会话跟随态真相源（null = 宿主未注入会话 scope / 不可知）。 */
  sessionWorkspace?: string | null;
  /** 用户 pin 覆盖（非 null = 已固定，轮询/会话跟随不覆盖画布）。 */
  pinnedWorkspace?: string | null;
  onSwitchWorkspace: (path: string) => void;
  onAddWorkspace: (path: string) => void;
  onRemoveWorkspace: (path: string) => void;
  /** 解除 pin：回到会话跟随态（仅 pinnedWorkspace 非 null 时渲染入口）。 */
  onUnpinWorkspace?: () => void;
}

function formatRelativeTime(ts: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (ts === 0) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('workspace.timeJustNow');
  if (diff < 3_600_000) return t('workspace.timeMinutesAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('workspace.timeHoursAgo', { n: Math.floor(diff / 3_600_000) });
  return t('workspace.timeDaysAgo', { n: Math.floor(diff / 86_400_000) });
}


export const WorkspaceSelector = memo(function WorkspaceSelector({
  currentWorkspace,
  workspaceList,
  sessionWorkspace = null,
  pinnedWorkspace = null,
  onSwitchWorkspace,
  onAddWorkspace,
  onRemoveWorkspace,
  onUnpinWorkspace,
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
    const interval = setInterval(() => setTick((v) => v + 1), POLLING.WORKSPACE_TICK_MS);
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
    <div className="cg-workspace-selector">
      <button
        ref={triggerRef}
        className="cg-workspace-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('workspace.switch')}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={currentWorkspace}
      >
        <WorkspaceIcon size={14} />
        <span className="cg-workspace-name">{displayName}</span>
        <ChevronDownIcon size={12} className="cg-workspace-chevron" />
      </button>

      {open && createPortal(
        <div
          className="cg-workspace-dropdown cg-workspace-dropdown-portal"
          role="listbox"
          aria-label={t('workspace.switch')}
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left }}
          ref={dropdownRef}
        >
          <div className="cg-workspace-dropdown-header">
            <span>{t('workspace.current')}</span>
            {/* 会话跟随可观测性（白盒透明化）：跟随中/已固定状态一眼可见；
                解除 pin 一次到位（立即对齐会话工作区，不等 15s 轮询）。 */}
            {pinnedWorkspace !== null ? (
              onUnpinWorkspace ? (
                <button
                  className="cg-workspace-follow-badge cg-following-pinned"
                  onClick={onUnpinWorkspace}
                  title={t('workspace.followPinnedHint')}
                >
                  {t('workspace.followPinned')}
                </button>
              ) : (
                // pin 在场但无解除回调（旧调用方）→ 退化为非按钮徽标：
                // 状态仍可观测，但不渲染点了没反应的死按钮。
                <span className="cg-workspace-follow-badge cg-following-pinned" title={t('workspace.followPinnedHint')}>
                  {t('workspace.followPinned')}
                </span>
              )
            ) : sessionWorkspace !== null ? (
              <span className="cg-workspace-follow-badge cg-following-active" title={sessionWorkspace}>
                {t('workspace.following')}
              </span>
            ) : null}
            <button
              className="cg-workspace-add-btn"
              onClick={() => setAdding((v) => !v)}
              aria-label={t('workspace.add')}
              title={t('workspace.add')}
            >
              <PlusIcon size={14} />
            </button>
          </div>

          {adding && (
            <div className="cg-workspace-add-form">
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

          <div className="cg-workspace-list">
            {hasExplicit && (
              <div className="cg-workspace-item cg-current" role="option" aria-selected>
                <FolderIcon size={14} />
                <span className="cg-workspace-item-name">{deriveName(currentWorkspace)}</span>
                <span className="cg-workspace-item-path">{currentWorkspace}</span>
                <span className="cg-workspace-item-badge">{t('workspace.active')}</span>
              </div>
            )}

            {workspaceList.map((ws) => (
              <div
                key={ws.path}
                className={`cg-workspace-item ${ws.path === currentWorkspace ? 'cg-current' : ''}`}
                role="option"
                aria-selected={ws.path === currentWorkspace}
                onClick={() => handleSwitch(ws.path)}
              >
                <FolderIcon size={14} />
                <span className="cg-workspace-item-name">{ws.name}</span>
                <span className="cg-workspace-item-path">{ws.path}</span>
                <span className="cg-workspace-item-time">{formatRelativeTime(ws.lastUsed, t)}</span>
                {ws.path === currentWorkspace && (
                  <span className="cg-workspace-item-badge">{t('workspace.active')}</span>
                )}
                <button
                  className="cg-workspace-item-remove"
                  onClick={(e) => handleRemove(e, ws.path)}
                  aria-label={t('workspace.remove')}
                  title={t('workspace.remove')}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            ))}

            {!hasExplicit && workspaceList.length === 0 && (
              <div className="cg-workspace-empty">
                <span>{t('workspace.empty')}</span>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
})
