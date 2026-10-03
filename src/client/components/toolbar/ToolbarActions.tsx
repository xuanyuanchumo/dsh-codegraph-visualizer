import React, { memo } from 'react';
import { useT } from '../../i18n/index.ts';
import { Dropdown } from '../Dropdown.tsx';
import { getAvailablePanels, getViewLayer } from '../../../shared/viewModeUtils.ts';
import {
  SearchIcon, MapIcon, RefreshIcon, FilterIcon,
  UploadIcon, ZapIcon, ChevronDownIcon,
  UndoIcon, RedoIcon, StarIcon,
} from '../Icons.tsx';
import {
  PANEL_DROPDOWN_SECTIONS,
} from '../toolbarConfig.ts';
import type { PanelControls, ToolbarHistory } from '../toolbarTypes.ts';
import type { ViewMode } from '../../../types/index.ts';

interface ToolbarActionsProps {
  panelControls: PanelControls;
  history?: ToolbarHistory | undefined;
  onRefresh: () => void;
  isCompact: boolean;
  isNarrow: boolean;
  viewMode: ViewMode;
}

export const ToolbarActions = memo(function ToolbarActions({
  panelControls, history, onRefresh, isCompact, isNarrow, viewMode,
}: ToolbarActionsProps) {
  const t = useT();

  const {
    showSearch, showCycles, cycleIsolation, showMiniMap, showLegend, showImport,
    showFilterPanel, showTour,
    onToggleSearch, onToggleCycleIsolation, onToggleMiniMap, onToggleLegend,
    onToggleImport, onToggleFilterPanel, onToggleTour,
  } = panelControls;

  const availablePanels = getAvailablePanels(getViewLayer(viewMode));


  const onUndo = history?.undo;
  const onRedo = history?.redo;
  const canUndo = history?.canUndo;
  const canRedo = history?.canRedo;

  return (
    <>
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
            title={t('toolbar.legend')} aria-label={t('toolbar.legend')} aria-pressed={showLegend}><FilterIcon size={15} /></button>
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
    </>
  );
});