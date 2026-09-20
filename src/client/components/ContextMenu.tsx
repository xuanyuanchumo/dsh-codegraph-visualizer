import { useEffect, useRef } from 'react';
import type { GraphNode } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import { useT } from '../i18n/index.ts';

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface ContextMenuProps {
  nodeId: string;
  nodeData: GraphNode | ClusterNode | null;
  position: { x: number; y: number };
  isCluster: boolean;
  isExpanded: boolean;
  onClose: () => void;
  onFocusNode: (nodeId: string) => void;
  onIsolateNode: (nodeId: string) => void;
  onHideNode: (nodeId: string) => void;
  onExpandNode: (nodeId: string) => void;
  onCollapseNode: (nodeId: string) => void;
  onFindPath: (nodeId: string) => void;
  onHighlightCallChain: (nodeId: string) => void;
  onHighlightImpact: (nodeId: string) => void;
}

export function ContextMenu(props: ContextMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        props.onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [props.onClose]);

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

  useEffect(() => {
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('.cg-context-menu-item:not([disabled])');
    firstItem?.focus();
  }, []);

  const actions: ContextMenuAction[] = [];

  actions.push({
    id: 'focus',
    label: t('contextMenu.focus') ?? 'Focus Node',
    onClick: () => { props.onFocusNode(props.nodeId); props.onClose(); },
  });

  actions.push({
    id: 'isolate',
    label: t('contextMenu.isolate') ?? 'Isolate (Show Neighborhood)',
    onClick: () => { props.onIsolateNode(props.nodeId); props.onClose(); },
  });

  actions.push({
    id: 'hide',
    label: t('contextMenu.hide') ?? 'Hide Node',
    onClick: () => { props.onHideNode(props.nodeId); props.onClose(); },
  });

  if (props.isCluster) {
    if (props.isExpanded) {
      actions.push({
        id: 'collapse',
        label: t('contextMenu.collapse') ?? 'Collapse Cluster',
        onClick: () => { props.onCollapseNode(props.nodeId); props.onClose(); },
      });
    } else {
      actions.push({
        id: 'expand',
        label: t('contextMenu.expand') ?? 'Expand Cluster',
        onClick: () => { props.onExpandNode(props.nodeId); props.onClose(); },
      });
    }
  }

  actions.push({
    id: 'callChain',
    label: t('contextMenu.callChain') ?? 'Highlight Call Chain',
    onClick: () => { props.onHighlightCallChain(props.nodeId); props.onClose(); },
  });

  actions.push({
    id: 'impact',
    label: t('contextMenu.impact') ?? 'Analyze Impact',
    onClick: () => { props.onHighlightImpact(props.nodeId); props.onClose(); },
  });

  actions.push({
    id: 'findPath',
    label: t('contextMenu.findPath') ?? 'Find Path From Here',
    onClick: () => { props.onFindPath(props.nodeId); props.onClose(); },
  });

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: `${props.position.x}px`,
    top: `${props.position.y}px`,
    zIndex: 10000,
  };

  return (
    <div className="cg-context-menu" ref={menuRef} style={menuStyle} role="menu">
      {actions.map((action) => (
        <button
          key={action.id}
          className="cg-context-menu-item"
          role="menuitem"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}