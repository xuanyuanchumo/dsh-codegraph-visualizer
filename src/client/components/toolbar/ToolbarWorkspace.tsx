import React, { memo } from 'react';
import { WorkspaceSelector } from '../WorkspaceSelector.tsx';
import { useT } from '../../i18n/index.ts';
import type { WorkspaceSelectorProps } from '../WorkspaceSelector.tsx';

interface ToolbarWorkspaceProps extends WorkspaceSelectorProps {
  statsText: string;
  typeCounts: { function: number; class: number; interface: number };
  hasData: boolean;
  onCollapseAll?: (() => void) | undefined;
}

export const ToolbarWorkspace = memo(function ToolbarWorkspace({
  statsText, typeCounts, hasData, onCollapseAll,
  currentWorkspace, workspaceList, onSwitchWorkspace, onAddWorkspace, onRemoveWorkspace,
}: ToolbarWorkspaceProps) {
  const t = useT();
  return (
    <div className="cg-toolbar-left">
      <WorkspaceSelector
        currentWorkspace={currentWorkspace}
        workspaceList={workspaceList}
        onSwitchWorkspace={onSwitchWorkspace}
        onAddWorkspace={onAddWorkspace}
        onRemoveWorkspace={onRemoveWorkspace}
      />
      {hasData && <span className="cg-node-count">{statsText}</span>}
      {hasData && typeCounts.function > 0 && <span className="cg-type-badge cg-function">fn:{typeCounts.function}</span>}
      {hasData && typeCounts.class > 0 && <span className="cg-type-badge cg-class">cls:{typeCounts.class}</span>}
      {hasData && typeCounts.interface > 0 && <span className="cg-type-badge cg-interface">if:{typeCounts.interface}</span>}
      {hasData && onCollapseAll && (
        <button className="cg-collapse-all-btn" onClick={onCollapseAll} title={t('detail.collapse')}>{t('detail.collapse')}</button>
      )}
    </div>
  );
});