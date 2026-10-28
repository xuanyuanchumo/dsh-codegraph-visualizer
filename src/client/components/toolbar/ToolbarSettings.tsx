import React, { memo, useCallback } from 'react';

import { useT } from '../../i18n/index.ts';
import { Dropdown } from '../Dropdown.tsx';
import {
  DownloadIcon, ChevronDownIcon, ChevronUpIcon, MoreIcon,
} from '../Icons.tsx';
import { EXPORT_FORMATS } from '../toolbarConfig.ts';
import type { ExportFormat } from '../toolbarTypes.ts';
import { hasMoreMenu, type MoreMenuSection } from './moreMenu.ts';

interface ToolbarSettingsProps {
  hasData: boolean;
  collapsed: boolean;
  onExport: (format: ExportFormat) => void;
  onCollapse: () => void;
  /**
   * 「更多」下拉的分段结构。
   *
   * 传进来的每一段都已保证非空（`buildMoreMenuSections` 先过滤条目再丢弃空段），
   * 组件因此只负责渲染，不需要再判断「这段要不要标题」——那是空段标题缺陷的入口。
   */
  moreSections: MoreMenuSection[];
}

export const ToolbarSettings = memo(function ToolbarSettings({
  hasData, collapsed, onExport, onCollapse, moreSections,
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

      {hasMoreMenu(moreSections) && (
        <Dropdown
          triggerClassName="cg-more-btn"
          triggerTitle={t('toolbar.more')}
          triggerAriaLabel={t('toolbar.more')}
          triggerAriaHasPopup="menu"
          triggerContent={<MoreIcon size={15} />}
          contentRole="menu"
        >
          {(close) => moreSections.map((section, sectionIdx) => (
            <React.Fragment key={section.labelKey}>
              {/* 分隔符按「第几个可见段」判定：段已在构造期过滤干净，故不会出现连续两个分隔符 */}
              {sectionIdx > 0 && <div className="cg-dropdown-separator" />}
              {/* `data-cg-more-section` 是段标题的稳定寻址名：文案随 i18n 变化 */}
              <div className="cg-dropdown-section-label" data-cg-more-section={section.labelKey}>
                {t(section.labelKey)}
              </div>
              {section.items.map(({ key, titleKey, icon, active, onClick, role }) => (
                // `cg-more-${key}` 是稳定寻址名：菜单项文案随 i18n 变化，E2E 与契约测试只能锚类名。
                <button key={key} className={`cg-dropdown-item cg-more-${key} ${active ? 'cg-active' : ''}`} onClick={() => { onClick(); close(); }}
                  role={role} aria-checked={role === 'menuitemcheckbox' ? active : undefined} title={t(titleKey)} aria-label={t(titleKey)}>
                  {icon}<span>{t(titleKey)}</span>
                </button>
              ))}
            </React.Fragment>
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