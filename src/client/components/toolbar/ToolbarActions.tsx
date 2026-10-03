import React, { memo } from 'react';
import { useT } from '../../i18n/index.ts';
import { Dropdown } from '../Dropdown.tsx';
import { getAvailablePanels, getViewLayer } from '../../../shared/viewModeUtils.ts';
import {
  SearchIcon, RefreshIcon, FilterIcon,
  UploadIcon, ZapIcon, ChevronDownIcon,
  UndoIcon, RedoIcon,
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
  panelControls, history, onRefresh, isCompact: _isCompact, isNarrow, viewMode,
}: ToolbarActionsProps) {
  const t = useT();

  const {
    showSearch, showCycles, cycleIsolation,
    showImport, showFilterPanel,
    onToggleSearch, onToggleCycleIsolation,
    onToggleImport, onToggleFilterPanel,
  } = panelControls;

  const availablePanels = getAvailablePanels(getViewLayer(viewMode));

  const onUndo = history?.undo;
  const onRedo = history?.redo;
  const canUndo = history?.canUndo;
  const canRedo = history?.canRedo;

  return (
    <>
      <div className="cg-toolbar-group" role="group" aria-label={t('toolbar.dataGroup')}>
        <Dropdown
          triggerClassName="cg-data-dropdown-btn"
          triggerTitle={t('toolbar.data')}
          triggerAriaLabel={t('toolbar.data')}
          triggerAriaHasPopup="menu"
          triggerContent={<><UploadIcon size={15} /><ChevronDownIcon size={10} /></>}
          contentRole="menu"
        >
          {(close) => (
            <>
              <button className={`cg-dropdown-item cg-import-btn ${showImport ? 'cg-active' : ''}`}
                onClick={() => { onToggleImport(); close(); }}
                role="menuitemcheckbox" aria-checked={showImport} title={t('toolbar.import')}>
                <UploadIcon size={14} /><span>{t('toolbar.import')}</span>
              </button>
              <button className={`cg-dropdown-item cg-filter-panel-btn ${showFilterPanel ? 'cg-active' : ''}`}
                onClick={() => { onToggleFilterPanel(); close(); }}
                role="menuitemcheckbox" aria-checked={showFilterPanel} title={t('toolbar.filterPanel')}>
                <FilterIcon size={14} /><span>{t('toolbar.filterPanel')}</span>
              </button>
            </>
          )}
        </Dropdown>
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
      </div>

      <span className="cg-toolbar-separator" aria-hidden="true" />

      <div className="cg-toolbar-group" role="group" aria-label={t('toolbar.viewGroup')}>
        <button className="cg-refresh-btn" onClick={onRefresh} title={t('toolbar.refresh')}
          aria-label={t('toolbar.refresh')}><RefreshIcon size={15} /></button>
        {(onUndo || onRedo) && (
          <Dropdown
            triggerClassName="cg-history-dropdown-btn"
            triggerTitle={t('toolbar.history')}
            triggerAriaLabel={t('toolbar.history')}
            triggerAriaHasPopup="menu"
            triggerContent={<><UndoIcon size={15} /><ChevronDownIcon size={10} /></>}
            contentRole="menu"
          >
            {(close) => (
              <>
                {onUndo && (
                  <button className="cg-dropdown-item cg-undo-btn" onClick={() => { onUndo(); close(); }}
                    disabled={!canUndo} role="menuitem" title={t('toolbar.undo')}
                    aria-label={t('toolbar.undo')} aria-disabled={!canUndo}>
                    <UndoIcon size={14} /><span>{t('toolbar.undo')}</span>
                  </button>
                )}
                {onRedo && (
                  <button className="cg-dropdown-item cg-redo-btn" onClick={() => { onRedo(); close(); }}
                    disabled={!canRedo} role="menuitem" title={t('toolbar.redo')}
                    aria-label={t('toolbar.redo')} aria-disabled={!canRedo}>
                    <RedoIcon size={14} /><span>{t('toolbar.redo')}</span>
                  </button>
                )}
              </>
            )}
          </Dropdown>
        )}
      </div>
    </>
  );
});