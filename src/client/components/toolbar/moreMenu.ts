import type React from 'react';

/**
 * 「更多」下拉的菜单结构（cycle-110 / T3）。
 *
 * ## 为什么要有这一层纯函数
 *
 * 工具栏的溢出收纳是**分层**的：宽档把全部控件平铺，窄档把装不下的控件收进「更多」。
 * 改动前「更多」是一个扁平数组，用户看到 7 个并列项，分不清哪些是叠加视图（小地图、
 * 图例）、哪些是外观（主题、语言）、哪些是有副作用的操作（收起全部）。
 *
 * 但加段标题会踩到本仓库已经踩过两次的坑（`CLAUDE.md`「空段标题」条）：
 * **先渲染段标题、再过滤段内条目**，一旦整段被过滤光，界面就剩下一个点不动的空标题。
 * 段标题的位置还由「这是第几个**可见**段」决定，用原始索引会得到连续两个分隔符。
 *
 * 因此「构造 + 过滤 + 丢弃空段」放在这个无副作用的函数里，组件只负责渲染结果：
 * 组件拿到的每一段都保证 `items.length > 0`，想再渲染出空标题在结构上就不可能。
 */

/** 一个菜单项：`titleKey` 走 `t()`，`className` 是稳定寻址名（E2E/契约测试只锚类名）。 */
export interface MoreMenuItem {
  key: string;
  titleKey: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  role: 'menuitem' | 'menuitemcheckbox';
}

/** 一段菜单：标题 + 至少一个条目（构造器保证非空）。 */
export interface MoreMenuSection {
  labelKey: string;
  items: MoreMenuItem[];
}

/** 段的原始形状：允许空条目，构造器负责丢弃。 */
export interface RawSection {
  labelKey: string;
  items: Array<MoreMenuItem | null | undefined | false>;
}

/** 「更多」菜单的输入：全部来自工具栏已有的面板状态与回调。 */
export interface MoreMenuInput {
  isNarrow: boolean;
  /** 当前层是否提供搜索面板（`getAvailablePanels(layer).has('showSearch')`）。 */
  searchAvailable: boolean;
  showSearch: boolean;
  onToggleSearch: () => void;
  showMiniMap: boolean;
  onToggleMiniMap: () => void;
  showLegend: boolean;
  onToggleLegend: () => void;
  themeIsDark: boolean;
  onThemeToggle: () => void;
  onToggleLang: () => void;
  showTour: boolean;
  onToggleTour: () => void;
  /** 注册矩阵看板（cycle-117）：可选——测试与旧调用点未传时不出现在菜单（向后兼容）。 */
  showRegistry?: boolean;
  onToggleRegistry?: (() => void) | undefined;
  onCollapseAll?: (() => void) | undefined;
  /** 图标工厂：测试里可以传空实现，避免把 Icons.tsx 拖进纯函数测试。 */
  icons: {
    search: React.ReactNode;
    minimap: React.ReactNode;
    legend: React.ReactNode;
    theme: React.ReactNode;
    tour: React.ReactNode;
    registry?: React.ReactNode;
  };
}

/**
 * 构造「更多」下拉的分段结构。
 *
 * 三段固定顺序：叠加视图 → 外观与语言 → 会话操作。顺序即用户的心智模型
 * （「看得见什么」→「长什么样」→「对会话做什么」），不随窄档变化，
 * 否则同一个菜单在不同宽度下顺序不同，肌肉记忆失效。
 */
export function buildMoreMenuSections(input: MoreMenuInput): MoreMenuSection[] {
  const raw: RawSection[] = [
    {
      labelKey: 'toolbar.moreOverlaySection',
      items: [
        // 搜索在宽/紧凑档有独立按钮，只有窄档才收进「更多」；且只在当前层支持时才给。
        input.isNarrow && input.searchAvailable
          ? {
              key: 'search', titleKey: 'toolbar.search', icon: input.icons.search,
              active: input.showSearch, onClick: input.onToggleSearch, role: 'menuitemcheckbox',
            }
          : null,
        {
          key: 'minimap', titleKey: 'toolbar.minimap', icon: input.icons.minimap,
          active: input.showMiniMap, onClick: input.onToggleMiniMap, role: 'menuitemcheckbox',
        },
        {
          key: 'legend', titleKey: 'toolbar.legend', icon: input.icons.legend,
          active: input.showLegend, onClick: input.onToggleLegend, role: 'menuitemcheckbox',
        },
      ],
    },
    {
      labelKey: 'toolbar.moreAppearanceSection',
      items: [
        {
          key: 'theme', titleKey: 'toolbar.theme', icon: input.icons.theme,
          active: false, onClick: input.onThemeToggle, role: 'menuitem',
        },
        { key: 'lang', titleKey: 'toolbar.lang', icon: null, active: false, onClick: input.onToggleLang, role: 'menuitem' },
      ],
    },
    {
      labelKey: 'toolbar.moreSessionSection',
      items: [
        input.onToggleRegistry
          ? {
              key: 'registry', titleKey: 'toolbar.registry', icon: input.icons.registry,
              active: input.showRegistry ?? false, onClick: input.onToggleRegistry, role: 'menuitemcheckbox',
            }
          : null,
        {
          key: 'tour', titleKey: 'toolbar.tour', icon: input.icons.tour,
          active: input.showTour, onClick: input.onToggleTour, role: 'menuitemcheckbox',
        },
        input.onCollapseAll
          ? { key: 'collapseAll', titleKey: 'detail.collapse', icon: null, active: false, onClick: input.onCollapseAll, role: 'menuitem' as const }
          : null,
      ],
    },
  ];

  // 先过滤条目，再丢弃空段 —— 顺序反过来就是「空段标题」缺陷的成因。
  return pruneEmptySections(raw);
}

/**
 * 过滤条目并丢弃空段。
 *
 * 单独导出是为了**能被直接测**：`buildMoreMenuSections` 的当前输入里叠加段永远有
 * 小地图/图例两项，构造不出空段，用它间接验证「空段会被丢弃」会写成一条永远为真的断言。
 * 这里直接喂空段，测的才是过滤器本身。
 */
export function pruneEmptySections(raw: readonly RawSection[]): MoreMenuSection[] {
  return raw
    .map((section) => ({
      labelKey: section.labelKey,
      items: section.items.filter((item): item is MoreMenuItem => Boolean(item)),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * 「更多」菜单是否为空。
 *
 * 允许空的菜单必须是**显式**的：取消「收起全部」回调、又在宽档（搜索不进菜单）时，
 * 只剩 minimap/legend/theme/lang/tour，永远不会为空。但一旦未来某档真的全空，
 * 触发器应当隐藏而不是打开一个空白面板——这个判据放在这里，组件只需 `if (!hasMoreMenu(sections)) return null`。
 */
export function hasMoreMenu(sections: readonly MoreMenuSection[]): boolean {
  return sections.some((section) => section.items.length > 0);
}
