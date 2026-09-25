import React, { useRef, useEffect, useCallback, memo } from 'react';
import type { LayoutType, ThemeType, GraphType, RankDir } from '../store/graphStore.ts';
import type { GraphNode, ViewMode } from '../../types/index.ts';
import type { WorkspaceSelectorProps } from './WorkspaceSelector.tsx';
import { useT, useLang, toggleLang } from '../i18n/index.ts';
import { WorkspaceSelector } from './WorkspaceSelector.tsx';
import { STRUCTURAL_VIEW_MODES, BEHAVIORAL_VIEW_MODES, BEHAVIORAL_MICRO_VIEW_MODES, getViewLayer, getAvailablePanels } from '../../shared/viewModeUtils.ts';
import {
  SearchIcon, ChainIcon, CycleIcon, MapIcon, RefreshIcon,
  SunIcon, MoonIcon, DownloadIcon, ChevronDownIcon, ChevronUpIcon,
  UploadIcon, LayersIcon, ZapIcon, TreeIcon,
  PathIcon, HeartIcon, RuleIcon, FlameIcon, AlertCircleIcon,
  UndoIcon, RedoIcon, StarIcon, FilterIcon,
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
  onToggleFilterPanel: () => void;
  onToggleTour: () => void;
}

export interface PanelControls extends ToolbarVisibilityState, ToolbarToggleHandlers {}

interface ToolbarProps extends WorkspaceSelectorProps {
  statsText: string;
  typeCounts: { function: number; class: number; interface: number };
  layout: LayoutType;
  dagreRankDir: RankDir;
  theme: ThemeType;
  filterType: GraphNode['type'] | 'all';
  graphType: GraphType;
  clusterDepth: number;
  viewMode: ViewMode;
  currentLayer: number;
  layerNames: string[];
  collapsed: boolean;
  panelControls: PanelControls;
  onLayoutChange: (l: LayoutType) => void;
  onDagreRankDirChange: (dir: RankDir) => void;
  onThemeToggle: () => void;
  onFilterChange: (f: GraphNode['type'] | 'all') => void;
  onGraphTypeChange: (g: GraphType) => void;
  onClusterDepthChange: (depth: number) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onLayerChange: (layer: number) => void;
  onRefresh: () => void;
  onExport: (format: 'png' | 'svg' | 'json' | 'mermaid') => void;
  onCollapse: () => void;
  onCollapseAll?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  hasSelectedFunction?: boolean;
}

export const Toolbar = memo(function Toolbar(props: ToolbarProps) {
  const t = useT();
  const lang = useLang();
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [showExportMenu, setShowExportMenu] = React.useState(false);

  useEffect(() => {
    if (!showExportMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showExportMenu]);

  const onExport = props.onExport;
  const handleExport = useCallback((format: 'png' | 'svg' | 'json' | 'mermaid') => {
    onExport(format);
    setShowExportMenu(false);
  }, [onExport]);

  const {
    statsText, typeCounts, layout, dagreRankDir, theme, filterType, graphType, clusterDepth,
    viewMode, currentLayer, layerNames, collapsed, panelControls,
    onLayoutChange, onDagreRankDirChange, onThemeToggle, onFilterChange, onGraphTypeChange, onClusterDepthChange,
    onViewModeChange, onLayerChange,
    onRefresh, onCollapse,
    currentWorkspace, workspaceList, onSwitchWorkspace, onAddWorkspace, onRemoveWorkspace,
    onCollapseAll, onUndo, onRedo, canUndo, canRedo, hasSelectedFunction,
  } = props;

  const {
    showSearch, showCallChain, showCycles, cycleIsolation, showImpact, showInheritance, showMiniMap, showLegend, showImport,
    showPathFind, showHealthScore, showRules, showHotspot, showGodModule, showCoreFunction, showFilterPanel,
    showTour,
    onToggleSearch, onToggleCallChain, onToggleCycles, onToggleCycleIsolation, onToggleImpact, onToggleInheritance, onToggleMiniMap, onToggleLegend,
    onToggleImport, onTogglePathFind, onToggleHealthScore, onToggleRules, onToggleHotspot, onToggleGodModule, onToggleCoreFunction, onToggleFilterPanel,
    onToggleTour,
  } = panelControls;

  const availablePanels = getAvailablePanels(getViewLayer(viewMode));

  return (
    <div className="cg-graph-toolbar">
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
        <div className="cg-layout-buttons" role="group" aria-label={t('toolbar.layoutSwitcher')}>
          {LAYOUTS.map((l) => (
            <button
              key={l}
              className={`cg-layout-btn ${layout === l ? 'cg-active' : ''}`}
              onClick={() => onLayoutChange(l)}
              title={t('toolbar.layout', { l })}
              aria-pressed={layout === l}
            >{l}</button>
          ))}
        </div>
        {layout === 'dagre' && (
          <div className="cg-rank-dir-buttons" role="group" aria-label={t('toolbar.rankDir')}>
            {RANK_DIRS.map((d) => (
              <button
                key={d.value}
                className={`cg-rank-dir-btn ${dagreRankDir === d.value ? 'cg-active' : ''}`}
                onClick={() => onDagreRankDirChange(d.value)}
                title={d.label}
                aria-pressed={dagreRankDir === d.value}
              >{d.label}</button>
            ))}
          </div>
        )}
        <div className="cg-graph-type-buttons" role="group" aria-label={t('toolbar.graphType')}>
          {GRAPH_TYPES.map((g) => (
            <button
              key={g.value}
              className={`cg-graph-type-btn ${graphType === g.value ? 'cg-active' : ''}`}
              onClick={() => onGraphTypeChange(g.value)}
              title={t(g.key)}
              aria-pressed={graphType === g.value}
            >{t(g.key)}</button>
          ))}
        </div>
        <div className="cg-view-mode-buttons" role="group" aria-label={t('toolbar.graphType')}>
          {STRUCTURAL_VIEW_MODES.map((m) => (
            <button
              key={m}
              className={`cg-view-mode-btn ${viewMode === m ? 'cg-active' : ''}`}
              onClick={() => onViewModeChange(m)}
              title={t(STRUCTURAL_TITLE_KEYS[m]!)}
              aria-pressed={viewMode === m}
            >{t(STRUCTURAL_MODE_KEYS[m]!)}</button>
          ))}
          <span className="cg-view-mode-divider" aria-hidden="true" />
          {BEHAVIORAL_VIEW_MODES.map((m) => (
            <button
              key={m}
              className={`cg-view-mode-btn ${viewMode === m ? 'cg-active' : ''}`}
              onClick={() => onViewModeChange(m)}
              title={t(BEHAVIORAL_TITLE_KEYS[m]!)}
              aria-pressed={viewMode === m}
            >{t(BEHAVIORAL_MODE_KEYS[m]!)}</button>
          ))}
          <span className="cg-view-mode-divider" aria-hidden="true" />
          {BEHAVIORAL_MICRO_VIEW_MODES.map((m) => (
            <button
              key={m}
              className={`cg-view-mode-btn cg-view-mode-btn--micro ${viewMode === m ? 'cg-active' : ''}`}
              onClick={() => onViewModeChange(m)}
              title={hasSelectedFunction ? t(BEHAVIORAL_MICRO_TITLE_KEYS[m]!) : t('toolbar.microDisabled')}
              aria-pressed={viewMode === m}
              disabled={!hasSelectedFunction}
              aria-disabled={!hasSelectedFunction}
            >{t(BEHAVIORAL_MICRO_MODE_KEYS[m]!)}</button>
          ))}
        </div>
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
          {availablePanels.has('showSearch') && (
            <button className={`cg-search-btn ${showSearch ? 'cg-active' : ''}`} onClick={onToggleSearch}
              title={t('toolbar.search')} aria-label={t('toolbar.search')} aria-expanded={showSearch}><SearchIcon size={15} /></button>
          )}
          {availablePanels.has('showCallChain') && (
            <button className={`cg-chain-btn ${showCallChain ? 'cg-active' : ''}`} onClick={onToggleCallChain}
              title={t('toolbar.chain')} aria-label={t('toolbar.chain')} aria-pressed={showCallChain}><ChainIcon size={15} /></button>
          )}
          {availablePanels.has('showCycles') && (
            <button className={`cg-cycle-btn ${showCycles ? 'cg-active' : ''}`} onClick={onToggleCycles}
              title={t('toolbar.cycles')} aria-label={t('toolbar.cycles')} aria-pressed={showCycles}><CycleIcon size={15} /></button>
          )}
          {showCycles && (
            <button className={`cg-isolate-btn ${cycleIsolation ? 'cg-active' : ''}`} onClick={onToggleCycleIsolation}
              title={t('toolbar.isolateCycles')} aria-label={t('toolbar.isolateCycles')} aria-pressed={cycleIsolation}><FilterIcon size={15} /></button>
          )}
          {availablePanels.has('showImpact') && (
            <button className={`cg-impact-btn ${showImpact ? 'cg-active' : ''}`} onClick={onToggleImpact}
              title={t('toolbar.impact')} aria-label={t('toolbar.impact')} aria-pressed={showImpact}><ZapIcon size={15} /></button>
          )}
          {availablePanels.has('showInheritance') && (
            <button className={`cg-inheritance-btn ${showInheritance ? 'cg-active' : ''}`} onClick={onToggleInheritance}
              title={t('toolbar.inheritance')} aria-label={t('toolbar.inheritance')} aria-pressed={showInheritance}><TreeIcon size={15} /></button>
          )}
          {availablePanels.has('showPathFind') && (
            <button className={`cg-pathfind-btn ${showPathFind ? 'cg-active' : ''}`} onClick={onTogglePathFind}
              title={t('toolbar.pathFind')} aria-label={t('toolbar.pathFind')} aria-pressed={showPathFind}><PathIcon size={15} /></button>
          )}
          {availablePanels.has('showHealthScore') && (
            <button className={`cg-health-btn ${showHealthScore ? 'cg-active' : ''}`} onClick={onToggleHealthScore}
              title={t('toolbar.health')} aria-label={t('toolbar.health')} aria-pressed={showHealthScore}><HeartIcon size={15} /></button>
          )}
          {availablePanels.has('showRules') && (
            <button className={`cg-rules-btn ${showRules ? 'cg-active' : ''}`} onClick={onToggleRules}
              title={t('toolbar.rules')} aria-label={t('toolbar.rules')} aria-pressed={showRules}><RuleIcon size={15} /></button>
          )}
          {availablePanels.has('showHotspot') && (
            <button className={`cg-hotspot-btn ${showHotspot ? 'cg-active' : ''}`} onClick={onToggleHotspot}
              title={t('toolbar.hotspot')} aria-label={t('toolbar.hotspot')} aria-pressed={showHotspot}><FlameIcon size={15} /></button>
          )}
          {availablePanels.has('showGodModule') && (
            <button className={`cg-godmodule-btn ${showGodModule ? 'cg-active' : ''}`} onClick={onToggleGodModule}
              title={t('toolbar.godModule')} aria-label={t('toolbar.godModule')} aria-pressed={showGodModule}><AlertCircleIcon size={15} /></button>
          )}
          {availablePanels.has('showCoreFunction') && (
            <button className={`cg-corefunction-btn ${showCoreFunction ? 'cg-active' : ''}`} onClick={onToggleCoreFunction}
              title={t('toolbar.coreFunction')} aria-label={t('toolbar.coreFunction')} aria-pressed={showCoreFunction}><StarIcon size={15} /></button>
          )}
          <button className={`cg-tour-btn ${showTour ? 'cg-active' : ''}`} onClick={onToggleTour}
            title={t('toolbar.tour')} aria-label={t('toolbar.tour')} aria-pressed={showTour}><StarIcon size={15} /></button>
        </div>

        <span className="cg-toolbar-separator" aria-hidden="true" />

        <div className="cg-toolbar-group" role="group" aria-label={t('toolbar.viewGroup')}>
          <button className={`cg-minimap-btn ${showMiniMap ? 'cg-active' : ''}`} onClick={onToggleMiniMap}
            title={t('toolbar.minimap')} aria-label={t('toolbar.minimap')} aria-pressed={showMiniMap}><MapIcon size={15} /></button>
          <button className={`cg-legend-btn ${showLegend ? 'cg-active' : ''}`} onClick={onToggleLegend}
            title={t('toolbar.legend')} aria-label={t('toolbar.legend')} aria-pressed={showLegend}><LayersIcon size={15} /></button>
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
          <button className="cg-theme-btn" onClick={onThemeToggle} title={t('toolbar.theme')}
            aria-label={t('toolbar.theme')}>{theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}</button>
          <button className="cg-lang-btn" onClick={toggleLang} title={t('toolbar.lang')}
            aria-label={t('toolbar.lang')}><span className="cg-lang-label">{lang === 'zh' ? '中' : 'EN'}</span></button>
          <div className="cg-export-menu" ref={exportMenuRef}>
            <button className="cg-export-btn" onClick={() => setShowExportMenu((v) => !v)} title={t('toolbar.export')}
              aria-label={t('toolbar.export')} aria-haspopup="menu" aria-expanded={showExportMenu}><DownloadIcon size={15} /></button>
            {showExportMenu && (
              <div className="cg-export-dropdown" role="menu">
                <button onClick={() => handleExport('png')} role="menuitem">{t('export.png')}</button>
                <button onClick={() => handleExport('svg')} role="menuitem">{t('export.svg')}</button>
                <button onClick={() => handleExport('json')} role="menuitem">{t('export.json')}</button>
                <button onClick={() => handleExport('mermaid')} role="menuitem">{t('export.mermaid')}</button>
              </div>
            )}
          </div>
        </div>

        <button className="cg-collapse-btn" onClick={onCollapse} title={collapsed ? t('panel.expand') : t('panel.collapse')}
          aria-label={collapsed ? t('panel.expandPanel') : t('panel.collapsePanel')}>
          {collapsed ? <ChevronUpIcon size={15} /> : <ChevronDownIcon size={15} />}
        </button>
      </div>
    </div>
  );
});
