import React, { useRef, useEffect, useCallback } from 'react';
import type { LayoutType, ThemeType, GraphType, ClusterLevel } from '../store/graphStore.ts';
import type { GraphNode, ViewMode } from '../../types/index.ts';
import type { WorkspaceSelectorProps } from './WorkspaceSelector.tsx';
import { useT, useLang, toggleLang } from '../i18n/index.ts';
import { WorkspaceSelector } from './WorkspaceSelector.tsx';
import {
  SearchIcon, ChainIcon, CycleIcon, MapIcon, RefreshIcon,
  SunIcon, MoonIcon, DownloadIcon, ChevronDownIcon, ChevronUpIcon,
  UploadIcon, LayersIcon, ZapIcon, TreeIcon,
  PathIcon, HeartIcon, RuleIcon, FlameIcon, AlertCircleIcon,
  UndoIcon, RedoIcon,
} from './Icons.tsx';

const LAYOUTS: LayoutType[] = ['cose', 'dagre', 'circle', 'grid', 'radial', 'tree'];
const FILTER_KEYS: { value: GraphNode['type'] | 'all'; key: string }[] = [
  { value: 'all', key: 'filter.all' },
  { value: 'function', key: 'filter.function' },
  { value: 'class', key: 'filter.class' },
  { value: 'variable', key: 'filter.variable' },
  { value: 'module', key: 'filter.module' },
  { value: 'interface', key: 'filter.interface' },
];

const GRAPH_TYPES: { value: GraphType; key: string }[] = [
  { value: 'all', key: 'graphType.all' },
  { value: 'call', key: 'graphType.call' },
  { value: 'dependency', key: 'graphType.dependency' },
];

const MACRO_VIEW_MODES: { value: ViewMode; key: string }[] = [
  { value: 'code', key: 'viewMode.code' },
  { value: 'dependencies', key: 'viewMode.dependencies' },
  { value: 'inheritance', key: 'viewMode.inheritance' },
  { value: 'callgraph', key: 'viewMode.callgraph' },
  { value: 'package', key: 'viewMode.package' },
  { value: 'class', key: 'viewMode.class' },
];

const MICRO_VIEW_MODES: { value: ViewMode; key: string }[] = [
  { value: 'cfg', key: 'viewMode.cfg' },
  { value: 'flowchart', key: 'viewMode.flowchart' },
  { value: 'sequence', key: 'viewMode.sequence' },
];

const CLUSTER_LEVELS: { value: ClusterLevel; key: string }[] = [
  { value: 'progressive', key: 'cluster.progressive' },
  { value: 'directory', key: 'cluster.directory' },
  { value: 'file', key: 'cluster.file' },
  { value: 'function', key: 'cluster.function' },
  { value: 'smart', key: 'cluster.smart' },
];

export interface ToolbarVisibilityState {
  showSearch: boolean;
  showCallChain: boolean;
  showCycles: boolean;
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
}

export interface ToolbarToggleHandlers {
  onToggleSearch: () => void;
  onToggleCallChain: () => void;
  onToggleCycles: () => void;
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
}

export interface PanelControls extends ToolbarVisibilityState, ToolbarToggleHandlers {}

interface ToolbarProps extends WorkspaceSelectorProps {
  statsText: string;
  typeCounts: { function: number; class: number; interface: number };
  layout: LayoutType;
  theme: ThemeType;
  filterType: GraphNode['type'] | 'all';
  graphType: GraphType;
  clusterLevel: ClusterLevel;
  viewMode: ViewMode;
  currentLayer: number;
  layerNames: string[];
  collapsed: boolean;
  panelControls: PanelControls;
  onLayoutChange: (l: LayoutType) => void;
  onThemeToggle: () => void;
  onFilterChange: (f: GraphNode['type'] | 'all') => void;
  onGraphTypeChange: (g: GraphType) => void;
  onClusterLevelChange: (level: ClusterLevel) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onLayerChange: (layer: number) => void;
  onRefresh: () => void;
  onExport: (format: 'png' | 'svg' | 'json') => void;
  onCollapse: () => void;
  onCollapseAll?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export function Toolbar(props: ToolbarProps) {
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
  const handleExport = useCallback((format: 'png' | 'svg' | 'json') => {
    onExport(format);
    setShowExportMenu(false);
  }, [onExport]);

  const {
    statsText, typeCounts, layout, theme, filterType, graphType, clusterLevel,
    viewMode, currentLayer, layerNames, collapsed, panelControls,
    onLayoutChange, onThemeToggle, onFilterChange, onGraphTypeChange, onClusterLevelChange,
    onViewModeChange, onLayerChange,
    onRefresh, onCollapse,
    currentWorkspace, workspaceList, onSwitchWorkspace, onAddWorkspace, onRemoveWorkspace,
    onCollapseAll, onUndo, onRedo, canUndo, canRedo,
  } = props;

  const {
    showSearch, showCallChain, showCycles, showImpact, showInheritance, showMiniMap, showLegend, showImport,
    showPathFind, showHealthScore, showRules, showHotspot, showGodModule,
    onToggleSearch, onToggleCallChain, onToggleCycles, onToggleImpact, onToggleInheritance, onToggleMiniMap, onToggleLegend,
    onToggleImport, onTogglePathFind, onToggleHealthScore, onToggleRules, onToggleHotspot, onToggleGodModule,
  } = panelControls;

  return (
    <div className="graph-toolbar">
      <div className="toolbar-left">
        <WorkspaceSelector
          currentWorkspace={currentWorkspace}
          workspaceList={workspaceList}
          onSwitchWorkspace={onSwitchWorkspace}
          onAddWorkspace={onAddWorkspace}
          onRemoveWorkspace={onRemoveWorkspace}
        />
        <span className="node-count">{statsText}</span>
        {typeCounts.function > 0 && <span className="type-badge function">fn:{typeCounts.function}</span>}
        {typeCounts.class > 0 && <span className="type-badge class">cls:{typeCounts.class}</span>}
        {typeCounts.interface > 0 && <span className="type-badge interface">if:{typeCounts.interface}</span>}
        {onCollapseAll && <button className="collapse-all-btn" onClick={onCollapseAll} title={t('detail.collapse')}>{t('detail.collapse')}</button>}
      </div>

      <div className="toolbar-center">
        <div className="layout-buttons" role="group" aria-label="Layout switcher">
          {LAYOUTS.map((l) => (
            <button
              key={l}
              className={`layout-btn ${layout === l ? 'active' : ''}`}
              onClick={() => onLayoutChange(l)}
              title={t('toolbar.layout', { l })}
              aria-pressed={layout === l}
            >{l}</button>
          ))}
        </div>
        <div className="graph-type-buttons" role="group" aria-label={t('toolbar.graphType')}>
          {GRAPH_TYPES.map((g) => (
            <button
              key={g.value}
              className={`graph-type-btn ${graphType === g.value ? 'active' : ''}`}
              onClick={() => onGraphTypeChange(g.value)}
              title={t(g.key)}
              aria-pressed={graphType === g.value}
            >{t(g.key)}</button>
          ))}
        </div>
        <div className="view-mode-buttons" role="group" aria-label={t('toolbar.graphType')}>
          {MACRO_VIEW_MODES.map((m) => (
            <button
              key={m.value}
              className={`view-mode-btn ${viewMode === m.value ? 'active' : ''}`}
              onClick={() => onViewModeChange(m.value)}
              title={t(`toolbar.viewMode${m.value.charAt(0).toUpperCase() + m.value.slice(1)}`)}
              aria-pressed={viewMode === m.value}
            >{t(m.key)}</button>
          ))}
          <span className="view-mode-divider" aria-hidden="true" />
          {MICRO_VIEW_MODES.map((m) => (
            <button
              key={m.value}
              className={`view-mode-btn view-mode-btn--micro ${viewMode === m.value ? 'active' : ''}`}
              onClick={() => onViewModeChange(m.value)}
              title={t(`toolbar.viewMode${m.value.charAt(0).toUpperCase() + m.value.slice(1)}`)}
              aria-pressed={viewMode === m.value}
            >{t(m.key)}</button>
          ))}
        </div>
        {layerNames.length > 1 && (
          <div className="layer-selector" role="group" aria-label={t('toolbar.layer')}>
            {layerNames.map((name, idx) => (
              <button
                key={idx}
                className={`layer-btn ${currentLayer === idx ? 'active' : ''}`}
                onClick={() => onLayerChange(idx)}
                title={name}
                aria-pressed={currentLayer === idx}
              >{name.length <= 4 ? name : name.slice(0, 3)}</button>
            ))}
          </div>
        )}
        <select
          value={clusterLevel}
          onChange={(e) => onClusterLevelChange(e.target.value as ClusterLevel)}
          className="depth-select"
          id="cluster-level"
          name="cluster-level"

          aria-label={t('toolbar.cluster')}
          title={t('toolbar.cluster')}
        >
          {CLUSTER_LEVELS.map((opt) => (
            <option key={opt.value} value={opt.value}>{t(opt.key)}</option>
          ))}
        </select>
      </div>

      <div className="toolbar-right">
        <div className="toolbar-group" role="group" aria-label={t('toolbar.dataGroup')}>
          <button className="import-btn" onClick={onToggleImport} title={t('toolbar.import')}
            aria-label={t('toolbar.import')} aria-pressed={showImport}><UploadIcon size={15} /></button>
          <select value={filterType} onChange={(e) => onFilterChange(e.target.value as GraphNode['type'] | 'all')}
            className="filter-select" id="filter-type" name="filter-type" aria-label={t('toolbar.filter')}>
            {FILTER_KEYS.map((opt) => (
              <option key={opt.value} value={opt.value}>{t(opt.key)}</option>
            ))}
          </select>
        </div>

        <span className="toolbar-separator" aria-hidden="true" />

        <div className="toolbar-group" role="group" aria-label={t('toolbar.analysisGroup')}>
          <button className={`search-btn ${showSearch ? 'active' : ''}`} onClick={onToggleSearch}
            title={t('toolbar.search')} aria-label={t('toolbar.search')} aria-expanded={showSearch}><SearchIcon size={15} /></button>
          <button className={`chain-btn ${showCallChain ? 'active' : ''}`} onClick={onToggleCallChain}
            title={t('toolbar.chain')} aria-label={t('toolbar.chain')} aria-pressed={showCallChain}><ChainIcon size={15} /></button>
          <button className={`cycle-btn ${showCycles ? 'active' : ''}`} onClick={onToggleCycles}
            title={t('toolbar.cycles')} aria-label={t('toolbar.cycles')} aria-pressed={showCycles}><CycleIcon size={15} /></button>
          <button className={`impact-btn ${showImpact ? 'active' : ''}`} onClick={onToggleImpact}
            title={t('toolbar.impact')} aria-label={t('toolbar.impact')} aria-pressed={showImpact}><ZapIcon size={15} /></button>
          <button className={`inheritance-btn ${showInheritance ? 'active' : ''}`} onClick={onToggleInheritance}
            title={t('toolbar.inheritance')} aria-label={t('toolbar.inheritance')} aria-pressed={showInheritance}><TreeIcon size={15} /></button>
          <button className={`pathfind-btn ${showPathFind ? 'active' : ''}`} onClick={onTogglePathFind}
            title={t('toolbar.pathFind')} aria-label={t('toolbar.pathFind')} aria-pressed={showPathFind}><PathIcon size={15} /></button>
          <button className={`health-btn ${showHealthScore ? 'active' : ''}`} onClick={onToggleHealthScore}
            title={t('toolbar.health')} aria-label={t('toolbar.health')} aria-pressed={showHealthScore}><HeartIcon size={15} /></button>
          <button className={`rules-btn ${showRules ? 'active' : ''}`} onClick={onToggleRules}
            title={t('toolbar.rules')} aria-label={t('toolbar.rules')} aria-pressed={showRules}><RuleIcon size={15} /></button>
          <button className={`hotspot-btn ${showHotspot ? 'active' : ''}`} onClick={onToggleHotspot}
            title={t('toolbar.hotspot')} aria-label={t('toolbar.hotspot')} aria-pressed={showHotspot}><FlameIcon size={15} /></button>
          <button className={`godmodule-btn ${showGodModule ? 'active' : ''}`} onClick={onToggleGodModule}
            title={t('toolbar.godModule')} aria-label={t('toolbar.godModule')} aria-pressed={showGodModule}><AlertCircleIcon size={15} /></button>
        </div>

        <span className="toolbar-separator" aria-hidden="true" />

        <div className="toolbar-group" role="group" aria-label={t('toolbar.viewGroup')}>
          <button className={`minimap-btn ${showMiniMap ? 'active' : ''}`} onClick={onToggleMiniMap}
            title={t('toolbar.minimap')} aria-label={t('toolbar.minimap')} aria-pressed={showMiniMap}><MapIcon size={15} /></button>
          <button className={`legend-btn ${showLegend ? 'active' : ''}`} onClick={onToggleLegend}
            title={t('toolbar.legend')} aria-label={t('toolbar.legend')} aria-pressed={showLegend}><LayersIcon size={15} /></button>
          <button className="refresh-btn" onClick={onRefresh} title={t('toolbar.refresh')}
            aria-label={t('toolbar.refresh')}><RefreshIcon size={15} /></button>
          {onUndo && (
            <button className="undo-btn" onClick={onUndo} disabled={!canUndo} title={t('toolbar.undo')}
              aria-label={t('toolbar.undo')} aria-disabled={!canUndo}><UndoIcon size={15} /></button>
          )}
          {onRedo && (
            <button className="redo-btn" onClick={onRedo} disabled={!canRedo} title={t('toolbar.redo')}
              aria-label={t('toolbar.redo')} aria-disabled={!canRedo}><RedoIcon size={15} /></button>
          )}
        </div>

        <span className="toolbar-separator" aria-hidden="true" />

        <div className="toolbar-group" role="group" aria-label={t('toolbar.settingsGroup')}>
          <button className="theme-btn" onClick={onThemeToggle} title={t('toolbar.theme')}
            aria-label={t('toolbar.theme')}>{theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}</button>
          <button className="lang-btn" onClick={toggleLang} title={t('toolbar.lang')}
            aria-label={t('toolbar.lang')}><span className="lang-label">{lang === 'zh' ? '中' : 'EN'}</span></button>
          <div className="export-menu" ref={exportMenuRef}>
            <button className="export-btn" onClick={() => setShowExportMenu((v) => !v)} title={t('toolbar.export')}
              aria-label={t('toolbar.export')} aria-haspopup="menu" aria-expanded={showExportMenu}><DownloadIcon size={15} /></button>
            {showExportMenu && (
              <div className="export-dropdown" role="menu">
                <button onClick={() => handleExport('png')} role="menuitem">{t('export.png')}</button>
                <button onClick={() => handleExport('svg')} role="menuitem">{t('export.svg')}</button>
                <button onClick={() => handleExport('json')} role="menuitem">{t('export.json')}</button>
              </div>
            )}
          </div>
        </div>

        <button className="collapse-btn" onClick={onCollapse} title={collapsed ? t('panel.expand') : t('panel.collapse')}
          aria-label={collapsed ? t('panel.expandPanel') : t('panel.collapsePanel')}>
          {collapsed ? <ChevronUpIcon size={15} /> : <ChevronDownIcon size={15} />}
        </button>
      </div>
    </div>
  );
}
