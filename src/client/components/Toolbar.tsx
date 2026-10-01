import React, { useCallback, memo } from 'react';
import type { LayoutType, ThemeType, GraphType, RankDir } from '../store/graphStore.ts';
import type { GraphNode, ViewMode } from '../../types/index.ts';
import type { WorkspaceSelectorProps } from './WorkspaceSelector.tsx';
import { useT, useLang, toggleLang } from '../i18n/index.ts';
import { WorkspaceSelector } from './WorkspaceSelector.tsx';
import { Dropdown } from './Dropdown.tsx';
import { useElementWidth } from '../hooks/useElementWidth.ts';
import { STRUCTURAL_VIEW_MODES, BEHAVIORAL_VIEW_MODES, BEHAVIORAL_MICRO_VIEW_MODES, getViewLayer, getAvailablePanels, type AnalysisPanelKey } from '../../shared/viewModeUtils.ts';
import {
  SearchIcon, ChainIcon, CycleIcon, MapIcon, RefreshIcon,
  SunIcon, MoonIcon, DownloadIcon, ChevronDownIcon, ChevronUpIcon,
  UploadIcon, LayersIcon, ZapIcon, TreeIcon,
  PathIcon, HeartIcon, RuleIcon, FlameIcon, AlertCircleIcon,
  UndoIcon, RedoIcon, StarIcon, FilterIcon, GhostIcon, MoreIcon,
} from './Icons.tsx';

const LAYOUTS: LayoutType[] = ['cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree'];
const FILTER_KEYS: { value: GraphNode['type'] | 'all'; key: string }[] = [
  { value: 'all', key: 'filter.all' },
  { value: 'function', key: 'filter.function' },
  { value: 'class', key: 'filter.class' },
  { value: 'variable', key: 'filter.variable' },
  { value: 'module', key: 'filter.module' },
  { value: 'interface', key: 'filter.interface' },
];

const RANK_DIRS: { value: RankDir; label: string }[] = [
  { value: 'TB', label: 'TB' },
  { value: 'LR', label: 'LR' },
  { value: 'BT', label: 'BT' },
  { value: 'RL', label: 'RL' },
];

const GRAPH_TYPES: { value: GraphType; key: string }[] = [
  { value: 'all', key: 'graphType.all' },
  { value: 'call', key: 'graphType.call' },
  { value: 'dependency', key: 'graphType.dependency' },
];


const STRUCTURAL_MODE_KEYS: Partial<Record<ViewMode, string>> = {
  code: 'viewMode.code',
};
const BEHAVIORAL_MODE_KEYS: Partial<Record<ViewMode, string>> = {
  dependencies: 'viewMode.dependencies',
  inheritance: 'viewMode.inheritance',
  callgraph: 'viewMode.callgraph',
  package: 'viewMode.package',
  class: 'viewMode.class',
};
const BEHAVIORAL_MICRO_MODE_KEYS: Partial<Record<ViewMode, string>> = {
  cfg: 'viewMode.cfg',
  flowchart: 'viewMode.flowchart',
  sequence: 'viewMode.sequence',
};
const STRUCTURAL_TITLE_KEYS: Partial<Record<ViewMode, string>> = {
  code: 'toolbar.viewModeCode',
};
const BEHAVIORAL_TITLE_KEYS: Partial<Record<ViewMode, string>> = {
  dependencies: 'toolbar.viewModeDeps',
  inheritance: 'toolbar.viewModeInheritance',
  callgraph: 'toolbar.viewModeCallgraph',
  package: 'toolbar.viewModePackage',
  class: 'toolbar.viewModeClass',
};
const BEHAVIORAL_MICRO_TITLE_KEYS: Partial<Record<ViewMode, string>> = {
  cfg: 'toolbar.viewModeCfg',
  flowchart: 'toolbar.viewModeFlowchart',
  sequence: 'toolbar.viewModeSequence',
};

const CLUSTER_DEPTHS: { value: number; key: string }[] = [
  { value: 0, key: 'clusterDepth.directory' },
  { value: 1, key: 'clusterDepth.file' },
  { value: 2, key: 'clusterDepth.function' },
];

interface ToolMenuItem {
  panel: AnalysisPanelKey;
  Icon: React.ComponentType<{ size?: number }>;
  key: string;
  btnClass: string;
  toggle: keyof ToolbarToggleHandlers;
}

const ANALYSIS_ITEMS: ToolMenuItem[] = [
  { panel: 'showCallChain', Icon: ChainIcon, key: 'toolbar.chain', btnClass: 'cg-chain-btn', toggle: 'onToggleCallChain' },
  { panel: 'showCycles', Icon: CycleIcon, key: 'toolbar.cycles', btnClass: 'cg-cycle-btn', toggle: 'onToggleCycles' },
  { panel: 'showImpact', Icon: ZapIcon, key: 'toolbar.impact', btnClass: 'cg-impact-btn', toggle: 'onToggleImpact' },
  { panel: 'showInheritance', Icon: TreeIcon, key: 'toolbar.inheritance', btnClass: 'cg-inheritance-btn', toggle: 'onToggleInheritance' },
  { panel: 'showPathFind', Icon: PathIcon, key: 'toolbar.pathFind', btnClass: 'cg-pathfind-btn', toggle: 'onTogglePathFind' },
];

const QUALITY_ITEMS: ToolMenuItem[] = [
  { panel: 'showHealthScore', Icon: HeartIcon, key: 'toolbar.health', btnClass: 'cg-health-btn', toggle: 'onToggleHealthScore' },
  { panel: 'showRules', Icon: RuleIcon, key: 'toolbar.rules', btnClass: 'cg-rules-btn', toggle: 'onToggleRules' },
  { panel: 'showHotspot', Icon: FlameIcon, key: 'toolbar.hotspot', btnClass: 'cg-hotspot-btn', toggle: 'onToggleHotspot' },
  { panel: 'showGodModule', Icon: AlertCircleIcon, key: 'toolbar.godModule', btnClass: 'cg-godmodule-btn', toggle: 'onToggleGodModule' },
  { panel: 'showCoreFunction', Icon: StarIcon, key: 'toolbar.coreFunction', btnClass: 'cg-corefunction-btn', toggle: 'onToggleCoreFunction' },
  { panel: 'showDeadCode', Icon: GhostIcon, key: 'toolbar.deadCode', btnClass: 'cg-deadcode-btn', toggle: 'onToggleDeadCode' },
];

export interface ToolbarVisibilityState {
  showSearch: boolean;
  showCallChain: boolean;
  showCycles: boolean;
  cycleIsolation: boolean;
  showImpact: boolean;
  showInheritance: boolean;
  showMiniMap: boolean;
  showLegend: boolean;
  showImport: boolean;
  showPathFind: boolean;
  showHealthScore: boolean;
  showRules: boolean;
  showHotspot: boolean;
  showGodModule: boolean;
  showCoreFunction: boolean;
  showDeadCode: boolean;
  showFilterPanel: boolean;
  showTour: boolean;
}

export interface ToolbarToggleHandlers {
  onToggleSearch: () => void;
  onToggleCallChain: () => void;
  onToggleCycles: () => void;
  onToggleCycleIsolation: () => void;
  onToggleImpact: () => void;
  onToggleInheritance: () => void;
  onToggleMiniMap: () => void;
  onToggleLegend: () => void;
  onToggleImport: () => void;
  onTogglePathFind: () => void;
  onToggleHealthScore: () => void;
  onToggleRules: () => void;
  onToggleHotspot: () => void;
  onToggleGodModule: () => void;
  onToggleCoreFunction: () => void;
  onToggleDeadCode: () => void;
  onToggleFilterPanel: () => void;
  onToggleTour: () => void;
}

export interface PanelControls extends ToolbarVisibilityState, ToolbarToggleHandlers {}

export type ExportFormat = 'png' | 'svg' | 'json' | 'mermaid' | 'mermaid-seq' | 'mermaid-class' | 'graphml' | 'jsonld';

export interface ToolbarLayoutConfig {
  layout: LayoutType;
  dagreRankDir: RankDir;
  clusterDepth: number;
  onChange: (field: 'layout' | 'dagreRankDir' | 'clusterDepth', value: LayoutType | RankDir | number) => void;
}

export interface ToolbarViewConfig {
  viewMode: ViewMode;
  graphType: GraphType;
  filterType: GraphNode['type'] | 'all';
  currentLayer: number;
  layerNames: string[];
  hasSelectedFunction?: boolean;
  onChange: (field: 'viewMode' | 'graphType' | 'filterType' | 'layer', value: ViewMode | GraphType | GraphNode['type'] | 'all' | number) => void;
}

export interface ToolbarHistory {
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

interface ToolbarProps extends WorkspaceSelectorProps {
  statsText: string;
  typeCounts: { function: number; class: number; interface: number };
  theme: ThemeType;
  collapsed: boolean;
  panelControls: PanelControls;
  layoutConfig: ToolbarLayoutConfig;
  viewConfig: ToolbarViewConfig;
  history?: ToolbarHistory;
  onThemeToggle: () => void;
  onRefresh: () => void;
  onExport: (format: ExportFormat) => void;
  onCollapse: () => void;
  onCollapseAll?: () => void;
}

export const Toolbar = memo(function toolbar(props: ToolbarProps) {
  const t = useT();
  const lang = useLang();
  const [toolbarRef, toolbarWidth] = useElementWidth<HTMLDivElement>();
  const isCompact = toolbarWidth > 0 && toolbarWidth < 768;
  const isNarrow = toolbarWidth > 0 && toolbarWidth < 480;

  const onExport = props.onExport;
  const handleExport = useCallback((format: ExportFormat) => {
    onExport(format);
  }, [onExport]);

  const {
    statsText, typeCounts, theme, collapsed, panelControls,
    layoutConfig, viewConfig, history,
    onThemeToggle, onRefresh, onCollapse,
    currentWorkspace, workspaceList, onSwitchWorkspace, onAddWorkspace, onRemoveWorkspace,
    onCollapseAll,
  } = props;

  const { layout, dagreRankDir, clusterDepth } = layoutConfig;
  const onLayoutChange = useCallback((l: LayoutType) => layoutConfig.onChange('layout', l), [layoutConfig]);
  const onDagreRankDirChange = useCallback((d: RankDir) => layoutConfig.onChange('dagreRankDir', d), [layoutConfig]);
  const onClusterDepthChange = useCallback((d: number) => layoutConfig.onChange('clusterDepth', d), [layoutConfig]);

  const { viewMode, graphType, filterType, currentLayer, layerNames, hasSelectedFunction } = viewConfig;
  const onViewModeChange = useCallback((m: ViewMode) => viewConfig.onChange('viewMode', m), [viewConfig]);
  const onGraphTypeChange = useCallback((g: GraphType) => viewConfig.onChange('graphType', g), [viewConfig]);
  const onFilterChange = useCallback((f: GraphNode['type'] | 'all') => viewConfig.onChange('filterType', f), [viewConfig]);
  const onLayerChange = useCallback((l: number) => viewConfig.onChange('layer', l), [viewConfig]);

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
        {layerNames.length > 1 && (
          <div className="cg-layer-selector" role="group" aria-label={t('toolbar.layer')}>
            {layerNames.map((name, idx) => {
              const translated = t(name) ?? name;
              return (
              <button
                key={idx}
                className={`cg-layer-btn ${currentLayer === idx ? 'cg-active' : ''}`}
                onClick={() => onLayerChange(idx)}
                title={translated}
                aria-pressed={currentLayer === idx}
              >{translated.length <= 4 ? translated : translated.slice(0, 3)}</button>
              );
            })}
          </div>
        )}
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
          <select value={filterType} onChange={(e) => onFilterChange(e.target.value as GraphNode['type'] | 'all')}
            className="cg-filter-select" id="filter-type" name="filter-type" aria-label={t('toolbar.filter')}>
            {FILTER_KEYS.map((opt) => (
              <option key={opt.value} value={opt.value}>{t(opt.key)}</option>
            ))}
          </select>
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
                <div className="cg-dropdown-section-label">{t('toolbar.analysis')}</div>
                {ANALYSIS_ITEMS.map(({ panel, Icon, key, btnClass, toggle }) =>
                  availablePanels.has(panel) ? (
                    <button key={panel} className={`cg-dropdown-item ${btnClass} ${panelControls[panel] ? 'cg-active' : ''}`}
                      onClick={() => { panelControls[toggle](); close(); }}
                      role="menuitemcheckbox" aria-checked={panelControls[panel]} title={t(key)}>
                      <Icon size={14} /><span>{t(key)}</span>
                    </button>
                  ) : null
                )}
                {showCycles && (
                  <button className={`cg-dropdown-item cg-isolate-btn ${cycleIsolation ? 'cg-active' : ''}`} onClick={() => { onToggleCycleIsolation(); close(); }}
                    role="menuitemcheckbox" aria-checked={cycleIsolation} title={t('toolbar.isolateCycles')}>
                    <FilterIcon size={14} /><span>{t('toolbar.isolateCycles')}</span>
                  </button>
                )}
                <div className="cg-dropdown-separator" />
                <div className="cg-dropdown-section-label">{t('toolbar.quality')}</div>
                {QUALITY_ITEMS.map(({ panel, Icon, key, btnClass, toggle }) =>
                  availablePanels.has(panel) ? (
                    <button key={panel} className={`cg-dropdown-item ${btnClass} ${panelControls[panel] ? 'cg-active' : ''}`}
                      onClick={() => { panelControls[toggle](); close(); }}
                      role="menuitemcheckbox" aria-checked={panelControls[panel]} title={t(key)}>
                      <Icon size={14} /><span>{t(key)}</span>
                    </button>
                  ) : null
                )}
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
          >
            {(close) => (
              <>
                <button onClick={() => { handleExport('png'); close(); }} role="menuitem">{t('export.png')}</button>
                <button onClick={() => { handleExport('svg'); close(); }} role="menuitem">{t('export.svg')}</button>
                <button onClick={() => { handleExport('json'); close(); }} role="menuitem">{t('export.json')}</button>
                <button onClick={() => { handleExport('mermaid'); close(); }} role="menuitem">{t('export.mermaid')}</button>
                <button onClick={() => { handleExport('mermaid-seq'); close(); }} role="menuitem">{t('export.mermaidSeq')}</button>
                <button onClick={() => { handleExport('mermaid-class'); close(); }} role="menuitem">{t('export.mermaidClass')}</button>
                <button onClick={() => { handleExport('graphml'); close(); }} role="menuitem">{t('export.graphml')}</button>
                <button onClick={() => { handleExport('jsonld'); close(); }} role="menuitem">{t('export.jsonld')}</button>
              </>
            )}
          </Dropdown>
        </div>

        {(isCompact || isNarrow) && (
          <Dropdown
            triggerClassName="cg-more-btn"
            triggerTitle={t('toolbar.more')}
            triggerAriaLabel={t('toolbar.more')}
            triggerAriaHasPopup="menu"
            triggerContent={<MoreIcon size={15} />}
            contentRole="menu"
          >
            {(close) => (
              <>
                {isNarrow && availablePanels.has('showSearch') && (
                  <button className={`cg-dropdown-item ${showSearch ? 'cg-active' : ''}`} onClick={() => { onToggleSearch(); close(); }}
                    role="menuitemcheckbox" aria-checked={showSearch} title={t('toolbar.search')}>
                    <SearchIcon size={14} /><span>{t('toolbar.search')}</span>
                  </button>
                )}
                {isCompact && (
                  <button className={`cg-dropdown-item ${showMiniMap ? 'cg-active' : ''}`} onClick={() => { onToggleMiniMap(); close(); }}
                    role="menuitemcheckbox" aria-checked={showMiniMap} title={t('toolbar.minimap')}>
                    <MapIcon size={14} /><span>{t('toolbar.minimap')}</span>
                  </button>
                )}
                {isCompact && (
                  <button className={`cg-dropdown-item ${showLegend ? 'cg-active' : ''}`} onClick={() => { onToggleLegend(); close(); }}
                    role="menuitemcheckbox" aria-checked={showLegend} title={t('toolbar.legend')}>
                    <LayersIcon size={14} /><span>{t('toolbar.legend')}</span>
                  </button>
                )}
                {isCompact && (
                  <button className="cg-dropdown-item" onClick={() => { onThemeToggle(); close(); }}
                    role="menuitem" title={t('toolbar.theme')}>
                    {theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}<span>{t('toolbar.theme')}</span>
                  </button>
                )}
                {isCompact && (
                  <button className="cg-dropdown-item" onClick={() => { toggleLang(); close(); }}
                    role="menuitem" title={t('toolbar.lang')}>
                    <span>{t('toolbar.lang')}</span>
                  </button>
                )}
                {isNarrow && (
                  <button className={`cg-dropdown-item ${showTour ? 'cg-active' : ''}`} onClick={() => { onToggleTour(); close(); }}
                    role="menuitemcheckbox" aria-checked={showTour} title={t('toolbar.tour')}>
                    <StarIcon size={14} /><span>{t('toolbar.tour')}</span>
                  </button>
                )}
              </>
            )}
          </Dropdown>
        )}

        <button className="cg-collapse-btn" onClick={onCollapse} title={collapsed ? t('panel.expand') : t('panel.collapse')}
          aria-label={collapsed ? t('panel.expandPanel') : t('panel.collapsePanel')}>
          {collapsed ? <ChevronUpIcon size={15} /> : <ChevronDownIcon size={15} />}
        </button>
      </div>
    </div>
  );
});
