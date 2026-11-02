/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { Toolbar, type PanelControls, type ToolbarLayoutConfig, type ToolbarViewConfig, type ToolbarHistory } from '../../src/client/components/Toolbar.tsx';
import type { LayoutType, ThemeType, GraphType, RankDir } from '../../src/client/store/graphStore.ts';
import type { GraphNode, ViewMode } from '../../src/types/index.ts';
import type { WorkspaceInfo } from '../../src/client/store/graphStore.ts';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';
import { UI } from '../../src/shared/constants.ts';

/**
 * The toolbar's responsive tiers are driven by its *measured* width. jsdom can never
 * produce one (clientWidth is 0 and ResizeObserver does not exist), so before this mock
 * every tier assertion was impossible and the narrow branch had no coverage at all.
 * Default 0 means "not measured yet" — what the real hook reports before its first
 * layout effect — which keeps the pre-responsive expectations of this suite valid.
 */
const measuredWidth = vi.hoisted(() => ({ value: 0 }));
vi.mock('../../src/client/hooks/useElementWidth.ts', () => ({
  useElementWidth: () => [{ current: null }, measuredWidth.value] as const,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  resetI18nListeners();
  setLang('zh');
});

const noop = vi.fn();

function makePanelControls(overrides: Partial<PanelControls> = {}): PanelControls {
  return {
    showSearch: false,
    showCallChain: false,
    showCycles: false,
    cycleIsolation: false,
    showImpact: false,
    showInheritance: false,
    showMiniMap: false,
    showLegend: false,
    showImport: false,
    showPathFind: false,
    showHealthScore: false,
    showRules: false,
    showHotspot: false,
    showGodModule: false,
    showCoreFunction: false,
    showDeadCode: false,
    onToggleSearch: noop,
    onToggleCallChain: noop,
    onToggleCycles: noop,
    onToggleCycleIsolation: noop,
    onToggleImpact: noop,
    onToggleInheritance: noop,
    onToggleMiniMap: noop,
    onToggleLegend: noop,
    onToggleImport: noop,
    onTogglePathFind: noop,
    onToggleHealthScore: noop,
    onToggleRules: noop,
    onToggleHotspot: noop,
    onToggleGodModule: noop,
    onToggleCoreFunction: noop,
    onToggleDeadCode: noop,
    showFilterPanel: false,
    onToggleFilterPanel: noop,
    showTour: false,
    onToggleTour: noop,
    showRuntime: false,
    onToggleRuntime: noop,
    // 版本对比面板（cycle-104，研究报告 §六 #13）
    showDiff: false,
    onToggleDiff: noop,
    // 关键词图检索面板（cycle-111 / N-5）
    showKeywordQuery: false,
      showRegistry: false,
    onToggleKeywordQuery: noop,
    // 璇玑图 ρ 路径模式面板（cycle-135）
    showPathPattern: false,
    onTogglePathPattern: noop,
    onToggleRegistry: noop,
    ...overrides,
  };
}

const OLD_LAYOUT_KEYS = ['layout', 'dagreRankDir', 'clusterDepth', 'onLayoutChange', 'onDagreRankDirChange', 'onClusterDepthChange'] as const;
const OLD_VIEW_KEYS = ['viewMode', 'graphType', 'filterType', 'currentLayer', 'layerNames', 'hasSelectedFunction', 'onViewModeChange', 'onGraphTypeChange', 'onFilterChange', 'onLayerChange'] as const;
const OLD_HISTORY_KEYS = ['onUndo', 'onRedo', 'canUndo', 'canRedo'] as const;
const ALL_OLD_KEYS = new Set<string>([...OLD_LAYOUT_KEYS, ...OLD_VIEW_KEYS, ...OLD_HISTORY_KEYS]);

function makeProps(overrides: Record<string, unknown> = {}) {
  const onLayoutChange = (overrides.onLayoutChange as typeof noop) ?? noop;
  const onDagreRankDirChange = (overrides.onDagreRankDirChange as typeof noop) ?? noop;
  const onClusterDepthChange = (overrides.onClusterDepthChange as typeof noop) ?? noop;
  const onViewModeChange = (overrides.onViewModeChange as typeof noop) ?? noop;
  const onGraphTypeChange = (overrides.onGraphTypeChange as typeof noop) ?? noop;
  const onFilterChange = (overrides.onFilterChange as typeof noop) ?? noop;
  const onLayerChange = (overrides.onLayerChange as typeof noop) ?? noop;
  const onHierarchyLevelChange = (overrides.onHierarchyLevelChange as typeof noop) ?? noop;

  const layoutConfig: ToolbarLayoutConfig = {
    layout: (overrides.layout as LayoutType) ?? 'cose',
    dagreRankDir: (overrides.dagreRankDir as RankDir) ?? 'TB',
    clusterDepth: (overrides.clusterDepth as number) ?? 0,
    onChange: (field, value) => {
      if (field === 'layout') onLayoutChange(value as LayoutType);
      else if (field === 'dagreRankDir') onDagreRankDirChange(value as RankDir);
      else if (field === 'clusterDepth') onClusterDepthChange(value as number);
    },
  };

  const viewConfig: ToolbarViewConfig = {
    viewMode: (overrides.viewMode as ViewMode) ?? 'code',
    graphType: (overrides.graphType as GraphType) ?? 'all',
    filterType: (overrides.filterType as GraphNode['type'] | 'all') ?? 'all',
    currentLayer: (overrides.currentLayer as number) ?? 0,
    layerNames: (overrides.layerNames as string[]) ?? [],
    hierarchyLevel: (overrides.hierarchyLevel as number) ?? 3,
    hasSelectedFunction: overrides.hasSelectedFunction as boolean | undefined,
    onChange: (field, value) => {
      if (field === 'viewMode') onViewModeChange(value as ViewMode);
      else if (field === 'graphType') onGraphTypeChange(value as GraphType);
      else if (field === 'filterType') onFilterChange(value as GraphNode['type'] | 'all');
      else if (field === 'layer') onLayerChange(value as number);
      else if (field === 'hierarchyLevel') onHierarchyLevelChange(value as number);
    },
  };

  const history: ToolbarHistory = {
    undo: overrides.onUndo as typeof noop | undefined,
    redo: overrides.onRedo as typeof noop | undefined,
    canUndo: overrides.canUndo as boolean | undefined,
    canRedo: overrides.canRedo as boolean | undefined,
  };

  const restOverrides: Record<string, unknown> = {};
  for (const key of Object.keys(overrides)) {
    if (!ALL_OLD_KEYS.has(key)) restOverrides[key] = overrides[key];
  }

  return {
    statsText: '50 nodes',
    hasData: true,
    hasGraphData: true,
    typeCounts: { function: 10, class: 5, interface: 3 },
    theme: 'dark' as ThemeType,
    collapsed: false,
    panelControls: makePanelControls(),
    layoutConfig,
    viewConfig,
    history,
    onThemeToggle: noop,
    onRefresh: noop,
    onExport: noop,
    onCollapse: noop,
    currentWorkspace: '.',
    workspaceList: [] as WorkspaceInfo[],
    onSwitchWorkspace: noop,
    onAddWorkspace: noop,
    onRemoveWorkspace: noop,
    ...restOverrides,
  };
}

describe('Toolbar component', () => {
  // 1. 渲染所有布局按钮并响应点击
  describe('layout dropdown', () => {
    it('renders layout dropdown button with current layout', () => {
      render(<Toolbar {...makeProps()} />);
      const dropdownBtn = document.querySelector('.cg-layout-dropdown-btn');
      expect(dropdownBtn).toBeTruthy();
      expect(dropdownBtn!.textContent).toContain('cose');
    });

    it('opens layout dropdown and shows all layout options', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const dropdownBtn = document.querySelector('.cg-layout-dropdown-btn') as HTMLButtonElement;
      await user.click(dropdownBtn);
      const dropdown = document.querySelector('.cg-layout-dropdown');
      expect(dropdown).toBeTruthy();
      const items = dropdown!.querySelectorAll('button');
      expect(items.length).toBe(7);
      const labels = Array.from(items).map((b) => b.textContent);
      expect(labels).toEqual(['cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree']);
    });

    it('marks the active layout option with active class', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ layout: 'dagre' })} />);
      const dropdownBtn = document.querySelector('.cg-layout-dropdown-btn') as HTMLButtonElement;
      await user.click(dropdownBtn);
      const dagreBtn = Array.from(document.querySelectorAll('.cg-layout-dropdown button')).find(
        (b) => b.textContent === 'dagre',
      ) as HTMLButtonElement;
      expect(dagreBtn.className).toContain('active');
      expect(dagreBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('calls onLayoutChange when a layout option is clicked', async () => {
      const user = userEvent.setup();
      const onLayoutChange = vi.fn();
      render(<Toolbar {...makeProps({ onLayoutChange })} />);
      const dropdownBtn = document.querySelector('.cg-layout-dropdown-btn') as HTMLButtonElement;
      await user.click(dropdownBtn);
      const circleBtn = Array.from(document.querySelectorAll('.cg-layout-dropdown button')).find(
        (b) => b.textContent === 'circle',
      ) as HTMLButtonElement;
      await user.click(circleBtn);
      expect(onLayoutChange).toHaveBeenCalledWith('circle');
    });
  });

  // 2. 渲染图类型按钮并响应点击（已整合到 View 下拉菜单）
  describe('graph type in view dropdown', () => {
    it('renders all 3 graph type items in view dropdown', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const viewDropdown = document.querySelector('.cg-view-dropdown');
      expect(viewDropdown).toBeTruthy();
      const sectionLabels = viewDropdown!.querySelectorAll('.cg-dropdown-section-label');
      expect(sectionLabels.length).toBeGreaterThanOrEqual(1);
    });

    it('marks the active graph type item with active class', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ graphType: 'call' })} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const viewDropdown = document.querySelector('.cg-view-dropdown');
      const callItem = Array.from(viewDropdown!.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.textContent === '调用',
      ) as HTMLButtonElement;
      expect(callItem).toBeTruthy();
      expect(callItem.className).toContain('active');
      expect(callItem.getAttribute('aria-pressed')).toBe('true');
    });

    it('calls onGraphTypeChange when a graph type item is clicked', async () => {
      const user = userEvent.setup();
      const onGraphTypeChange = vi.fn();
      render(<Toolbar {...makeProps({ onGraphTypeChange })} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const viewDropdown = document.querySelector('.cg-view-dropdown');
      const callItem = Array.from(viewDropdown!.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.textContent === '调用',
      ) as HTMLButtonElement;
      await user.click(callItem);
      expect(onGraphTypeChange).toHaveBeenCalledWith('call');
    });
  });

  // 3. 渲染视图模式按钮并响应点击（已整合到 View 下拉菜单）
  describe('view mode in view dropdown', () => {
    it('renders all view mode groups in view dropdown', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const viewDropdown = document.querySelector('.cg-view-dropdown');
      expect(viewDropdown).toBeTruthy();
      // graphType + structural + behavioral + micro + runtime（cycle-88 新增第四段视图分组）
      const sectionLabels = viewDropdown!.querySelectorAll('.cg-dropdown-section-label');
      expect(sectionLabels.length).toBe(5);
    });

    it('renders the runtime layer entry and switches to it', async () => {
      // cycle-88（P2-1）：运行时层此前只存在于 ViewLayer 类型与 getAvailablePanels 的
      // 一个分支里，没有任何 ViewMode 映射过去 ⇒ 整个第三层没有入口。
      const user = userEvent.setup();
      const onViewModeChange = vi.fn();
      render(<Toolbar {...makeProps({ onViewModeChange })} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const runtimeItem = document.querySelector('.cg-viewmode-option-runtime') as HTMLButtonElement;
      expect(runtimeItem).toBeTruthy();
      await user.click(runtimeItem);
      expect(onViewModeChange).toHaveBeenCalledWith('runtime');
    });

    it('renders all 3 micro view mode items in view dropdown', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ hasSelectedFunction: true })} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const viewDropdown = document.querySelector('.cg-view-dropdown');
      const microLabel = Array.from(viewDropdown!.querySelectorAll('.cg-dropdown-section-label')).find(
        (l) => l.textContent?.includes('微观') || l.textContent?.includes('Micro'),
      );
      expect(microLabel).toBeTruthy();
    });

    it('calls onViewModeChange when a macro view mode item is clicked', async () => {
      const user = userEvent.setup();
      const onViewModeChange = vi.fn();
      render(<Toolbar {...makeProps({ onViewModeChange })} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const viewDropdown = document.querySelector('.cg-view-dropdown');
      const inheritItem = Array.from(viewDropdown!.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.textContent === '继承',
      ) as HTMLButtonElement;
      await user.click(inheritItem);
      expect(onViewModeChange).toHaveBeenCalledWith('inheritance');
    });

    it('calls onViewModeChange when a micro view mode item is clicked', async () => {
      const user = userEvent.setup();
      const onViewModeChange = vi.fn();
      render(<Toolbar {...makeProps({ hasSelectedFunction: true, onViewModeChange })} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const viewDropdown = document.querySelector('.cg-view-dropdown');
      const cfgItem = Array.from(viewDropdown!.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.textContent === 'CFG',
      ) as HTMLButtonElement;
      await user.click(cfgItem);
      expect(onViewModeChange).toHaveBeenCalledWith('cfg');
    });

    it('marks the active view mode item with active class', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ viewMode: 'inheritance' })} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const viewDropdown = document.querySelector('.cg-view-dropdown');
      const activeItem = viewDropdown!.querySelector('.cg-dropdown-item.cg-active') as HTMLButtonElement;
      expect(activeItem).toBeTruthy();
      expect(activeItem.getAttribute('aria-pressed')).toBe('true');
    });
  });

  // 4. 分层视图模式下显示层级选择器（已合并到 Level Dropdown）
  describe('layer selector (via level dropdown)', () => {
    it('shows layer options in level dropdown when layerNames has more than 1 entry', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ layerNames: ['Layer0', 'Layer1', 'Layer2'] })} />);
      const levelBtn = document.querySelector('.cg-level-dropdown-btn') as HTMLButtonElement;
      expect(levelBtn).toBeTruthy();
      await user.click(levelBtn);
      const levelDropdown = document.querySelector('.cg-level-dropdown');
      expect(levelDropdown).toBeTruthy();
      const items = levelDropdown!.querySelectorAll('.cg-dropdown-item');
      expect(items.length).toBeGreaterThanOrEqual(3);
    });

    it('calls onLayerChange when a layer item is clicked', async () => {
      const user = userEvent.setup();
      const onLayerChange = vi.fn();
      render(<Toolbar {...makeProps({ layerNames: ['L0', 'L1'], onLayerChange })} />);
      const levelBtn = document.querySelector('.cg-level-dropdown-btn') as HTMLButtonElement;
      await user.click(levelBtn);
      const levelDropdown = document.querySelector('.cg-level-dropdown');
      expect(levelDropdown).toBeTruthy();
      const allItems = levelDropdown!.querySelectorAll('.cg-dropdown-item');
      const layerItem = allItems[allItems.length - 1] as HTMLButtonElement;
      expect(layerItem).toBeTruthy();
      await user.click(layerItem);
      expect(onLayerChange).toHaveBeenCalled();
    });
  });

  // 6. 非分层视图模式下不显示层级选项
  it('does not show layer options when layerNames has 0 or 1 entry', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Toolbar {...makeProps({ layerNames: [] })} />);
    const levelBtn = document.querySelector('.cg-level-dropdown-btn') as HTMLButtonElement;
    await user.click(levelBtn);
    expect(document.querySelector('.cg-level-dropdown')?.textContent).not.toContain('Layer');

    rerender(<Toolbar {...makeProps({ layerNames: ['OnlyOne'] })} />);
    const levelBtn2 = document.querySelector('.cg-level-dropdown-btn') as HTMLButtonElement;
    await user.click(levelBtn2);
    const dropdownText = document.querySelector('.cg-level-dropdown')?.textContent ?? '';
    expect(dropdownText).not.toContain('OnlyOne');
  });

  // 5. code 模式下显示聚类深度选择器
  describe('cluster depth selector', () => {
    it('shows cluster depth selector when viewMode is code', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      const levelBtn = document.querySelector('.cg-level-dropdown-btn') as HTMLButtonElement;
      await user.click(levelBtn);
      const levelDropdown = document.querySelector('.cg-level-dropdown');
      expect(levelDropdown).toBeTruthy();
      const clusterItems = Array.from(levelDropdown!.querySelectorAll('.cg-dropdown-item')).filter(
        (b) => ['目录级', '文件级', '函数级'].includes(b.textContent ?? ''),
      );
      expect(clusterItems.length).toBe(3);
    });

    it('calls onClusterDepthChange when a different depth is selected', async () => {
      const user = userEvent.setup();
      const onClusterDepthChange = vi.fn();
      render(<Toolbar {...makeProps({ viewMode: 'code', onClusterDepthChange })} />);
      const levelBtn = document.querySelector('.cg-level-dropdown-btn') as HTMLButtonElement;
      await user.click(levelBtn);
      const levelDropdown = document.querySelector('.cg-level-dropdown');
      const fileItem = Array.from(levelDropdown!.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.textContent === '文件级',
      ) as HTMLButtonElement;
      await user.click(fileItem);
      expect(onClusterDepthChange).toHaveBeenCalledWith(1);
    });
  });

  // 7. 非 code 模式下不显示聚类深度选择器
  it('does not show cluster depth selector when viewMode is not code', async () => {
    const user = userEvent.setup();

    render(<Toolbar {...makeProps({ viewMode: 'dependencies' })} />);
    const levelBtn = document.querySelector('.cg-level-dropdown-btn') as HTMLButtonElement;
    await user.click(levelBtn);
    let levelDropdown = document.querySelector('.cg-level-dropdown');
    expect(levelDropdown?.textContent).not.toContain('目录级');
    expect(levelDropdown?.textContent).not.toContain('展开深度');
    cleanup();

    render(<Toolbar {...makeProps({ viewMode: 'callgraph' })} />);
    const levelBtn2 = document.querySelector('.cg-level-dropdown-btn') as HTMLButtonElement;
    await user.click(levelBtn2);
    levelDropdown = document.querySelector('.cg-level-dropdown');
    expect(levelDropdown?.textContent).not.toContain('目录级');
    expect(levelDropdown?.textContent).not.toContain('展开深度');
  });

  // 8. 分析工具按钮渲染和点击响应
  describe('analysis tool buttons', () => {
    const structuralButtons = [
      { className: 'cg-search-standalone-btn', handler: 'onToggleSearch', state: 'showSearch' },
      { className: 'cg-pathfind-btn', handler: 'onTogglePathFind', state: 'showPathFind' },
    ];
    const structuralQualityButtons = [
      { className: 'cg-health-btn', handler: 'onToggleHealthScore', state: 'showHealthScore' },
      { className: 'cg-rules-btn', handler: 'onToggleRules', state: 'showRules' },
    ];
    const behavioralButtons = [
      { className: 'cg-chain-btn', handler: 'onToggleCallChain', state: 'showCallChain' },
      { className: 'cg-cycle-btn', handler: 'onToggleCycles', state: 'showCycles' },
      { className: 'cg-impact-btn', handler: 'onToggleImpact', state: 'showImpact' },
      { className: 'cg-inheritance-btn', handler: 'onToggleInheritance', state: 'showInheritance' },
    ];
    const behavioralQualityButtons = [
      { className: 'cg-hotspot-btn', handler: 'onToggleHotspot', state: 'showHotspot' },
      { className: 'cg-godmodule-btn', handler: 'onToggleGodModule', state: 'showGodModule' },
      { className: 'cg-corefunction-btn', handler: 'onToggleCoreFunction', state: 'showCoreFunction' },
    ];

    async function openToolsDropdown(user: ReturnType<typeof userEvent.setup>) {
      const btn = document.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement;
      await user.click(btn);
    }

    it('renders tools dropdown button in code view mode', () => {
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      expect(document.querySelector('.cg-tools-dropdown-btn')).toBeTruthy();
    });

    it('renders tools dropdown button in callgraph view mode', () => {
      render(<Toolbar {...makeProps({ viewMode: 'callgraph' })} />);
      expect(document.querySelector('.cg-tools-dropdown-btn')).toBeTruthy();
    });

    it('shows tools dropdown items when dropdown is opened', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      await openToolsDropdown(user);
      expect(document.querySelector('.cg-dropdown-content')).toBeTruthy();
      const items = document.querySelectorAll('.cg-dropdown-item');
      expect(items.length).toBeGreaterThan(0);
    });

    it('hides tools dropdown items by default', () => {
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      expect(document.querySelector('.cg-dropdown-content')).toBeNull();
    });

    it('calls onToggleSearch when search standalone button is clicked', async () => {
      const user = userEvent.setup();
      const onToggleSearch = vi.fn();
      const panelControls = makePanelControls({ onToggleSearch });
      render(<Toolbar {...makeProps({ viewMode: 'code', panelControls })} />);
      const searchBtn = document.querySelector('.cg-search-standalone-btn') as HTMLButtonElement;
      expect(searchBtn).toBeTruthy();
      await user.click(searchBtn);
      expect(onToggleSearch).toHaveBeenCalledOnce();
    });

    it('calls onToggleCallChain when chain dropdown item is clicked', async () => {
      const user = userEvent.setup();
      const onToggleCallChain = vi.fn();
      const panelControls = makePanelControls({ onToggleCallChain });
      render(<Toolbar {...makeProps({ viewMode: 'callgraph', panelControls })} />);
      await openToolsDropdown(user);
      const chainItem = document.querySelector('.cg-chain-btn') as HTMLButtonElement;
      expect(chainItem).toBeTruthy();
      await user.click(chainItem);
      expect(onToggleCallChain).toHaveBeenCalledOnce();
    });

    it('calls onToggleHealthScore when health dropdown item is clicked', async () => {
      const user = userEvent.setup();
      const onToggleHealthScore = vi.fn();
      const panelControls = makePanelControls({ onToggleHealthScore });
      render(<Toolbar {...makeProps({ viewMode: 'code', panelControls })} />);
      await openToolsDropdown(user);
      const healthItem = document.querySelector('.cg-health-btn') as HTMLButtonElement;
      expect(healthItem).toBeTruthy();
      await user.click(healthItem);
      expect(onToggleHealthScore).toHaveBeenCalledOnce();
    });

    it('calls onToggleHotspot when hotspot dropdown item is clicked', async () => {
      const user = userEvent.setup();
      const onToggleHotspot = vi.fn();
      const panelControls = makePanelControls({ onToggleHotspot });
      render(<Toolbar {...makeProps({ viewMode: 'callgraph', panelControls })} />);
      await openToolsDropdown(user);
      const hotspotItem = document.querySelector('.cg-hotspot-btn') as HTMLButtonElement;
      expect(hotspotItem).toBeTruthy();
      await user.click(hotspotItem);
      expect(onToggleHotspot).toHaveBeenCalledOnce();
    });

    it('shows active class when search panel is active in code view', async () => {
      const user = userEvent.setup();
      const panelControls = makePanelControls({ showSearch: true });
      render(<Toolbar {...makeProps({ viewMode: 'code', panelControls })} />);
      const btn = document.querySelector('.cg-search-standalone-btn') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.className).toContain('active');
    });

    it('shows active class when health panel is active in code view', async () => {
      const user = userEvent.setup();
      const panelControls = makePanelControls({ showHealthScore: true });
      render(<Toolbar {...makeProps({ viewMode: 'code', panelControls })} />);
      await openToolsDropdown(user);
      const btn = document.querySelector('.cg-health-btn') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.className).toContain('active');
    });

    it('shows active class when call chain panel is active in callgraph view', async () => {
      const user = userEvent.setup();
      const panelControls = makePanelControls({ showCallChain: true });
      render(<Toolbar {...makeProps({ viewMode: 'callgraph', panelControls })} />);
      await openToolsDropdown(user);
      const btn = document.querySelector('.cg-chain-btn') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.className).toContain('active');
    });

    it('shows active class when hotspot panel is active in callgraph view', async () => {
      const user = userEvent.setup();
      const panelControls = makePanelControls({ showHotspot: true });
      render(<Toolbar {...makeProps({ viewMode: 'callgraph', panelControls })} />);
      await openToolsDropdown(user);
      const btn = document.querySelector('.cg-hotspot-btn') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.className).toContain('active');
    });

    it('closes tools dropdown after clicking an item', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      await openToolsDropdown(user);
      expect(document.querySelector('.cg-dropdown-content')).toBeTruthy();
      const item = document.querySelector('.cg-dropdown-item') as HTMLButtonElement;
      await user.click(item);
      expect(document.querySelector('.cg-dropdown-content')).toBeNull();
    });
  });


  // 9. 视图工具按钮渲染和点击响应
  describe('view tool buttons', () => {
    it('renders minimap, legend, and refresh buttons', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.cg-refresh-btn')).toBeTruthy();
      const moreBtn = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn);
      const minimapBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '切换缩略图 (Ctrl+M)',
      );
      const legendBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '切换图例',
      );
      expect(minimapBtn).toBeTruthy();
      expect(legendBtn).toBeTruthy();
    });

    it('calls onToggleMiniMap when minimap button is clicked', async () => {
      const user = userEvent.setup();
      const onToggleMiniMap = vi.fn();
      const panelControls = makePanelControls({ onToggleMiniMap });
      render(<Toolbar {...makeProps({ panelControls })} />);
      const moreBtn = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn);
      const minimapBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '切换缩略图 (Ctrl+M)',
      ) as HTMLButtonElement;
      await user.click(minimapBtn);
      expect(onToggleMiniMap).toHaveBeenCalledOnce();
    });

    it('calls onToggleLegend when legend button is clicked', async () => {
      const user = userEvent.setup();
      const onToggleLegend = vi.fn();
      const panelControls = makePanelControls({ onToggleLegend });
      render(<Toolbar {...makeProps({ panelControls })} />);
      const moreBtn = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn);
      const legendBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '切换图例',
      ) as HTMLButtonElement;
      await user.click(legendBtn);
      expect(onToggleLegend).toHaveBeenCalledOnce();
    });

    it('calls onRefresh when refresh button is clicked', async () => {
      const user = userEvent.setup();
      const onRefresh = vi.fn();
      render(<Toolbar {...makeProps({ onRefresh })} />);
      await user.click(document.querySelector('.cg-refresh-btn') as HTMLButtonElement);
      expect(onRefresh).toHaveBeenCalledOnce();
    });

    it('renders undo button when onUndo is provided', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ onUndo: noop, canUndo: true })} />);
      const historyBtn = document.querySelector('.cg-history-dropdown-btn') as HTMLButtonElement;
      await user.click(historyBtn);
      expect(document.querySelector('.cg-undo-btn')).toBeTruthy();
    });

    it('does not render undo button when onUndo is not provided', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.cg-history-dropdown-btn')).toBeNull();
    });

    it('disables undo button when canUndo is false', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ onUndo: noop, canUndo: false })} />);
      const historyBtn = document.querySelector('.cg-history-dropdown-btn') as HTMLButtonElement;
      await user.click(historyBtn);
      const undoBtn = document.querySelector('.cg-undo-btn') as HTMLButtonElement;
      expect(undoBtn.disabled).toBe(true);
    });

    it('calls onUndo when undo button is clicked', async () => {
      const user = userEvent.setup();
      const onUndo = vi.fn();
      render(<Toolbar {...makeProps({ onUndo, canUndo: true })} />);
      const historyBtn = document.querySelector('.cg-history-dropdown-btn') as HTMLButtonElement;
      await user.click(historyBtn);
      await user.click(document.querySelector('.cg-undo-btn') as HTMLButtonElement);
      expect(onUndo).toHaveBeenCalledOnce();
    });

    it('renders redo button when onRedo is provided', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ onRedo: noop, canRedo: true })} />);
      const historyBtn = document.querySelector('.cg-history-dropdown-btn') as HTMLButtonElement;
      await user.click(historyBtn);
      expect(document.querySelector('.cg-redo-btn')).toBeTruthy();
    });

    it('does not render redo button when onRedo is not provided', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.cg-history-dropdown-btn')).toBeNull();
    });

    it('disables redo button when canRedo is false', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ onRedo: noop, canRedo: false })} />);
      const historyBtn = document.querySelector('.cg-history-dropdown-btn') as HTMLButtonElement;
      await user.click(historyBtn);
      const redoBtn = document.querySelector('.cg-redo-btn') as HTMLButtonElement;
      expect(redoBtn.disabled).toBe(true);
    });

    it('calls onRedo when redo button is clicked', async () => {
      const user = userEvent.setup();
      const onRedo = vi.fn();
      render(<Toolbar {...makeProps({ onRedo, canRedo: true })} />);
      const historyBtn = document.querySelector('.cg-history-dropdown-btn') as HTMLButtonElement;
      await user.click(historyBtn);
      await user.click(document.querySelector('.cg-redo-btn') as HTMLButtonElement);
      expect(onRedo).toHaveBeenCalledOnce();
    });
  });

  // 10. 主题切换按钮
  describe('theme toggle button', () => {
    it('renders theme button', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ theme: 'dark' })} />);
      const moreBtn = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn);
      const themeBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '切换主题',
      );
      expect(themeBtn).toBeTruthy();
    });

    it('calls onThemeToggle when theme button is clicked', async () => {
      const user = userEvent.setup();
      const onThemeToggle = vi.fn();
      render(<Toolbar {...makeProps({ onThemeToggle })} />);
      const moreBtn = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn);
      const themeBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '切换主题',
      ) as HTMLButtonElement;
      await user.click(themeBtn);
      expect(onThemeToggle).toHaveBeenCalledOnce();
    });
  });

  // 11. 语言切换按钮
  describe('language toggle button', () => {
    it('renders language button with current language label', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const moreBtn = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn);
      const langBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '切换语言',
      );
      expect(langBtn).toBeTruthy();
    });

    it('toggles language when lang button is clicked', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const moreBtn = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn);
      const langBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '切换语言',
      ) as HTMLButtonElement;
      const labelBefore = langBtn.textContent;
      await user.click(langBtn);
      const moreBtn2 = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn2);
      const langBtn2 = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === 'Switch language',
      ) as HTMLButtonElement;
      const labelAfter = langBtn2.textContent;
      expect(labelBefore).not.toBe(labelAfter);
    });
  });

  // 12. 导出菜单
  describe('export menu', () => {
    it('renders export button', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.cg-export-btn')).toBeTruthy();
    });

    it('does not show export dropdown initially', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.cg-export-dropdown')).toBeNull();
    });

    it('shows export dropdown when export button is clicked', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const exportBtn = document.querySelector('.cg-export-btn') as HTMLButtonElement;
      await user.click(exportBtn);
      expect(document.querySelector('.cg-export-dropdown')).toBeTruthy();
      const menuItems = document.querySelectorAll('.cg-export-dropdown button[role="menuitem"]');
      expect(menuItems.length).toBe(8);
    });

    it('calls onExport with png when png option is clicked', async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<Toolbar {...makeProps({ onExport })} />);
      await user.click(document.querySelector('.cg-export-btn') as HTMLButtonElement);
      const menuItems = document.querySelectorAll('.cg-export-dropdown button[role="menuitem"]');
      await user.click(menuItems[0]!);
      expect(onExport).toHaveBeenCalledWith('png');
    });

    it('calls onExport with svg when svg option is clicked', async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<Toolbar {...makeProps({ onExport })} />);
      await user.click(document.querySelector('.cg-export-btn') as HTMLButtonElement);
      const menuItems = document.querySelectorAll('.cg-export-dropdown button[role="menuitem"]');
      await user.click(menuItems[1]!);
      expect(onExport).toHaveBeenCalledWith('svg');
    });

    it('calls onExport with json when json option is clicked', async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<Toolbar {...makeProps({ onExport })} />);
      await user.click(document.querySelector('.cg-export-btn') as HTMLButtonElement);
      const menuItems = document.querySelectorAll('.cg-export-dropdown button[role="menuitem"]');
      await user.click(menuItems[2]!);
      expect(onExport).toHaveBeenCalledWith('json');
    });

    it('closes export dropdown after selecting an export format', async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<Toolbar {...makeProps({ onExport })} />);
      await user.click(document.querySelector('.cg-export-btn') as HTMLButtonElement);
      const menuItems = document.querySelectorAll('.cg-export-dropdown button[role="menuitem"]');
      await user.click(menuItems[0]!);
      expect(document.querySelector('.cg-export-dropdown')).toBeNull();
    });

    it('closes export dropdown when clicking outside', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const exportBtn = document.querySelector('.cg-export-btn') as HTMLButtonElement;
      await user.click(exportBtn);
      expect(document.querySelector('.cg-export-dropdown')).toBeTruthy();
      // Click outside the export menu
      await user.click(document.body);
      expect(document.querySelector('.cg-export-dropdown')).toBeNull();
    });
  });

  // 13. 折叠按钮
  describe('collapse button', () => {
    it('renders collapse button', () => {
      render(<Toolbar {...makeProps({ collapsed: false })} />);
      expect(document.querySelector('.cg-collapse-btn')).toBeTruthy();
    });

    it('calls onCollapse when collapse button is clicked', async () => {
      const user = userEvent.setup();
      const onCollapse = vi.fn();
      render(<Toolbar {...makeProps({ onCollapse })} />);
      await user.click(document.querySelector('.cg-collapse-btn') as HTMLButtonElement);
      expect(onCollapse).toHaveBeenCalledOnce();
    });
  });

  // 14. 微观视图按钮在无选中函数时禁用（已整合到 View 下拉菜单）
  describe('micro view mode disabled state in view dropdown', () => {
    it('disables micro view mode items when hasSelectedFunction is false or undefined', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ hasSelectedFunction: false })} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const viewDropdown = document.querySelector('.cg-view-dropdown');
      const microItems = Array.from(viewDropdown!.querySelectorAll('.cg-dropdown-item')).filter(
        (b) => ['CFG', '流程', '时序'].includes(b.textContent ?? ''),
      );
      expect(microItems.length).toBe(3);
      microItems.forEach((btn) => {
        expect((btn as HTMLButtonElement).disabled).toBe(true);
        expect(btn.getAttribute('aria-disabled')).toBe('true');
      });
    });

    it('enables micro view mode items when hasSelectedFunction is true', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ hasSelectedFunction: true })} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const viewDropdown = document.querySelector('.cg-view-dropdown');
      const microItems = Array.from(viewDropdown!.querySelectorAll('.cg-dropdown-item')).filter(
        (b) => ['CFG', '流程', '时序'].includes(b.textContent ?? ''),
      );
      expect(microItems.length).toBe(3);
      microItems.forEach((btn) => {
        expect((btn as HTMLButtonElement).disabled).toBe(false);
        expect(btn.getAttribute('aria-disabled')).toBe('false');
      });
    });

    it('shows disabled tooltip when hasSelectedFunction is false', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ hasSelectedFunction: false })} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const viewDropdown = document.querySelector('.cg-view-dropdown');
      const microItems = Array.from(viewDropdown!.querySelectorAll('.cg-dropdown-item')).filter(
        (b) => ['CFG', '流程', '时序'].includes(b.textContent ?? ''),
      );
      microItems.forEach((btn) => {
        expect(btn.getAttribute('title')).toBe('请先选中函数节点');
      });
    });

    it('shows view mode tooltip when hasSelectedFunction is true', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ hasSelectedFunction: true })} />);
      const viewBtn = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
      await user.click(viewBtn);
      const viewDropdown = document.querySelector('.cg-view-dropdown');
      const cfgItem = Array.from(viewDropdown!.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.textContent === 'CFG',
      ) as HTMLButtonElement;
      expect(cfgItem).toBeTruthy();
      expect(cfgItem.getAttribute('title')).toContain('控制流');
    });
  });

  // 额外覆盖：层级名在 Dropdown 中完整显示
  describe('layer name display in level dropdown', () => {
    it('displays full layer name in dropdown items', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ layerNames: ['L0', 'L1'] })} />);
      const levelBtn = document.querySelector('.cg-level-dropdown-btn') as HTMLButtonElement;
      await user.click(levelBtn);
      const levelDropdown = document.querySelector('.cg-level-dropdown');
      expect(levelDropdown?.textContent).toContain('L0');
      expect(levelDropdown?.textContent).toContain('L1');
    });

    it('displays long layer names fully in dropdown', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ layerNames: ['LongLayerName', 'L1'] })} />);
      const levelBtn = document.querySelector('.cg-level-dropdown-btn') as HTMLButtonElement;
      await user.click(levelBtn);
      const levelDropdown = document.querySelector('.cg-level-dropdown');
      expect(levelDropdown?.textContent).toContain('LongLayerName');
    });
  });

  // 额外覆盖：折叠状态图标切换
  describe('collapse button icon state', () => {
    it('shows ChevronDownIcon when not collapsed', () => {
      render(<Toolbar {...makeProps({ collapsed: false })} />);
      const collapseBtn = document.querySelector('.cg-collapse-btn') as HTMLButtonElement;
      expect(collapseBtn).toBeTruthy();
      // collapsed=false => shows ChevronDownIcon
      const svg = collapseBtn.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('shows ChevronUpIcon when collapsed', () => {
      render(<Toolbar {...makeProps({ collapsed: true })} />);
      const collapseBtn = document.querySelector('.cg-collapse-btn') as HTMLButtonElement;
      expect(collapseBtn).toBeTruthy();
      const svg = collapseBtn.querySelector('svg');
      expect(svg).toBeTruthy();
    });
  });

  // 额外覆盖：主题图标
  describe('theme icon display', () => {
    it('renders SunIcon when theme is dark', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ theme: 'dark' })} />);
      const moreBtn = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn);
      const themeBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '切换主题',
      ) as HTMLButtonElement;
      expect(themeBtn).toBeTruthy();
      const svg = themeBtn.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('renders MoonIcon when theme is light', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ theme: 'light' })} />);
      const moreBtn = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn);
      const themeBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '切换主题',
      ) as HTMLButtonElement;
      expect(themeBtn).toBeTruthy();
      const svg = themeBtn.querySelector('svg');
      expect(svg).toBeTruthy();
    });
  });

  // 额外覆盖：节点统计信息
  describe('node stats display', () => {
    it('renders statsText', () => {
      render(<Toolbar {...makeProps({ statsText: '42 nodes' })} />);
      expect(screen.getByText('42 nodes')).toBeTruthy();
    });

    it('renders type badges when counts are positive', () => {
      render(<Toolbar {...makeProps({ typeCounts: { function: 10, class: 5, interface: 3 } })} />);
      expect(screen.getByText('fn:10')).toBeTruthy();
      expect(screen.getByText('cls:5')).toBeTruthy();
      expect(screen.getByText('if:3')).toBeTruthy();
    });

    it('does not render type badges when counts are zero', () => {
      render(<Toolbar {...makeProps({ typeCounts: { function: 0, class: 0, interface: 0 } })} />);
      expect(screen.queryByText(/fn:/)).toBeNull();
      expect(screen.queryByText(/cls:/)).toBeNull();
      expect(screen.queryByText(/if:/)).toBeNull();
    });
  });

  // 额外覆盖：filter panel button (filter select 已合并到 filter panel)
  describe('filter panel button', () => {
    it('renders filter panel button', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const dataBtn = document.querySelector('.cg-data-dropdown-btn') as HTMLButtonElement;
      await user.click(dataBtn);
      const filterBtn = document.querySelector('.cg-filter-panel-btn') as HTMLButtonElement;
      expect(filterBtn).toBeTruthy();
      expect(filterBtn.getAttribute('title')).toBeTruthy();
    });

    it('calls onToggleFilterPanel when clicked', async () => {
      const user = userEvent.setup();
      const onToggleFilterPanel = vi.fn();
      render(<Toolbar {...makeProps()} panelControls={makePanelControls({ onToggleFilterPanel })} />);
      const dataBtn = document.querySelector('.cg-data-dropdown-btn') as HTMLButtonElement;
      await user.click(dataBtn);
      const filterBtn = document.querySelector('.cg-filter-panel-btn') as HTMLButtonElement;
      await user.click(filterBtn);
      expect(onToggleFilterPanel).toHaveBeenCalled();
    });
  });

  // 额外覆盖：import button
  describe('import button', () => {
    it('renders import button', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const dataBtn = document.querySelector('.cg-data-dropdown-btn') as HTMLButtonElement;
      await user.click(dataBtn);
      expect(document.querySelector('.cg-import-btn')).toBeTruthy();
    });

    it('calls onToggleImport when import button is clicked', async () => {
      const user = userEvent.setup();
      const onToggleImport = vi.fn();
      const panelControls = makePanelControls({ onToggleImport });
      render(<Toolbar {...makeProps({ panelControls })} />);
      const dataBtn = document.querySelector('.cg-data-dropdown-btn') as HTMLButtonElement;
      await user.click(dataBtn);
      await user.click(document.querySelector('.cg-import-btn') as HTMLButtonElement);
      expect(onToggleImport).toHaveBeenCalledOnce();
    });
  });

  // 额外覆盖：collapse-all button
  describe('collapse-all button', () => {
    it('renders collapse-all button when onCollapseAll is provided', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ onCollapseAll: noop })} />);
      const moreBtn = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn);
      const collapseAllBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '收起',
      );
      expect(collapseAllBtn).toBeTruthy();
    });

    it('does not render collapse-all button when onCollapseAll is not provided', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const moreBtn = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn);
      const collapseAllBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '收起',
      );
      expect(collapseAllBtn).toBeUndefined();
    });

    it('calls onCollapseAll when collapse-all button is clicked', async () => {
      const user = userEvent.setup();
      const onCollapseAll = vi.fn();
      render(<Toolbar {...makeProps({ onCollapseAll })} />);
      const moreBtn = document.querySelector('.cg-more-btn') as HTMLButtonElement;
      await user.click(moreBtn);
      const collapseAllBtn = Array.from(document.querySelectorAll('.cg-dropdown-item')).find(
        (b) => b.getAttribute('aria-label') === '收起',
      ) as HTMLButtonElement;
      await user.click(collapseAllBtn);
      expect(onCollapseAll).toHaveBeenCalledOnce();
    });
  });

  describe('dagre rank-dir in layout dropdown', () => {
    it('shows rank-dir options when layout is dagre and dropdown is open', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ layout: 'dagre' })} />);
      const dropdownBtn = document.querySelector('.cg-layout-dropdown-btn') as HTMLButtonElement;
      await user.click(dropdownBtn);
      const dropdown = document.querySelector('.cg-layout-dropdown');
      expect(dropdown).toBeTruthy();
      const separator = dropdown!.querySelector('.cg-dropdown-separator');
      expect(separator).toBeTruthy();
      const rankItems = Array.from(dropdown!.querySelectorAll('button')).filter(
        (b) => ['TB', 'LR', 'BT', 'RL'].includes(b.textContent ?? ''),
      );
      expect(rankItems.length).toBe(4);
    });

    it('calls onDagreRankDirChange when a rank-dir option is clicked', async () => {
      const user = userEvent.setup();
      const onDagreRankDirChange = vi.fn();
      render(<Toolbar {...makeProps({ layout: 'dagre', onDagreRankDirChange })} />);
      const dropdownBtn = document.querySelector('.cg-layout-dropdown-btn') as HTMLButtonElement;
      await user.click(dropdownBtn);
      const tbBtn = Array.from(document.querySelectorAll('.cg-layout-dropdown button')).find(
        (b) => b.textContent === 'TB',
      ) as HTMLButtonElement;
      await user.click(tbBtn);
      expect(onDagreRankDirChange).toHaveBeenCalledWith('TB');
    });

    it('does not show rank-dir options when layout is not dagre', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ layout: 'cose' })} />);
      const dropdownBtn = document.querySelector('.cg-layout-dropdown-btn') as HTMLButtonElement;
      await user.click(dropdownBtn);
      const dropdown = document.querySelector('.cg-layout-dropdown');
      const rankItems = dropdown ? Array.from(dropdown.querySelectorAll('button')).filter(
        (b) => ['TB', 'LR', 'BT', 'RL'].includes(b.textContent ?? ''),
      ) : [];
      expect(rankItems.length).toBe(0);
    });
  });


  describe('export menu', () => {
    it('opens export dropdown when export button is clicked', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const exportBtn = document.querySelector('.cg-export-btn') as HTMLButtonElement;
      await user.click(exportBtn);
      expect(document.querySelector('.cg-export-dropdown')).toBeTruthy();
    });

    it('calls handleExport with png when png button is clicked', async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<Toolbar {...makeProps({ onExport })} />);
      const exportBtn = document.querySelector('.cg-export-btn') as HTMLButtonElement;
      await user.click(exportBtn);
      const menuItems = document.querySelectorAll('.cg-export-dropdown button');
      expect(menuItems.length).toBeGreaterThan(0);
      await user.click(menuItems[0]!);
      expect(onExport).toHaveBeenCalledWith('png');
    });

    it('calls handleExport with svg when svg button is clicked', async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<Toolbar {...makeProps({ onExport })} />);
      const exportBtn = document.querySelector('.cg-export-btn') as HTMLButtonElement;
      await user.click(exportBtn);
      const menuItems = document.querySelectorAll('.cg-export-dropdown button');
      await user.click(menuItems[1]!);
      expect(onExport).toHaveBeenCalledWith('svg');
    });

    it('calls handleExport with json when json button is clicked', async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<Toolbar {...makeProps({ onExport })} />);
      const exportBtn = document.querySelector('.cg-export-btn') as HTMLButtonElement;
      await user.click(exportBtn);
      const menuItems = document.querySelectorAll('.cg-export-dropdown button');
      await user.click(menuItems[2]!);
      expect(onExport).toHaveBeenCalledWith('json');
    });

    it('calls handleExport with mermaid when mermaid button is clicked', async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<Toolbar {...makeProps({ onExport })} />);
      const exportBtn = document.querySelector('.cg-export-btn') as HTMLButtonElement;
      await user.click(exportBtn);
      const menuItems = document.querySelectorAll('.cg-export-dropdown button');
      await user.click(menuItems[3]!);
      expect(onExport).toHaveBeenCalledWith('mermaid');
    });
  });
});

describe('Toolbar responsive tiers', () => {
  const WIDE = UI.TOOLBAR_BREAKPOINT_COMPACT_PX + 120;
  const COMPACT = UI.TOOLBAR_BREAKPOINT_COMPACT_PX - 1;
  const NARROW = UI.TOOLBAR_BREAKPOINT_NARROW_PX - 1;

  const toolbarEl = () => document.querySelector('.cg-graph-toolbar') as HTMLElement;

  it('renders the wide tier with value labels, separators and the standalone search button', () => {
    measuredWidth.value = WIDE;
    render(<Toolbar {...makeProps()} />);
    expect(toolbarEl().hasAttribute('data-cg-compact')).toBe(false);
    expect(toolbarEl().hasAttribute('data-cg-narrow')).toBe(false);
    expect((document.querySelector('.cg-layout-dropdown-btn') as HTMLElement).textContent).toContain('cose');
    expect(document.querySelectorAll('.cg-toolbar-separator').length).toBeGreaterThan(0);
    expect(document.querySelector('.cg-search-standalone-btn')).not.toBeNull();
  });

  it('drops the value labels and flags the compact tier on a narrow-ish toolbar', () => {
    measuredWidth.value = COMPACT;
    render(<Toolbar {...makeProps()} />);
    expect(toolbarEl().hasAttribute('data-cg-compact')).toBe(true);
    expect(toolbarEl().hasAttribute('data-cg-narrow')).toBe(false);
    const layout = document.querySelector('.cg-layout-dropdown-btn') as HTMLElement;
    expect(layout.textContent).not.toContain('cose');
    expect(layout.querySelector('svg')).not.toBeNull();
    // The current value must stay discoverable even when the label is gone.
    expect(layout.getAttribute('title')).toContain('cose');
    // The search button survives the compact tier — only the narrow tier moves it.
    expect(document.querySelector('.cg-search-standalone-btn')).not.toBeNull();
  });

  it('moves the search control into the more menu and flags the narrow tier', async () => {
    measuredWidth.value = NARROW;
    render(<Toolbar {...makeProps()} />);
    expect(toolbarEl().hasAttribute('data-cg-narrow')).toBe(true);
    expect(document.querySelector('.cg-search-standalone-btn')).toBeNull();
    const user = userEvent.setup();
    await user.click(document.querySelector('.cg-more-btn') as HTMLButtonElement);
    const items = [...document.querySelectorAll('.cg-dropdown-item')].map(el => el.textContent ?? '');
    expect(items.some(text => text.includes('搜索'))).toBe(true);
  });

  it('treats an unmeasured toolbar as wide so chrome never flashes into compact', () => {
    measuredWidth.value = 0;
    render(<Toolbar {...makeProps()} />);
    expect(toolbarEl().hasAttribute('data-cg-compact')).toBe(false);
    expect(toolbarEl().hasAttribute('data-cg-narrow')).toBe(false);
    expect((document.querySelector('.cg-layout-dropdown-btn') as HTMLElement).textContent).toContain('cose');
    expect(document.querySelector('.cg-search-standalone-btn')).not.toBeNull();
  });
});

describe('Toolbar empty-view recovery (J0 Round 11)', () => {
  it('keeps the layout and view-mode triggers usable when the current view renders zero nodes', () => {
    render(<Toolbar {...makeProps({ hasData: false, hasGraphData: true })} />);
    const layout = document.querySelector('.cg-layout-dropdown-btn') as HTMLButtonElement;
    const view = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
    // An empty behavioural view (e.g. the call graph in degraded mode) must not
    // strand the user: the raw graph is still loaded, so switching back stays possible.
    expect(layout.disabled).toBe(false);
    expect(view.disabled).toBe(false);
  });

  it('disables both triggers only when no graph is loaded at all', () => {
    render(<Toolbar {...makeProps({ hasData: false, hasGraphData: false })} />);
    const layout = document.querySelector('.cg-layout-dropdown-btn') as HTMLButtonElement;
    const view = document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement;
    expect(layout.disabled).toBe(true);
    expect(view.disabled).toBe(true);
  });

  it('still lets the user pick a different view mode from an empty view', async () => {
    const onViewModeChange = vi.fn();
    render(<Toolbar {...makeProps({ hasData: false, hasGraphData: true, viewMode: 'callgraph', onViewModeChange })} />);
    const user = userEvent.setup();
    await user.click(document.querySelector('.cg-view-dropdown-btn') as HTMLButtonElement);
    const codeItem = [...document.querySelectorAll('.cg-dropdown-item')].find(el => el.textContent === '代码');
    expect(codeItem).toBeDefined();
    await user.click(codeItem as HTMLButtonElement);
    expect(onViewModeChange).toHaveBeenCalledWith('code');
  });

  it('hides the node count for an empty view even though the graph is loaded', () => {
    render(<Toolbar {...makeProps({ hasData: false, hasGraphData: true, statsText: '0 nodes' })} />);
    // Counts describe what is rendered, so they stay hidden while the view is empty.
    expect(document.querySelector('.cg-node-count')).toBeNull();
  });
});

/**
 * 版本对比入口（cycle-104，研究报告 §六 #13）。
 *
 * 门控维度是**层**而不是「有没有图」：结构层与行为层都有图可标 diff，运行时层没有
 * （`computeViewModeTransition` 的 runtime 分支返回空子图）。因此工具下拉里的
 * 「版本对比」段必须在结构层/行为层出现、在运行时层整体消失（段标题也不得残留——
 * 空标题是 cycle-88 已经修过一次的同族缺陷）。
 */
describe('Toolbar version-diff entry (cycle-104)', () => {
  /**
   * 打开工具下拉。
   *
   * 必须返回同一个 `user` 实例给后续点击复用：`userEvent.setup()` 每次调用都会新建
   * 一个带独立指针状态的对象，跨实例点击在 jsdom 里可能因为「指针位置」不一致而落空
   * （本文件既有用例 `openToolsDropdown(user)` 就是按这个形状写的）。
   */
  async function openToolsMenu() {
    const user = userEvent.setup();
    await user.click(document.querySelector('.cg-tools-dropdown-btn') as HTMLButtonElement);
    return user;
  }

  it('offers the diff item on the structural layer', async () => {
    const onToggleDiff = vi.fn();
    // `onToggleDiff` 必须经 `makePanelControls` 注入：Toolbar 从 `panelControls` 读它，
    // 放在 `makeProps` 顶层会被当成一个未知 prop 静默忽略（Toolbar 不转发未知 prop）。
    render(<Toolbar {...makeProps({
      viewMode: 'code',
      panelControls: makePanelControls({ onToggleDiff }),
    })} />);
    const user = await openToolsMenu();
    const diffBtn = document.querySelector('.cg-diff-btn') as HTMLButtonElement;
    expect(diffBtn).toBeTruthy();
    await user.click(diffBtn);
    expect(onToggleDiff).toHaveBeenCalled();
  });

  it('offers the diff item on the behavioral layer', async () => {
    render(<Toolbar {...makeProps({ viewMode: 'callgraph' })} />);
    await openToolsMenu();
    expect(document.querySelector('.cg-diff-btn')).toBeTruthy();
  });

  it('hides the diff item on the runtime layer', async () => {
    // 运行时层没有图可标：入口存在就是「点击无反应」的死入口
    render(<Toolbar {...makeProps({ viewMode: 'runtime' })} />);
    await openToolsMenu();
    expect(document.querySelector('.cg-diff-btn')).toBeNull();
  });

  it('does not leave an empty section heading behind on the runtime layer', async () => {
    // cycle-88 的同族缺陷：段标题渲染了、段内容全被过滤掉，用户看到点不动的空标题。
    render(<Toolbar {...makeProps({ viewMode: 'runtime' })} />);
    await openToolsMenu();
    const labels = [...document.querySelectorAll('.cg-dropdown-section-label')].map((el) => el.textContent ?? '');
    // 运行时层的「版本对比」段标题不得出现
    expect(labels).not.toContain('版本对比');
    // 反证：运行时层自己的段标题必须在（否则这个断言对「整个下拉没渲染」也成立）
    expect(labels).toContain('运行时');
  });

  it('shows the diff section heading on the structural layer', async () => {
    // 与上一条成对：证明「版本对比」段标题确实由数据驱动，而不是永远不渲染
    render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
    await openToolsMenu();
    const labels = [...document.querySelectorAll('.cg-dropdown-section-label')].map((el) => el.textContent ?? '');
    expect(labels).toContain('版本对比');
  });

  it('reflects the active state through aria-checked', async () => {
    // 同理：`showDiff` 也住在 `panelControls` 里
    render(<Toolbar {...makeProps({
      viewMode: 'code',
      panelControls: makePanelControls({ showDiff: true }),
    })} />);
    await openToolsMenu();
    const diffBtn = document.querySelector('.cg-diff-btn') as HTMLButtonElement;
    expect(diffBtn).toBeTruthy();
    expect(diffBtn.getAttribute('aria-checked')).toBe('true');
    expect(diffBtn.classList.contains('cg-active')).toBe(true);
  });
});