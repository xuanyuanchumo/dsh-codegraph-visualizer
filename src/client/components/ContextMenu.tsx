import React, { useEffect, useRef, useState, memo, useCallback } from 'react';
import type { GraphNode } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import { useT } from '../i18n/index.ts';
import { useGraphStore } from '../store/graphStore.ts';
import { Portal } from './Portal.tsx';


export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
  separatorAfter?: boolean;
}

export interface ContextMenuProps {
  nodeId: string;
  nodeData: GraphNode | ClusterNode | null;
  position: { x: number; y: number };
  isCluster: boolean;
  isExpanded: boolean;
  hasHiddenNodes: boolean;
  onClose: () => void;
  onFocusNode: (nodeId: string) => void;
  onIsolateNode: (nodeId: string) => void;
  onHideNode: (nodeId: string) => void;
  onShowAllNodes: () => void;
  onExpandNode: (nodeId: string) => void;
  onCollapseNode: (nodeId: string) => void;
  onFindPath: (nodeId: string) => void;
  onHighlightCallChain: (nodeId: string) => void;
  onHighlightImpact: (nodeId: string) => void;
  onOpenSource: (nodeId: string) => void;
}

export const ContextMenu = memo(function ContextMenu(props: ContextMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const triggerRef = useRef<HTMLElement | null>(null);

  // FBX-03：固定节点开关与复制反馈直接订阅 store / 本地状态——菜单挂在
  // GraphPanel 的 React 树内，无需新增 props（GraphPanel 不再为每个动作转发 store）。
  const isPinned = useGraphStore((s) => s.pinnedIds.has(props.nodeId));
  const pinNode = useGraphStore((s) => s.pinNode);
  const unpinNode = useGraphStore((s) => s.unpinNode);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  // The close callback lives in a ref so the document listeners below keep a stable
  // identity: GraphPanel hands down an inline arrow, so keying the effect on it made the
  // keydown listener be removed and re-added on every render (J0 Round 12, BUG-R12-02).
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  const handleClose = useCallback(() => {
    setFocusedIndex(0);
    onCloseRef.current();
  }, []);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('.cg-context-menu-item:not([disabled])');
    items?.[0]?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The menu is the topmost overlay, so it claims Escape in the capture phase: a
        // bubble-phase listener here can be pre-empted when another document-level Escape
        // handler (the panel shortcuts) re-renders mid-dispatch, and a leaked Escape would
        // also close whatever sits behind the menu (J0 Round 12, BUG-R12-02).
        e.preventDefault();
        e.stopPropagation();
        handleClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('.cg-context-menu-item:not([disabled])');
          if (!items || items.length === 0) return prev;
          return (prev + 1) % items.length;
        });
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('.cg-context-menu-item:not([disabled])');
          if (!items || items.length === 0) return prev;
          return (prev - 1 + items.length) % items.length;
        });
      }
      if (e.key === 'Home') {
        e.preventDefault();
        setFocusedIndex(0);
      }
      if (e.key === 'End') {
        e.preventDefault();
        const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('.cg-context-menu-item:not([disabled])');
        if (items && items.length > 0) setFocusedIndex(items.length - 1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [handleClose]);

  useEffect(() => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('.cg-context-menu-item:not([disabled])');
    items?.[focusedIndex]?.focus();
  }, [focusedIndex]);

  useEffect(() => {
    if (menuRef.current) {
      const menu = menuRef.current;
      const rect = menu.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      if (rect.right > viewportW) {
        menu.style.left = `${Math.max(0, props.position.x - rect.width)}px`;
      }
      if (rect.bottom > viewportH) {
        menu.style.top = `${Math.max(0, props.position.y - rect.height)}px`;
      }
    }
  }, [props.position.x, props.position.y]);


  const actions: ContextMenuAction[] = [];

  actions.push({
    id: 'focus',
    label: t('contextMenu.focus'),
    onClick: () => { props.onFocusNode(props.nodeId); handleClose(); },
  });

  actions.push({
    id: 'isolate',
    label: t('contextMenu.isolate'),
    onClick: () => { props.onIsolateNode(props.nodeId); handleClose(); },
  });

  actions.push({
    id: 'hide',
    label: t('contextMenu.hide'),
    onClick: () => { props.onHideNode(props.nodeId); handleClose(); },
    separatorAfter: true,
  });

  if (props.hasHiddenNodes) {
    actions.push({
      id: 'showAll',
      label: t('contextMenu.showAll'),
      onClick: () => { props.onShowAllNodes(); handleClose(); },
      separatorAfter: true,
    });
  }

  if (props.isCluster) {
    if (props.isExpanded) {
      actions.push({
        id: 'collapse',
        label: t('contextMenu.collapse'),
        onClick: () => { props.onCollapseNode(props.nodeId); handleClose(); },
        separatorAfter: true,
      });
    } else {
      actions.push({
        id: 'expand',
        label: t('contextMenu.expand'),
        onClick: () => { props.onExpandNode(props.nodeId); handleClose(); },
        separatorAfter: true,
      });
    }
  }

  actions.push({
    id: 'callChain',
    label: t('contextMenu.callChain'),
    onClick: () => { props.onHighlightCallChain(props.nodeId); handleClose(); },
  });

  actions.push({
    id: 'impact',
    label: t('contextMenu.impact'),
    onClick: () => { props.onHighlightImpact(props.nodeId); handleClose(); },
  });

  actions.push({
    id: 'findPath',
    label: t('contextMenu.findPath'),
    onClick: () => { props.onFindPath(props.nodeId); handleClose(); },
    separatorAfter: true,
  });

  actions.push({
    id: 'openSource',
    label: t('contextMenu.openSource'),
    onClick: () => { props.onOpenSource(props.nodeId); handleClose(); },
  });

  // FBX-03：固定节点。pinnedIds 参与 expandSlice 的展开预算豁免
  // （batchExpandNodes / collapseExcessClusters 都读它），pin 后大图批量展开
  // 不再按插入序驱逐该节点——这是「我关心的子图」的显式声明。
  actions.push({
    id: 'pinNode',
    label: t(isPinned ? 'contextMenu.unpinNode' : 'contextMenu.pinNode'),
    onClick: () => {
      if (isPinned) unpinNode(props.nodeId);
      else pinNode(props.nodeId);
      handleClose();
    },
  });

  // FBX-03：复制符号 ID。best-effort（剪贴板不可用时静默，与 EmptyState 同款），
  // 成功后行内反馈 1.5s——不弹 toast，不打断键盘焦点顺序。
  actions.push({
    id: 'copyId',
    label: copyState === 'copied' ? t('contextMenu.copied') : t('contextMenu.copyId'),
    onClick: () => {
      try {
        void navigator.clipboard?.writeText(props.nodeId);
        setCopyState('copied');
        window.setTimeout(() => setCopyState('idle'), 1500);
      } catch { /* clipboard unavailable — best-effort */ }
    },
  });

  // FBX-03：从这展开 / 收起到这里。上面的 expand/collapse 只对聚类节点出现；
  // 这里对普通节点也放行（module 展开文件大纲、函数体展开最常用）。两个 store
  // 动作对已处于目标态的节点是幂等的——重复展开只触发一次 recluster，不会坏图。
  actions.push({
    id: 'expandHere',
    label: t('contextMenu.expandHere'),
    onClick: () => { props.onExpandNode(props.nodeId); handleClose(); },
    separatorAfter: true,
  });

  actions.push({
    id: 'collapseHere',
    label: t('contextMenu.collapseHere'),
    onClick: () => { props.onCollapseNode(props.nodeId); handleClose(); },
  });

  // Layering is owned by the stylesheet (`.cg-context-menu { z-index: var(--cg-z-context-menu) }`),
  // so only the anchored position lives inline.
  // 位置由 GraphPanel 换算为视口坐标，因此这里用 `position: fixed` 直接贴视口。
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: `${props.position.x}px`,
    top: `${props.position.y}px`,
  };

  // 面板带 `contain: layout paint style` 且 `overflow: hidden`，会裁剪并包含 fixed 后代，
  // 因此菜单必须 portal 到 body，否则在面板边缘会被裁掉、层级也压不过宿主外壳。
  return (
    <Portal>
      <div className="cg-context-menu" ref={menuRef} style={menuStyle} role="menu">
        {actions.map((action) => (
          <React.Fragment key={action.id}>
            <button
              className="cg-context-menu-item"
              role="menuitem"
              data-action-id={action.id}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.icon && <span className="cg-context-menu-icon" aria-hidden="true">{action.icon}</span>}
              {action.label}
            </button>
            {action.separatorAfter && <div className="cg-context-menu-separator" role="separator" />}
          </React.Fragment>
        ))}
      </div>
    </Portal>
  );
})