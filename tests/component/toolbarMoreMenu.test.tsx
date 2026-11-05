/**
 * @vitest-environment jsdom
 *
 * 「更多」下拉的分段契约 + 工具栏三档常驻（cycle-110 / T3）。
 *
 * 覆盖三件事：
 *   1. **常驻显示**：宽 / compact / narrow 三档都必须渲染工具栏本体与
 *      「导出 / 更多 / 折叠」这三个「面板离不开」的控件（窄到 480px 也不许被挤掉）。
 *   2. **溢出收纳**：窄档把独立搜索按钮收进「更多」，且它出现在**有标题的段**里。
 *   3. **不渲染空段标题**：段标题后面必须有条目（cycle-88 / cycle-104 的同族缺陷）。
 *
 * 第 3 条用「结构游标」判定，而不是「标题文案不在列表里」：
 * 只断言某个标题缺席，无法区分「段被正确丢弃」与「整个下拉没渲染」。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { Toolbar } from '../../src/client/components/Toolbar.tsx';
import type {
  PanelControls, ToolbarLayoutConfig, ToolbarViewConfig,
} from '../../src/client/components/toolbarTypes.ts';
import { buildMoreMenuSections, hasMoreMenu, pruneEmptySections } from '../../src/client/components/toolbar/moreMenu.ts';
import { UI } from '../../src/shared/constants.ts';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';
import { zh } from '../../src/client/i18n/dicts/zh.ts';
import { en } from '../../src/client/i18n/dicts/en.ts';
import type { ViewMode } from '../../src/types/index.ts';

/** 工具栏宽度由测量得来；jsdom 恒为 0，故与 Toolbar.test.tsx 同一套 mock。 */
const measuredWidth = vi.hoisted(() => ({ value: 0 }));
vi.mock('../../src/client/hooks/useElementWidth.ts', () => ({
  useElementWidth: () => [{ current: null }, measuredWidth.value] as const,
}));

const noop = vi.fn();

function makePanelControls(overrides: Partial<PanelControls> = {}): PanelControls {
  return {
    showSearch: false, showCallChain: false, showCycles: false, cycleIsolation: false,
    showImpact: false, showInheritance: false, showMiniMap: false, showLegend: false,
    showImport: false, showManage: false, showPathFind: false, showHealthScore: false, showRules: false,
    showHotspot: false, showGodModule: false, showCoreFunction: false, showDeadCode: false,
    showFilterPanel: false, showTour: false, showRuntime: false, showDiff: false,
    showKeywordQuery: false,
  showViews: false,
  showRegistry: false,
    onToggleSearch: noop, onToggleCallChain: noop, onToggleCycles: noop,
    onToggleCycleIsolation: noop, onToggleImpact: noop, onToggleInheritance: noop,
    onToggleMiniMap: noop, onToggleLegend: noop, onToggleImport: noop, onToggleManage: noop,
    onTogglePathFind: noop, onToggleHealthScore: noop, onToggleRules: noop,
    onToggleHotspot: noop, onToggleGodModule: noop, onToggleCoreFunction: noop,
    onToggleDeadCode: noop, onToggleFilterPanel: noop, onToggleTour: noop,
    onToggleRuntime: noop, onToggleDiff: noop, onToggleKeywordQuery: noop,
  // 璇玑图 ρ 路径模式面板（cycle-135）
  showPathPattern: false,
  onTogglePathPattern: noop,
  onToggleViews: noop,
  onToggleRegistry: noop,
    ...overrides,
  };
}

function makeProps(overrides: {
  viewMode?: ViewMode;
  panelControls?: PanelControls;
  onCollapseAll?: () => void;
} = {}) {
  const layoutConfig: ToolbarLayoutConfig = {
    layout: 'cose', dagreRankDir: 'TB', clusterDepth: 0, onChange: noop,
  };
  const viewConfig: ToolbarViewConfig = {
    viewMode: overrides.viewMode ?? 'code',
    graphType: 'all',
    filterType: 'all',
    currentLayer: 0,
    layerNames: [],
    hierarchyLevel: 3,
    onChange: noop,
  };
  return {
    statsText: '10 nodes',
    typeCounts: { function: 1, class: 1, interface: 0 },
    theme: 'light' as const,
    collapsed: false,
    hasData: true,
    hasGraphData: true,
    panelControls: overrides.panelControls ?? makePanelControls(),
    layoutConfig,
    viewConfig,
    onThemeToggle: noop,
    onRefresh: noop,
    onExport: noop,
    onCollapse: noop,
    onCollapseAll: overrides.onCollapseAll ?? noop,
    currentWorkspace: '.',
    workspaceList: [{ path: '.', name: 'root' }] as never,
    onSwitchWorkspace: noop,
    onAddWorkspace: noop,
    onRemoveWorkspace: noop,
  };
}

const WIDE = UI.TOOLBAR_BREAKPOINT_COMPACT_PX + 120;
const COMPACT = UI.TOOLBAR_BREAKPOINT_COMPACT_PX - 1;
const NARROW = UI.TOOLBAR_BREAKPOINT_NARROW_PX - 1;

const q = (selector: string) => document.querySelector(selector) as HTMLElement | null;

/**
 * 检查「每一个段标题后面都有条目」。
 *
 * 结构游标判定：遍历菜单内的直接子元素，遇到段标题就要求在下一次遇到
 * 段标题/分隔符/末尾之前出现过至少一个 `.cg-dropdown-item`。
 */
function emptySectionLabels(menuSelector: string): string[] {
  const menu = q(menuSelector);
  if (!menu) return ['<menu missing>'];
  const empties: string[] = [];
  let currentLabel: string | null = null;
  let itemsAfterLabel = 0;
  const flush = () => {
    if (currentLabel !== null && itemsAfterLabel === 0) empties.push(currentLabel);
    currentLabel = null;
    itemsAfterLabel = 0;
  };
  for (const child of Array.from(menu.children)) {
    const el = child as HTMLElement;
    if (el.classList.contains('cg-dropdown-section-label')) {
      flush();
      currentLabel = el.textContent ?? '';
      continue;
    }
    if (el.classList.contains('cg-dropdown-separator')) continue;
    if (el.classList.contains('cg-dropdown-item')) itemsAfterLabel += 1;
  }
  flush();
  return empties;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  resetI18nListeners();
  setLang('zh');
  measuredWidth.value = 0;
});

describe('buildMoreMenuSections（纯构造函数）', () => {
  const icons = { search: null, minimap: null, legend: null, theme: null, tour: null };
  const base = {
    isNarrow: false, searchAvailable: true,
    showSearch: false, onToggleSearch: noop,
    showMiniMap: false, onToggleMiniMap: noop,
    showLegend: false, onToggleLegend: noop,
    themeIsDark: false, onThemeToggle: noop, onToggleLang: noop,
    showTour: false, onToggleTour: noop,
    icons,
  };

  it('always yields the three fixed sections in the documented order', () => {
    const sections = buildMoreMenuSections({ ...base, onCollapseAll: noop });
    expect(sections.map((s) => s.labelKey)).toEqual([
      'toolbar.moreOverlaySection', 'toolbar.moreAppearanceSection', 'toolbar.moreSessionSection',
    ]);
  });

  it('keeps search out of the menu on wide/compact (it has its own button there)', () => {
    const wide = buildMoreMenuSections({ ...base, isNarrow: false, onCollapseAll: noop });
    expect(wide.flatMap((s) => s.items.map((i) => i.key))).not.toContain('search');
  });

  it('moves search into the overlay section on narrow', () => {
    const narrow = buildMoreMenuSections({ ...base, isNarrow: true, onCollapseAll: noop });
    const overlay = narrow.find((s) => s.labelKey === 'toolbar.moreOverlaySection');
    expect(overlay?.items.map((i) => i.key)).toContain('search');
  });

  it('drops a section whose items were all filtered out (no empty heading)', () => {
    // 直接测过滤器：用 `buildMoreMenuSections` 的输入构造不出空段（叠加段永远有
    // 小地图/图例），绕道验证只会写成一条恒真断言。
    const item = { key: 'k', titleKey: 'toolbar.search', icon: null, active: false, onClick: noop, role: 'menuitemcheckbox' as const };
    const pruned = pruneEmptySections([
      { labelKey: 'empty', items: [] },
      { labelKey: 'falsy', items: [false, null, undefined] },
      { labelKey: 'kept', items: [null, item] },
    ]);
    expect(pruned.map((s) => s.labelKey)).toEqual(['kept']);
    expect(pruned[0]!.items).toHaveLength(1);
    // 反证：同一批输入里没有空段残留，且非空段被保留
    for (const section of pruned) expect(section.items.length).toBeGreaterThan(0);
  });

  it('every section returned by the builder is non-empty (matrix over tiers and layers)', () => {
    for (const isNarrow of [true, false]) {
      for (const searchAvailable of [true, false]) {
        for (const onCollapseAll of [noop, undefined]) {
          const sections = buildMoreMenuSections({ ...base, isNarrow, searchAvailable, onCollapseAll });
          expect(hasMoreMenu(sections)).toBe(true);
          for (const section of sections) {
            expect(section.items.length, `${section.labelKey} 为空段`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('hides the collapse-all entry when the host supplies no handler', () => {
    const withHandler = buildMoreMenuSections({ ...base, onCollapseAll: noop });
    const without = buildMoreMenuSections({ ...base, onCollapseAll: undefined });
    const keys = (sections: ReturnType<typeof buildMoreMenuSections>) => sections.flatMap((s) => s.items.map((i) => i.key));
    expect(keys(withHandler)).toContain('collapseAll');
    expect(keys(without)).not.toContain('collapseAll');
  });

  it('uses only i18n keys that exist in both dictionaries', () => {
    const sections = buildMoreMenuSections({ ...base, isNarrow: true, onCollapseAll: noop });
    const keys = [...sections.map((s) => s.labelKey), ...sections.flatMap((s) => s.items.map((i) => i.titleKey))];
    // 含 collapseAll（来自 detail.* 命名空间）与三个新段标题
    expect(keys).toContain('detail.collapse');
    for (const key of keys) {
      expect(zh[key], `${key} 缺 zh 词条`).toBeTruthy();
      expect(en[key], `${key} 缺 en 词条`).toBeTruthy();
    }
  });
});

describe('Toolbar 三档常驻显示 + 溢出收纳', () => {
  const tiers = [
    { name: 'wide', width: WIDE, compact: false, narrow: false },
    { name: 'compact', width: COMPACT, compact: true, narrow: false },
    { name: 'narrow', width: NARROW, compact: true, narrow: true },
  ] as const;

  for (const tier of tiers) {
    it(`keeps the toolbar and its escape hatches visible in the ${tier.name} tier`, () => {
      measuredWidth.value = tier.width;
      render(<Toolbar {...makeProps()} />);

      const toolbar = q('.cg-graph-toolbar');
      expect(toolbar).not.toBeNull();
      expect(toolbar!.hasAttribute('data-cg-compact')).toBe(tier.compact);
      expect(toolbar!.hasAttribute('data-cg-narrow')).toBe(tier.narrow);

      // 「面板离不开」的三个控件在任何档位都必须在
      expect(q('.cg-export-btn')).not.toBeNull();
      expect(q('.cg-more-btn')).not.toBeNull();
      expect(q('.cg-collapse-btn')).not.toBeNull();
      // 常驻 ≠ 隐藏：工具栏本身不能带内联 display:none（样式表可以按档位改布局）
      expect(toolbar!.style.display).not.toBe('none');
    });
  }

  it('narrow tier folds the standalone search button into the More menu', async () => {
    measuredWidth.value = NARROW;
    const user = userEvent.setup();
    render(<Toolbar {...makeProps()} />);

    expect(q('.cg-search-standalone-btn')).toBeNull();

    await user.click(q('.cg-more-btn') as HTMLButtonElement);
    expect(q('.cg-more-search')).not.toBeNull();
    // 它必须在有标题的段里（「叠加视图」），而不是裸露在菜单顶部
    const section = q('[data-cg-more-section="toolbar.moreOverlaySection"]');
    expect(section).not.toBeNull();
    expect(section!.textContent).toBe(zh['toolbar.moreOverlaySection']);
  });

  it('never renders a section heading without items in any view layer', async () => {
    const user = userEvent.setup();
    for (const viewMode of ['code', 'callgraph', 'runtime'] as ViewMode[]) {
      measuredWidth.value = WIDE;
      render(<Toolbar {...makeProps({ viewMode })} />);

      await user.click(q('.cg-more-btn') as HTMLButtonElement);
      // cg-dropdown-menu 是「更多」下拉的容器类（ToolbarSettings 用缺省 containerClassName）
      expect(emptySectionLabels('.cg-dropdown-menu')).toEqual([]);

      // 工具下拉同样要干净（cycle-88 修过一次的同族缺陷）
      await user.click(q('.cg-tools-dropdown-btn') as HTMLButtonElement);
      expect(emptySectionLabels('.cg-dropdown-content')).toEqual([]);

      cleanup();
    }
  });

  it('reports an empty menu honestly instead of opening a blank panel', () => {
    // 反证用例（供 hasMoreMenu 使用）：全空结构必须被判成「没有菜单」，
    // 否则组件会渲染一个点开却空白的触发器。
    expect(hasMoreMenu([])).toBe(false);
    expect(hasMoreMenu([{ labelKey: 'x', items: [] }])).toBe(false);
    expect(hasMoreMenu([{ labelKey: 'x', items: [{ key: 'k', titleKey: 'x', icon: null, active: false, onClick: noop, role: 'menuitem' }] }])).toBe(true);
  });
});
