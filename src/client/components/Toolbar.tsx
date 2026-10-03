import React, { useCallback, memo } from 'react';
import { toggleLang } from '../i18n/index.ts';
import { useElementWidth } from '../hooks/useElementWidth.ts';
import { UI } from '../../shared/constants.ts';
import { getAvailablePanels, getViewLayer } from '../../shared/viewModeUtils.ts';
import {
  SearchIcon, MapIcon, SunIcon, MoonIcon, StarIcon, FilterIcon,
} from './Icons.tsx';
import { ToolbarWorkspace } from './toolbar/ToolbarWorkspace.tsx';
import { ToolbarViewMode } from './toolbar/ToolbarViewMode.tsx';
import { ToolbarActions } from './toolbar/ToolbarActions.tsx';
import { ToolbarSettings } from './toolbar/ToolbarSettings.tsx';
import type { ToolbarProps, ExportFormat } from './toolbarTypes.ts';

export type {
  ToolMenuItem, ToolbarVisibilityState, ToolbarToggleHandlers, PanelControls,
  ExportFormat, ToolbarLayoutConfig, ToolbarViewConfig, ToolbarHistory, ToolbarProps,
} from './toolbarTypes.ts';

export const Toolbar = memo(function Toolbar(props: ToolbarProps) {

  const [toolbarRef, toolbarWidth] = useElementWidth<HTMLDivElement>();
  const isCompact = toolbarWidth > 0 && toolbarWidth < UI.TOOLBAR_BREAKPOINT_COMPACT_PX;
  const isNarrow = toolbarWidth > 0 && toolbarWidth < UI.TOOLBAR_BREAKPOINT_NARROW_PX;

  const onExport = props.onExport;
  const handleExport = useCallback((format: ExportFormat) => { onExport(format); }, [onExport]);

  const {
    statsText, typeCounts, theme, collapsed, hasData, hasGraphData, panelControls,
    layoutConfig, viewConfig, history,
    onThemeToggle, onRefresh, onCollapse,
    currentWorkspace, workspaceList, onSwitchWorkspace, onAddWorkspace, onRemoveWorkspace,
    onCollapseAll,
  } = props;

  const { viewMode } = viewConfig;
  const availablePanels = getAvailablePanels(getViewLayer(viewMode));

  const moreDropdownItems: { key: string; titleKey: string; icon: React.ReactNode; active: boolean; onClick: () => void; role: 'menuitem' | 'menuitemcheckbox' }[] = [];
  if (isNarrow && availablePanels.has('showSearch')) {
    moreDropdownItems.push({ key: 'search', titleKey: 'toolbar.search', icon: <SearchIcon size={14} />, active: panelControls.showSearch, onClick: panelControls.onToggleSearch, role: 'menuitemcheckbox' });
  }
  moreDropdownItems.push(
    { key: 'minimap', titleKey: 'toolbar.minimap', icon: <MapIcon size={14} />, active: panelControls.showMiniMap, onClick: panelControls.onToggleMiniMap, role: 'menuitemcheckbox' },
    { key: 'legend', titleKey: 'toolbar.legend', icon: <FilterIcon size={14} />, active: panelControls.showLegend, onClick: panelControls.onToggleLegend, role: 'menuitemcheckbox' },
    { key: 'theme', titleKey: 'toolbar.theme', icon: theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />, active: false, onClick: onThemeToggle, role: 'menuitem' },
    { key: 'lang', titleKey: 'toolbar.lang', icon: null, active: false, onClick: toggleLang, role: 'menuitem' },
    { key: 'tour', titleKey: 'toolbar.tour', icon: <StarIcon size={14} />, active: panelControls.showTour, onClick: panelControls.onToggleTour, role: 'menuitemcheckbox' },
  );
  if (onCollapseAll) {
    moreDropdownItems.push({ key: 'collapseAll', titleKey: 'detail.collapse', icon: null, active: false, onClick: onCollapseAll, role: 'menuitem' });
  }

  return (
    <div
      className="cg-graph-toolbar"
      ref={toolbarRef}
      data-cg-compact={isCompact ? '' : undefined}
      data-cg-narrow={isNarrow ? '' : undefined}
    >
      <ToolbarWorkspace
        statsText={statsText}
        typeCounts={typeCounts}
        hasData={hasData}
        currentWorkspace={currentWorkspace}
        workspaceList={workspaceList}
        onSwitchWorkspace={onSwitchWorkspace}
        onAddWorkspace={onAddWorkspace}
        onRemoveWorkspace={onRemoveWorkspace}
      />

      <ToolbarViewMode
        layoutConfig={layoutConfig}
        viewConfig={viewConfig}
        hasGraphData={hasGraphData}
        isCompact={isCompact}
      />

      <div className="cg-toolbar-right">
        <ToolbarActions
          panelControls={panelControls}
          history={history}
          onRefresh={onRefresh}
          isNarrow={isNarrow}
          viewMode={viewMode}
        />

        <ToolbarSettings
          hasData={hasData}
          collapsed={collapsed}
          onExport={handleExport}
          onCollapse={onCollapse}
          moreDropdownItems={moreDropdownItems}
        />
      </div>
    </div>
  );
});
