import React, { memo, useCallback } from 'react';
import type { LayoutType, GraphType, RankDir } from '../../store/graphStore.ts';
import type { ViewMode } from '../../../types/index.ts';
import { useT } from '../../i18n/index.ts';
import { Dropdown } from '../Dropdown.tsx';
import { STRUCTURAL_VIEW_MODES, BEHAVIORAL_VIEW_MODES, BEHAVIORAL_MICRO_VIEW_MODES } from '../../../shared/viewModeUtils.ts';
import { ChevronDownIcon } from '../Icons.tsx';
import {
  LAYOUTS, RANK_DIRS, GRAPH_TYPES,
  STRUCTURAL_MODE_KEYS, BEHAVIORAL_MODE_KEYS, BEHAVIORAL_MICRO_MODE_KEYS,
  STRUCTURAL_TITLE_KEYS, BEHAVIORAL_TITLE_KEYS, BEHAVIORAL_MICRO_TITLE_KEYS,
  CLUSTER_DEPTHS, HIERARCHY_LEVELS,
} from '../toolbarConfig.ts';
import type { ToolbarLayoutConfig, ToolbarViewConfig } from '../toolbarTypes.ts';

interface ToolbarViewModeProps {
  layoutConfig: ToolbarLayoutConfig;
  viewConfig: ToolbarViewConfig;
}

export const ToolbarViewMode = memo(function ToolbarViewMode({
  layoutConfig, viewConfig,
}: ToolbarViewModeProps) {
  const t = useT();

  const { layout, dagreRankDir, clusterDepth } = layoutConfig;
  const onLayoutChange = useCallback((l: LayoutType) => layoutConfig.onChange('layout', l), [layoutConfig]);
  const onDagreRankDirChange = useCallback((d: RankDir) => layoutConfig.onChange('dagreRankDir', d), [layoutConfig]);
  const onClusterDepthChange = useCallback((d: number) => layoutConfig.onChange('clusterDepth', d), [layoutConfig]);

  const { viewMode, graphType, currentLayer, layerNames, hierarchyLevel, hasSelectedFunction } = viewConfig;
  const onViewModeChange = useCallback((m: ViewMode) => viewConfig.onChange('viewMode', m), [viewConfig]);
  const onGraphTypeChange = useCallback((g: GraphType) => viewConfig.onChange('graphType', g), [viewConfig]);
  const onLayerChange = useCallback((l: number) => viewConfig.onChange('layer', l), [viewConfig]);
  const onHierarchyLevelChange = useCallback((l: number) => viewConfig.onChange('hierarchyLevel', l), [viewConfig]);

  return (
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
            {viewMode === 'code' && (
              <>
                <div className="cg-dropdown-separator" />
                <div className="cg-dropdown-section-label">{t('toolbar.cluster')}</div>
                {CLUSTER_DEPTHS.map((opt) => (
                  <button key={opt.value} className={`cg-dropdown-item ${clusterDepth === opt.value ? 'cg-active' : ''}`}
                    onClick={() => { onClusterDepthChange(opt.value); }}
                    aria-pressed={clusterDepth === opt.value} title={t(opt.key)}>
                    {t(opt.key)}
                  </button>
                ))}
              </>
            )}
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
    </div>
  );
});