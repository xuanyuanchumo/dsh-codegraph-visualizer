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
import { buildMoreMenuSections } from './toolbar/moreMenu.ts';
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

  // 「更多」下拉的分段结构：构造 + 过滤空段都在纯函数里完成（见 toolbar/moreMenu.ts），
  // 组件只渲染结果，因此结构上不可能出现「只有标题、没有条目」的空段。
  const moreSections = buildMoreMenuSections({
    isNarrow,
    searchAvailable: availablePanels.has('showSearch'),
    showSearch: panelControls.showSearch,
    onToggleSearch: panelControls.onToggleSearch,
    showMiniMap: panelControls.showMiniMap,
    onToggleMiniMap: panelControls.onToggleMiniMap,
    showLegend: panelControls.showLegend,
    onToggleLegend: panelControls.onToggleLegend,
    themeIsDark: theme === 'dark',
    onThemeToggle,
    onToggleLang: toggleLang,
    showTour: panelControls.showTour,
    onToggleTour: panelControls.onToggleTour,
    onCollapseAll,
    icons: {
      search: <SearchIcon size={14} />,
      minimap: <MapIcon size={14} />,
      legend: <FilterIcon size={14} />,
      theme: theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />,
      tour: <StarIcon size={14} />,
    },
  });

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
          moreSections={moreSections}
        />
      </div>
    </div>
  );
});
