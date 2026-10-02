import React, { memo, useCallback } from 'react';
import type { ThemeType } from '../../store/graphStore.ts';
import { useT, useLang, toggleLang } from '../../i18n/index.ts';
import { Dropdown } from '../Dropdown.tsx';
import {
  SunIcon, MoonIcon, DownloadIcon, ChevronDownIcon, ChevronUpIcon, MoreIcon,
} from '../Icons.tsx';
import { EXPORT_FORMATS } from '../toolbarConfig.ts';
import type { ExportFormat } from '../toolbarTypes.ts';

interface ToolbarSettingsProps {
  theme: ThemeType;
  hasData: boolean;
  collapsed: boolean;
  onThemeToggle: () => void;
  onExport: (format: ExportFormat) => void;
  onCollapse: () => void;
  isCompact: boolean;
  moreDropdownItems: { key: string; titleKey: string; icon: React.ReactNode; active: boolean; onClick: () => void; role: 'menuitem' | 'menuitemcheckbox' }[];
}

export const ToolbarSettings = memo(function ToolbarSettings({
  theme, hasData, collapsed, onThemeToggle, onExport, onCollapse, isCompact, moreDropdownItems,
}: ToolbarSettingsProps) {
  const t = useT();
  const lang = useLang();
  const handleExport = useCallback((format: ExportFormat) => { onExport(format); }, [onExport]);

  return (
    <>
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
    </>
  );
});