import React, { useEffect, useRef, useState, memo, useCallback } from 'react';
import type { GraphNode } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import { useT } from '../i18n/index.ts';
import { UI } from '../../shared/constants.ts';

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

  const handleClose = useCallback(() => {
    setFocusedIndex(0);
    props.onClose();
  }, [props.onClose]);

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
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
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

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: `${props.position.x}px`,
    top: `${props.position.y}px`,
    zIndex: UI.CONTEXT_MENU_Z_INDEX,
  };

  return (
    <div className="cg-context-menu" ref={menuRef} style={menuStyle} role="menu">
      {actions.map((action) => (
        <React.Fragment key={action.id}>
          <button
            className="cg-context-menu-item"
            role="menuitem"
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
  );
})