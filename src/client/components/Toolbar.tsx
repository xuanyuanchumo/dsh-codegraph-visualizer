import React, { useCallback, memo } from 'react';
import type { LayoutType, GraphType, RankDir } from '../store/graphStore.ts';
import type { ViewMode } from '../../types/index.ts';
import { useT, useLang, toggleLang } from '../i18n/index.ts';
import { WorkspaceSelector } from './WorkspaceSelector.tsx';
import { Dropdown } from './Dropdown.tsx';
import { useElementWidth } from '../hooks/useElementWidth.ts';
import { UI } from '../../shared/constants.ts';
import { STRUCTURAL_VIEW_MODES, BEHAVIORAL_VIEW_MODES, BEHAVIORAL_MICRO_VIEW_MODES, getViewLayer, getAvailablePanels } from '../../shared/viewModeUtils.ts';
import {
  SearchIcon, MapIcon, RefreshIcon,
  SunIcon, MoonIcon, DownloadIcon, ChevronDownIcon, ChevronUpIcon,
  UploadIcon, LayersIcon, ZapIcon,
  UndoIcon, RedoIcon, StarIcon, FilterIcon, MoreIcon,
} from './Icons.tsx';
import {
  LAYOUTS, RANK_DIRS, GRAPH_TYPES,
  STRUCTURAL_MODE_KEYS, BEHAVIORAL_MODE_KEYS, BEHAVIORAL_MICRO_MODE_KEYS,
  STRUCTURAL_TITLE_KEYS, BEHAVIORAL_TITLE_KEYS, BEHAVIORAL_MICRO_TITLE_KEYS,
  CLUSTER_DEPTHS, HIERARCHY_LEVELS, PANEL_DROPDOWN_SECTIONS, EXPORT_FORMATS,
} from './toolbarConfig.ts';
import type { ToolbarProps, ExportFormat } from './toolbarTypes.ts';

export type {
  ToolMenuItem, ToolbarVisibilityState, ToolbarToggleHandlers, PanelControls,
  ExportFormat, ToolbarLayoutConfig, ToolbarViewConfig, ToolbarHistory, ToolbarProps,
} from './toolbarTypes.ts';

export const Toolbar = memo(function Toolbar(props: ToolbarProps) {
  const t = useT();
  const lang = useLang();
  const [toolbarRef, toolbarWidth] = useElementWidth<HTMLDivElement>();
  const isCompact = toolbarWidth > 0 && toolbarWidth < UI.TOOLBAR_BREAKPOINT_COMPACT_PX;
  const isNarrow = toolbarWidth > 0 && toolbarWidth < UI.TOOLBAR_BREAKPOINT_NARROW_PX;

  const onExport = props.onExport;
  const handleExport = useCallback((format: ExportFormat) => {
    onExport(format);
  }, [onExport]);

  const {
    statsText, typeCounts, theme, collapsed, hasData, panelControls,
    layoutConfig, viewConfig, history,
    onThemeToggle, onRefresh, onCollapse,
    currentWorkspace, workspaceList, onSwitchWorkspace, onAddWorkspace, onRemoveWorkspace,
    onCollapseAll,
  } = props;

  const { layout, dagreRankDir, clusterDepth } = layoutConfig;
  const onLayoutChange = useCallback((l: LayoutType) => layoutConfig.onChange('layout', l), [layoutConfig]);
  const onDagreRankDirChange = useCallback((d: RankDir) => layoutConfig.onChange('dagreRankDir', d), [layoutConfig]);
  const onClusterDepthChange = useCallback((d: number) => layoutConfig.onChange('clusterDepth', d), [layoutConfig]);

  const { viewMode, graphType, currentLayer, layerNames, hierarchyLevel, hasSelectedFunction } = viewConfig;
  const onViewModeChange = useCallback((m: ViewMode) => viewConfig.onChange('viewMode', m), [viewConfig]);
  const onGraphTypeChange = useCallback((g: GraphType) => viewConfig.onChange('graphType', g), [viewConfig]);
  const onLayerChange = useCallback((l: number) => viewConfig.onChange('layer', l), [viewConfig]);
  const onHierarchyLevelChange = useCallback((l: number) => viewConfig.onChange('hierarchyLevel', l), [viewConfig]);

  const onUndo = history?.undo;
  const onRedo = history?.redo;
  const canUndo = history?.canUndo;
  const canRedo = history?.canRedo;

  const {
    showSearch, showCycles, cycleIsolation, showMiniMap, showLegend, showImport,
    showFilterPanel, showTour,
    onToggleSearch, onToggleCycleIsolation, onToggleMiniMap, onToggleLegend,
    onToggleImport, onToggleFilterPanel, onToggleTour,
  } = panelControls;

  const availablePanels = getAvailablePanels(getViewLayer(viewMode));

  const moreDropdownItems: { key: string; titleKey: string; icon: React.ReactNode; active: boolean; onClick: () => void; role: 'menuitem' | 'menuitemcheckbox' }[] = [];
  if (isNarrow && availablePanels.has('showSearch')) {
    moreDropdownItems.push({ key: 'search', titleKey: 'toolbar.search', icon: <SearchIcon size={14} />, active: showSearch, onClick: onToggleSearch, role: 'menuitemcheckbox' });
  }
  if (isCompact) {
    moreDropdownItems.push(
      { key: 'minimap', titleKey: 'toolbar.minimap', icon: <MapIcon size={14} />, active: showMiniMap, onClick: onToggleMiniMap, role: 'menuitemcheckbox' },
      { key: 'legend', titleKey: 'toolbar.legend', icon: <LayersIcon size={14} />, active: showLegend, onClick: onToggleLegend, role: 'menuitemcheckbox' },
      { key: 'theme', titleKey: 'toolbar.theme', icon: theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />, active: false, onClick: onThemeToggle, role: 'menuitem' },
      { key: 'lang', titleKey: 'toolbar.lang', icon: null, active: false, onClick: toggleLang, role: 'menuitem' },
    );
  }
  if (isNarrow) {
    moreDropdownItems.push({ key: 'tour', titleKey: 'toolbar.tour', icon: <StarIcon size={14} />, active: showTour, onClick: onToggleTour, role: 'menuitemcheckbox' });
  }

  return (
    <div className="cg-graph-toolbar" ref={toolbarRef}>
      <div className="cg-toolbar-left">
        <WorkspaceSelector
          currentWorkspace={currentWorkspace}
          workspaceList={workspaceList}
          onSwitchWorkspace={onSwitchWorkspace}
          onAddWorkspace={onAddWorkspace}
          onRemoveWorkspace={onRemoveWorkspace}
        />
        <span className="cg-node-count">{statsText}</span>
        {typeCounts.function > 0 && <span className="cg-type-badge cg-function">fn:{typeCounts.function}</span>}
        {typeCounts.class > 0 && <span className="cg-type-badge cg-class">cls:{typeCounts.class}</span>}
        {typeCounts.interface > 0 && <span className="cg-type-badge cg-interface">if:{typeCounts.interface}</span>}
        {onCollapseAll && <button className="cg-collapse-all-btn" onClick={onCollapseAll} title={t('detail.collapse')}>{t('detail.collapse')}</button>}
      </div>

      <div className="cg-toolbar-center">
        <Dropdown
          triggerClassName="cg-layout-dropdown-btn"
          triggerTitle={t('toolbar.layoutSwitcher')}
          triggerAriaLabel={t('toolbar.layoutSwitcher')}
          triggerAriaHasPopup="menu"
          triggerContent={<>{layout}<ChevronDownIcon size={12} /></>}
          contentClassName="cg-dropdown-content cg-layout-dropdown"
        >
          {(close) => (
            <>
              {LAYOUTS.map((l) => (
                <button key={l} className={`cg-dropdown-item ${layout === l ? 'cg-active' : ''}`}
                  onClick={() => { onLayoutChange(l); if (l !== 'dagre') close(); }}
                  aria-pressed={layout === l}>{l}</button>
              ))}
              {layout === 'dagre' && (
                <>
                  <div className="cg-dropdown-separator" />
                  {RANK_DIRS.map((d) => (
                    <button key={d.value} className={`cg-dropdown-item ${dagreRankDir === d.value ? 'cg-active' : ''}`}
                      onClick={() => { onDagreRankDirChange(d.value); close(); }}
                      aria-pressed={dagreRankDir === d.value}>{d.label}</button>
                  ))}
                </>
              )}
            </>
          )}
        </Dropdown>
        <Dropdown
          triggerClassName="cg-view-dropdown-btn"
          triggerTitle={t('toolbar.viewMode')}
          triggerAriaLabel={t('toolbar.viewMode')}
          triggerAriaHasPopup="menu"
          triggerContent={<>{t(STRUCTURAL_MODE_KEYS[viewMode] ?? BEHAVIORAL_MODE_KEYS[viewMode] ?? BEHAVIORAL_MICRO_MODE_KEYS[viewMode] ?? 'toolbar.viewMode')}<ChevronDownIcon size={12} /></>}
          contentClassName="cg-dropdown-content cg-view-dropdown"
        >
          {(close) => (
            <>
              <div className="cg-dropdown-section-label">{t('toolbar.graphType')}</div>
              {GRAPH_TYPES.map((g) => (
                <button key={g.value} className={`cg-dropdown-item ${graphType === g.value ? 'cg-active' : ''}`}
                  onClick={() => { onGraphTypeChange(g.value); }}
                  aria-pressed={graphType === g.value}>{t(g.key)}</button>
              ))}
              <div className="cg-dropdown-separator" />
              <div className="cg-dropdown-section-label">{t('toolbar.viewModeStructural')}</div>
              {STRUCTURAL_VIEW_MODES.map((m) => (
                <button key={m} className={`cg-dropdown-item ${viewMode === m ? 'cg-active' : ''}`}
                  onClick={() => { onViewModeChange(m); close(); }}
                  title={t(STRUCTURAL_TITLE_KEYS[m]!)}
                  aria-pressed={viewMode === m}>{t(STRUCTURAL_MODE_KEYS[m]!)}</button>
              ))}
              <div className="cg-dropdown-separator" />
              <div className="cg-dropdown-section-label">{t('toolbar.viewModeBehavioral')}</div>
              {BEHAVIORAL_VIEW_MODES.map((m) => (
                <button key={m} className={`cg-dropdown-item ${viewMode === m ? 'cg-active' : ''}`}
                  onClick={() => { onViewModeChange(m); close(); }}
                  title={t(BEHAVIORAL_TITLE_KEYS[m]!)}
                  aria-pressed={viewMode === m}>{t(BEHAVIORAL_MODE_KEYS[m]!)}</button>
              ))}
              <div className="cg-dropdown-separator" />
              <div className="cg-dropdown-section-label">{t('toolbar.viewModeMicro')}</div>
              {BEHAVIORAL_MICRO_VIEW_MODES.map((m) => (
                <button key={m} className={`cg-dropdown-item ${viewMode === m ? 'cg-active' : ''}`}
                  onClick={() => { onViewModeChange(m); close(); }}
                  title={hasSelectedFunction ? t(BEHAVIORAL_MICRO_TITLE_KEYS[m]!) : t('toolbar.microDisabled')}
                  aria-pressed={viewMode === m}
                  disabled={!hasSelectedFunction}
                  aria-disabled={!hasSelectedFunction}>{t(BEHAVIORAL_MICRO_MODE_KEYS[m]!)}</button>
              ))}
            </>
          )}
        </Dropdown>
        <Dropdown
          triggerClassName="cg-level-dropdown-btn"
          triggerTitle={t('toolbar.hierarchy')}
          triggerAriaLabel={t('toolbar.hierarchy')}
          triggerAriaHasPopup="menu"
          triggerContent={<>{`L${hierarchyLevel}`}<ChevronDownIcon size={12} /></>}
          contentClassName="cg-dropdown-content cg-level-dropdown"
        >
          {(_close) => (
            <>
              <div className="cg-dropdown-section-label">{t('toolbar.hierarchy')}</div>
              {HIERARCHY_LEVELS.map((lvl) => (
                <button key={lvl.value} className={`cg-dropdown-item ${hierarchyLevel === lvl.value ? 'cg-active' : ''}`}
                  onClick={() => { onHierarchyLevelChange(lvl.value); }}
                  aria-pressed={hierarchyLevel === lvl.value} title={t(lvl.key)}>
                  {lvl.short} — {t(lvl.key)}
                </button>
              ))}
              {layerNames.length > 1 && (
                <>
                  <div className="cg-dropdown-separator" />
                  <div className="cg-dropdown-section-label">{t('toolbar.layer')}</div>
                  {layerNames.map((name, idx) => {
                    const translated = t(name) ?? name;
                    return (
                      <button key={idx} className={`cg-dropdown-item ${currentLayer === idx ? 'cg-active' : ''}`}
                        onClick={() => { onLayerChange(idx); }}
                        aria-pressed={currentLayer === idx} title={translated}>
                        {translated}
                      </button>
                    );
                  })}
                </>
              )}
            </>
          )}
        </Dropdown>
        {viewMode === 'code' && (
          <select
            value={clusterDepth}
            onChange={(e) => onClusterDepthChange(Number(e.target.value))}
            className="cg-depth-select"
            id="cluster-depth"
            name="cluster-depth"
            aria-label={t('toolbar.cluster')}
            title={t('toolbar.cluster')}
          >
            {CLUSTER_DEPTHS.map((opt) => (
              <option key={opt.value} value={opt.value}>{t(opt.key)}</option>
            ))}
          </select>
        )}
      </div>

      <div className="cg-toolbar-right">
        <div className="cg-toolbar-group" role="group" aria-label={t('toolbar.dataGroup')}>
          <button className="cg-import-btn" onClick={onToggleImport} title={t('toolbar.import')}
            aria-label={t('toolbar.import')} aria-pressed={showImport}><UploadIcon size={15} /></button>

          <button className={`cg-filter-panel-btn ${showFilterPanel ? 'cg-active' : ''}`} onClick={onToggleFilterPanel}
            title={t('toolbar.filterPanel')} aria-label={t('toolbar.filterPanel')} aria-pressed={showFilterPanel}>
            <FilterIcon size={15} />
          </button>
        </div>

        <span className="cg-toolbar-separator" aria-hidden="true" />

        <div className="cg-toolbar-group" role="group" aria-label={t('toolbar.analysisGroup')}>
          {availablePanels.has('showSearch') && !isNarrow && (
            <button className={`cg-search-standalone-btn ${showSearch ? 'cg-active' : ''}`} onClick={onToggleSearch}
              title={t('toolbar.search')} aria-label={t('toolbar.search')} aria-pressed={showSearch}><SearchIcon size={15} /></button>
          )}
          <Dropdown
            triggerClassName="cg-tools-dropdown-btn"
            triggerTitle={t('toolbar.tools')}
            triggerAriaLabel={t('toolbar.tools')}
            triggerAriaHasPopup="menu"
            triggerContent={<><ZapIcon size={15} /><ChevronDownIcon size={10} /></>}
            contentRole="menu"
          >
            {(close) => (
              <>
                {PANEL_DROPDOWN_SECTIONS.map((section, sectionIdx) => (
                  <React.Fragment key={section.labelKey}>
                    {sectionIdx > 0 && <div className="cg-dropdown-separator" />}
                    <div className="cg-dropdown-section-label">{t(section.labelKey)}</div>
                    {section.items.map(({ panel, Icon, key, btnClass, toggle }) =>
                      availablePanels.has(panel) ? (
                        <button key={panel} className={`cg-dropdown-item ${btnClass} ${panelControls[panel] ? 'cg-active' : ''}`}
                          onClick={() => { panelControls[toggle](); close(); }}
                          role="menuitemcheckbox" aria-checked={panelControls[panel]} title={t(key)}>
                          <Icon size={14} /><span>{t(key)}</span>
                        </button>
                      ) : null
                    )}
                    {sectionIdx === 0 && showCycles && (
                      <button className={`cg-dropdown-item cg-isolate-btn ${cycleIsolation ? 'cg-active' : ''}`} onClick={() => { onToggleCycleIsolation(); close(); }}
                        role="menuitemcheckbox" aria-checked={cycleIsolation} title={t('toolbar.isolateCycles')}>
                        <FilterIcon size={14} /><span>{t('toolbar.isolateCycles')}</span>
                      </button>
                    )}
                  </React.Fragment>
                ))}
              </>
            )}
          </Dropdown>

          {!isNarrow && (
            <button className={`cg-tour-btn ${showTour ? 'cg-active' : ''}`} onClick={onToggleTour}
              title={t('toolbar.tour')} aria-label={t('toolbar.tour')} aria-pressed={showTour}><StarIcon size={15} /></button>
          )}
        </div>

        <span className="cg-toolbar-separator" aria-hidden="true" />

        <div className="cg-toolbar-group" role="group" aria-label={t('toolbar.viewGroup')}>
          {!isCompact && (
            <button className={`cg-minimap-btn ${showMiniMap ? 'cg-active' : ''}`} onClick={onToggleMiniMap}
              title={t('toolbar.minimap')} aria-label={t('toolbar.minimap')} aria-pressed={showMiniMap}><MapIcon size={15} /></button>
          )}
          {!isCompact && (
            <button className={`cg-legend-btn ${showLegend ? 'cg-active' : ''}`} onClick={onToggleLegend}
              title={t('toolbar.legend')} aria-label={t('toolbar.legend')} aria-pressed={showLegend}><LayersIcon size={15} /></button>
          )}
          <button className="cg-refresh-btn" onClick={onRefresh} title={t('toolbar.refresh')}
            aria-label={t('toolbar.refresh')}><RefreshIcon size={15} /></button>
          {onUndo && (
            <button className="cg-undo-btn" onClick={onUndo} disabled={!canUndo} title={t('toolbar.undo')}
              aria-label={t('toolbar.undo')} aria-disabled={!canUndo}><UndoIcon size={15} /></button>
          )}
          {onRedo && (
            <button className="cg-redo-btn" onClick={onRedo} disabled={!canRedo} title={t('toolbar.redo')}
              aria-label={t('toolbar.redo')} aria-disabled={!canRedo}><RedoIcon size={15} /></button>
          )}
        </div>

        <span className="cg-toolbar-separator" aria-hidden="true" />

        <div className="cg-toolbar-group" role="group" aria-label={t('toolbar.settingsGroup')}>
          {!isCompact && (
            <button className="cg-theme-btn" onClick={onThemeToggle} title={t('toolbar.theme')}
              aria-label={t('toolbar.theme')}>{theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}</button>
          )}
          {!isCompact && (
            <button className="cg-lang-btn" onClick={toggleLang} title={t('toolbar.lang')}
              aria-label={t('toolbar.lang')}><span className="cg-lang-label">{lang === 'zh' ? '中' : 'EN'}</span></button>
          )}
          <Dropdown
            triggerClassName="cg-export-btn"
            triggerTitle={t('toolbar.export')}
            triggerAriaLabel={t('toolbar.export')}
            triggerAriaHasPopup="menu"
            triggerContent={<DownloadIcon size={15} />}
            containerClassName="cg-export-menu"
            contentClassName="cg-export-dropdown"
            contentRole="menu"
            triggerDisabled={!hasData}
          >
            {(close) => EXPORT_FORMATS.map(({ value, key }) => (
              <button key={value} onClick={() => { handleExport(value); close(); }} role="menuitem">{t(key)}</button>
            ))}
          </Dropdown>
        </div>

        {moreDropdownItems.length > 0 && (
          <Dropdown
            triggerClassName="cg-more-btn"
            triggerTitle={t('toolbar.more')}
            triggerAriaLabel={t('toolbar.more')}
            triggerAriaHasPopup="menu"
            triggerContent={<MoreIcon size={15} />}
            contentRole="menu"
          >
            {(close) => moreDropdownItems.map(({ key, titleKey, icon, active, onClick, role }) => (
              <button key={key} className={`cg-dropdown-item ${active ? 'cg-active' : ''}`} onClick={() => { onClick(); close(); }}
                role={role} aria-checked={role === 'menuitemcheckbox' ? active : undefined} title={t(titleKey)} aria-label={t(titleKey)}>
                {icon}<span>{t(titleKey)}</span>
              </button>
            ))}
          </Dropdown>
        )}

        <button className="cg-collapse-btn" onClick={onCollapse} title={collapsed ? t('panel.expand') : t('panel.collapse')}
          aria-label={collapsed ? t('panel.expandPanel') : t('panel.collapsePanel')}
          aria-expanded={!collapsed}>
          {collapsed ? <ChevronUpIcon size={15} /> : <ChevronDownIcon size={15} />}
        </button>
      </div>
    </div>
  );
});
