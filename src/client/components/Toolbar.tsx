import React, { useRef, useEffect, useCallback } from 'react';
import type { LayoutType, ThemeType, GraphType } from '../store/graphStore.ts';
import type { GraphNode } from '../../types/index.ts';
import type { WorkspaceSelectorProps } from './WorkspaceSelector.tsx';
import { useT, useLang, toggleLang } from '../i18n/index.ts';
import { WorkspaceSelector } from './WorkspaceSelector.tsx';
import {
  SearchIcon, ChainIcon, CycleIcon, MapIcon, RefreshIcon,
  SunIcon, MoonIcon, DownloadIcon, ChevronDownIcon, ChevronUpIcon,
  UploadIcon, LayersIcon,
} from './Icons.tsx';

const LAYOUTS: LayoutType[] = ['cose', 'dagre', 'circle', 'grid'];
const FILTER_KEYS: { value: string; key: string }[] = [
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

const DEPTH_LEVELS: { value: string; key: string }[] = [
  { value: 'all', key: 'depth.all' },
  { value: '1', key: 'depth.module' },
  { value: '2', key: 'depth.type' },
  { value: '3', key: 'depth.full' },
];

interface ToolbarProps extends WorkspaceSelectorProps {
  statsText: string;
  typeCounts: { function: number; class: number; interface: number };
  layout: LayoutType;
  theme: ThemeType;
  filterType: GraphNode['type'] | 'all';
  graphType: GraphType;
  depthLevel: 1 | 2 | 3 | 'all';
  showSearch: boolean;
  showCallChain: boolean;
  showCycles: boolean;
  showMiniMap: boolean;
  showLegend: boolean;
  showImport: boolean;
  collapsed: boolean;
  onLayoutChange: (l: LayoutType) => void;
  onThemeToggle: () => void;
  onFilterChange: (f: GraphNode['type'] | 'all') => void;
  onGraphTypeChange: (g: GraphType) => void;
  onDepthLevelChange: (level: 1 | 2 | 3 | 'all') => void;
  onToggleSearch: () => void;
  onToggleCallChain: () => void;
  onToggleCycles: () => void;
  onToggleMiniMap: () => void;
  onToggleLegend: () => void;
  onToggleImport: () => void;
  onRefresh: () => void;
  onExport: (format: 'png' | 'svg' | 'json') => void;
  onCollapse: () => void;
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

  const handleExport = useCallback((format: 'png' | 'svg' | 'json') => {
    props.onExport(format);
    setShowExportMenu(false);
  }, [props]);

  const {
    statsText, typeCounts, layout, theme, filterType, graphType, depthLevel,
    showSearch, showCallChain, showCycles, showMiniMap, showLegend, showImport, collapsed,
    onLayoutChange, onThemeToggle, onFilterChange, onGraphTypeChange, onDepthLevelChange,
    onToggleSearch, onToggleCallChain, onToggleCycles, onToggleMiniMap, onToggleLegend,
    onToggleImport, onRefresh, onCollapse,
    currentWorkspace, workspaceList, onSwitchWorkspace, onAddWorkspace, onRemoveWorkspace,
  } = props;

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
        <select
          value={String(depthLevel)}
          onChange={(e) => onDepthLevelChange(e.target.value as 1 | 2 | 3 | 'all')}
          className="depth-select"
          aria-label={t('toolbar.depth')}
          title={t('toolbar.depth')}
        >
          {DEPTH_LEVELS.map((opt) => (
            <option key={opt.value} value={opt.value}>{t(opt.key)}</option>
          ))}
        </select>
      </div>

      <div className="toolbar-right">
        <div className="toolbar-group" role="group" aria-label={t('toolbar.dataGroup')}>
          <button className="import-btn" onClick={onToggleImport} title={t('toolbar.import')}
            aria-label={t('toolbar.import')} aria-pressed={showImport}><UploadIcon size={15} /></button>
          <select value={filterType} onChange={(e) => onFilterChange(e.target.value as GraphNode['type'] | 'all')}
            className="filter-select" aria-label={t('toolbar.filter')}>
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
        </div>

        <span className="toolbar-separator" aria-hidden="true" />

        <div className="toolbar-group" role="group" aria-label={t('toolbar.viewGroup')}>
          <button className={`minimap-btn ${showMiniMap ? 'active' : ''}`} onClick={onToggleMiniMap}
            title={t('toolbar.minimap')} aria-label={t('toolbar.minimap')} aria-pressed={showMiniMap}><MapIcon size={15} /></button>
          <button className={`legend-btn ${showLegend ? 'active' : ''}`} onClick={onToggleLegend}
            title={t('toolbar.legend')} aria-label={t('toolbar.legend')} aria-pressed={showLegend}><LayersIcon size={15} /></button>
          <button className="refresh-btn" onClick={onRefresh} title={t('toolbar.refresh')}
            aria-label={t('toolbar.refresh')}><RefreshIcon size={15} /></button>
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
