import React, { memo, useCallback } from 'react';

import { useT } from '../../i18n/index.ts';
import { Dropdown } from '../Dropdown.tsx';
import {
  DownloadIcon, ChevronDownIcon, ChevronUpIcon, MoreIcon,
} from '../Icons.tsx';
import { EXPORT_FORMATS } from '../toolbarConfig.ts';
import type { ExportFormat } from '../toolbarTypes.ts';

interface ToolbarSettingsProps {
  hasData: boolean;
  collapsed: boolean;
  onExport: (format: ExportFormat) => void;
  onCollapse: () => void;
  moreDropdownItems: { key: string; titleKey: string; icon: React.ReactNode; active: boolean; onClick: () => void; role: 'menuitem' | 'menuitemcheckbox' }[];
}

export const ToolbarSettings = memo(function ToolbarSettings({
  hasData, collapsed, onExport, onCollapse, moreDropdownItems,
}: ToolbarSettingsProps) {
  const t = useT();
  const handleExport = useCallback((format: ExportFormat) => { onExport(format); }, [onExport]);

  return (
    <>
      <span className="cg-toolbar-separator" aria-hidden="true" />

      <div className="cg-toolbar-group" role="group" aria-label={t('toolbar.settingsGroup')}>
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
            // `cg-export-option-${value}` 是稳定寻址名：按钮文案随 i18n 变化，
            // E2E 与契约测试只能锚类名。
            <button key={value} className={`cg-export-option-${value}`}
              onClick={() => { handleExport(value); close(); }} role="menuitem">{t(key)}</button>
          ))}
        </Dropdown>
      </div>

      <Dropdown
        triggerClassName="cg-more-btn"
        triggerTitle={t('toolbar.more')}
        triggerAriaLabel={t('toolbar.more')}
        triggerAriaHasPopup="menu"
        triggerContent={<MoreIcon size={15} />}
        contentRole="menu"
      >
        {(close) => moreDropdownItems.map(({ key, titleKey, icon, active, onClick, role }) => (
          // `cg-more-${key}` 是稳定寻址名：菜单项文案随 i18n 变化，E2E 与契约测试只能锚类名。
          <button key={key} className={`cg-dropdown-item cg-more-${key} ${active ? 'cg-active' : ''}`} onClick={() => { onClick(); close(); }}
            role={role} aria-checked={role === 'menuitemcheckbox' ? active : undefined} title={t(titleKey)} aria-label={t(titleKey)}>
            {icon}<span>{t(titleKey)}</span>
          </button>
        ))}
      </Dropdown>

      <button className="cg-collapse-btn" onClick={onCollapse} title={collapsed ? t('panel.expand') : t('panel.collapse')}
        aria-label={collapsed ? t('panel.expandPanel') : t('panel.collapsePanel')}
        aria-expanded={!collapsed}>
        {collapsed ? <ChevronUpIcon size={15} /> : <ChevronDownIcon size={15} />}
      </button>
    </>
  );
});