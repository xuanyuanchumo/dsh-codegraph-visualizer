/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';

import { Toolbar, type PanelControls } from '../../src/client/components/Toolbar.tsx';
import type { LayoutType, ThemeType, GraphType } from '../../src/client/store/graphStore.ts';
import type { GraphNode, ViewMode } from '../../src/types/index.ts';
import type { WorkspaceInfo } from '../../src/client/store/graphStore.ts';
import { setLang, resetI18nListeners } from '../../src/client/i18n/index.ts';

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
    ...overrides,
  };
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    statsText: '50 nodes',
    typeCounts: { function: 10, class: 5, interface: 3 },
    layout: 'cose' as LayoutType,
    dagreRankDir: 'TB' as const,
    theme: 'dark' as ThemeType,
    filterType: 'all' as GraphNode['type'] | 'all',
    graphType: 'all' as GraphType,
    clusterDepth: 0,
    viewMode: 'code' as ViewMode,
    currentLayer: 0,
    layerNames: [],
    collapsed: false,
    panelControls: makePanelControls(),
    onLayoutChange: noop,
    onDagreRankDirChange: noop,
    onThemeToggle: noop,
    onFilterChange: noop,
    onGraphTypeChange: noop,
    onClusterDepthChange: noop,
    onViewModeChange: noop,
    onLayerChange: noop,
    onRefresh: noop,
    onExport: noop,
    onCollapse: noop,
    currentWorkspace: '.',
    workspaceList: [] as WorkspaceInfo[],
    onSwitchWorkspace: noop,
    onAddWorkspace: noop,
    onRemoveWorkspace: noop,
    ...overrides,
  };
}

describe('Toolbar component', () => {
  // 1. 渲染所有布局按钮并响应点击
  describe('layout buttons', () => {
    it('renders all 6 layout buttons', () => {
      render(<Toolbar {...makeProps()} />);
      const layoutGroup = screen.getByRole('group', { name: /布局切换|layout switcher/i });
      expect(layoutGroup).toBeTruthy();
      const buttons = layoutGroup.querySelectorAll('button');
      expect(buttons.length).toBe(7);
      const labels = Array.from(buttons).map((b) => b.textContent);
      expect(labels).toEqual(['cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree']);
    });

    it('marks the active layout button with active class and aria-pressed', () => {
      render(<Toolbar {...makeProps({ layout: 'dagre' })} />);
      const layoutGroup = screen.getByRole('group', { name: /布局切换|layout switcher/i });
      const dagreBtn = Array.from(layoutGroup.querySelectorAll('button')).find(
        (b) => b.textContent === 'dagre',
      ) as HTMLButtonElement;
      expect(dagreBtn.className).toContain('active');
      expect(dagreBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('calls onLayoutChange when a layout button is clicked', async () => {
      const user = userEvent.setup();
      const onLayoutChange = vi.fn();
      render(<Toolbar {...makeProps({ onLayoutChange })} />);
      const layoutGroup = screen.getByRole('group', { name: /布局切换|layout switcher/i });
      const circleBtn = Array.from(layoutGroup.querySelectorAll('button')).find(
        (b) => b.textContent === 'circle',
      ) as HTMLButtonElement;
      await user.click(circleBtn);
      expect(onLayoutChange).toHaveBeenCalledWith('circle');
    });
  });

  // 2. 渲染图类型按钮并响应点击
  describe('graph type buttons', () => {
    it('renders all 3 graph type buttons', () => {
      render(<Toolbar {...makeProps()} />);
      const graphTypeGroup = document.querySelector('.cg-graph-type-buttons');
      expect(graphTypeGroup).toBeTruthy();
      const buttons = graphTypeGroup!.querySelectorAll('button');
      expect(buttons.length).toBe(3);
    });

    it('marks the active graph type button with active class', () => {
      render(<Toolbar {...makeProps({ graphType: 'call' })} />);
      const graphTypeGroup = document.querySelector('.cg-graph-type-buttons');
      const callBtn = Array.from(graphTypeGroup!.querySelectorAll('button')).find(
        (b) => b.getAttribute('aria-pressed') === 'true',
      ) as HTMLButtonElement;
      expect(callBtn).toBeTruthy();
      expect(callBtn.className).toContain('active');
    });

    it('calls onGraphTypeChange when a graph type button is clicked', async () => {
      const user = userEvent.setup();
      const onGraphTypeChange = vi.fn();
      render(<Toolbar {...makeProps({ onGraphTypeChange })} />);
      const graphTypeGroup = document.querySelector('.cg-graph-type-buttons');
      const buttons = graphTypeGroup!.querySelectorAll('button');
      await user.click(buttons[1]!); // 'call' button
      expect(onGraphTypeChange).toHaveBeenCalledWith('call');
    });
  });

  // 3. 渲染视图模式按钮并响应点击
  describe('view mode buttons', () => {
    it('renders all 6 macro view mode buttons', () => {
      render(<Toolbar {...makeProps()} />);
      const viewModeGroup = document.querySelector('.cg-view-mode-buttons');
      expect(viewModeGroup).toBeTruthy();
      const macroBtns = viewModeGroup!.querySelectorAll('.cg-view-mode-btn:not(.cg-view-mode-btn--micro)');
      expect(macroBtns.length).toBe(6);
    });

    it('renders all 3 micro view mode buttons', () => {
      render(<Toolbar {...makeProps({ hasSelectedFunction: true })} />);
      const viewModeGroup = document.querySelector('.cg-view-mode-buttons');
      const microBtns = viewModeGroup!.querySelectorAll('.cg-view-mode-btn--micro');
      expect(microBtns.length).toBe(3);
    });

    it('calls onViewModeChange when a macro view mode button is clicked', async () => {
      const user = userEvent.setup();
      const onViewModeChange = vi.fn();
      render(<Toolbar {...makeProps({ onViewModeChange })} />);
      const viewModeGroup = document.querySelector('.cg-view-mode-buttons');
      const macroBtns = viewModeGroup!.querySelectorAll('.cg-view-mode-btn:not(.cg-view-mode-btn--micro)');
      await user.click(macroBtns[1]!); // 'dependencies'
      expect(onViewModeChange).toHaveBeenCalledWith('dependencies');
    });

    it('calls onViewModeChange when a micro view mode button is clicked', async () => {
      const user = userEvent.setup();
      const onViewModeChange = vi.fn();
      render(<Toolbar {...makeProps({ hasSelectedFunction: true, onViewModeChange })} />);
      const viewModeGroup = document.querySelector('.cg-view-mode-buttons');
      const microBtns = viewModeGroup!.querySelectorAll('.cg-view-mode-btn--micro');
      await user.click(microBtns[0]!); // 'cfg'
      expect(onViewModeChange).toHaveBeenCalledWith('cfg');
    });

    it('marks the active view mode button with active class', () => {
      render(<Toolbar {...makeProps({ viewMode: 'inheritance' })} />);
      const viewModeGroup = document.querySelector('.cg-view-mode-buttons');
      const activeBtn = viewModeGroup!.querySelector('.cg-view-mode-btn.cg-active') as HTMLButtonElement;
      expect(activeBtn).toBeTruthy();
      expect(activeBtn.getAttribute('aria-pressed')).toBe('true');
    });
  });

  // 4. 分层视图模式下显示层级选择器
  describe('layer selector', () => {
    it('shows layer selector when layerNames has more than 1 entry', () => {
      render(<Toolbar {...makeProps({ layerNames: ['Layer0', 'Layer1', 'Layer2'] })} />);
      const layerSelector = document.querySelector('.cg-layer-selector');
      expect(layerSelector).toBeTruthy();
      const layerBtns = layerSelector!.querySelectorAll('button');
      expect(layerBtns.length).toBe(3);
    });

    it('marks the current layer button as active', () => {
      render(<Toolbar {...makeProps({ layerNames: ['L0', 'L1'], currentLayer: 1 })} />);
      const layerSelector = document.querySelector('.cg-layer-selector');
      const activeBtn = layerSelector!.querySelector('.cg-layer-btn.cg-active') as HTMLButtonElement;
      expect(activeBtn).toBeTruthy();
      expect(activeBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('calls onLayerChange when a layer button is clicked', async () => {
      const user = userEvent.setup();
      const onLayerChange = vi.fn();
      render(<Toolbar {...makeProps({ layerNames: ['L0', 'L1'], onLayerChange })} />);
      const layerSelector = document.querySelector('.cg-layer-selector');
      const layerBtns = layerSelector!.querySelectorAll('button');
      await user.click(layerBtns[1]!);
      expect(onLayerChange).toHaveBeenCalledWith(1);
    });
  });

  // 6. 非分层视图模式下不显示层级选择器
  it('does not show layer selector when layerNames has 0 or 1 entry', () => {
    const { rerender } = render(<Toolbar {...makeProps({ layerNames: [] })} />);
    expect(document.querySelector('.cg-layer-selector')).toBeNull();

    rerender(<Toolbar {...makeProps({ layerNames: ['OnlyOne'] })} />);
    expect(document.querySelector('.cg-layer-selector')).toBeNull();
  });

  // 5. code 模式下显示聚类深度选择器
  describe('cluster depth selector', () => {
    it('shows cluster depth selector when viewMode is code', () => {
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      const depthSelect = document.querySelector('.cg-depth-select');
      expect(depthSelect).toBeTruthy();
      const options = depthSelect!.querySelectorAll('option');
      expect(options.length).toBe(3);
    });

    it('calls onClusterDepthChange when a different depth is selected', async () => {
      const user = userEvent.setup();
      const onClusterDepthChange = vi.fn();
      render(<Toolbar {...makeProps({ viewMode: 'code', onClusterDepthChange })} />);
      const depthSelect = document.querySelector('.cg-depth-select') as HTMLSelectElement;
      await user.selectOptions(depthSelect, '1');
      expect(onClusterDepthChange).toHaveBeenCalledWith(1);
    });
  });

  // 7. 非 code 模式下不显示聚类深度选择器
  it('does not show cluster depth selector when viewMode is not code', () => {
    const { rerender } = render(<Toolbar {...makeProps({ viewMode: 'dependencies' })} />);
    expect(document.querySelector('.cg-depth-select')).toBeNull();

    rerender(<Toolbar {...makeProps({ viewMode: 'callgraph' })} />);
    expect(document.querySelector('.cg-depth-select')).toBeNull();
  });

  // 8. 分析工具按钮渲染和点击响应
  describe('analysis tool buttons', () => {
    const structuralButtons = [
      { className: 'cg-search-btn', handler: 'onToggleSearch', state: 'showSearch' },
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

    async function openAnalysisDropdown(user: ReturnType<typeof userEvent.setup>) {
      const btn = document.querySelector('.cg-analysis-dropdown-btn') as HTMLButtonElement;
      await user.click(btn);
    }

    async function openQualityDropdown(user: ReturnType<typeof userEvent.setup>) {
      const btn = document.querySelector('.cg-quality-dropdown-btn') as HTMLButtonElement;
      await user.click(btn);
    }

    it('renders analysis dropdown button in code view mode', () => {
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      expect(document.querySelector('.cg-analysis-dropdown-btn')).toBeTruthy();
      expect(document.querySelector('.cg-quality-dropdown-btn')).toBeTruthy();
    });

    it('renders analysis dropdown button in callgraph view mode', () => {
      render(<Toolbar {...makeProps({ viewMode: 'callgraph' })} />);
      expect(document.querySelector('.cg-analysis-dropdown-btn')).toBeTruthy();
      expect(document.querySelector('.cg-quality-dropdown-btn')).toBeTruthy();
    });

    it('shows analysis dropdown items when dropdown is opened', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      await openAnalysisDropdown(user);
      expect(document.querySelector('.cg-dropdown-content')).toBeTruthy();
      const items = document.querySelectorAll('.cg-dropdown-item');
      expect(items.length).toBeGreaterThan(0);
    });

    it('shows quality dropdown items when dropdown is opened', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      await openQualityDropdown(user);
      expect(document.querySelector('.cg-dropdown-content')).toBeTruthy();
      const items = document.querySelectorAll('.cg-dropdown-item');
      expect(items.length).toBeGreaterThan(0);
    });

    it('hides analysis dropdown items by default', () => {
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      expect(document.querySelector('.cg-dropdown-content')).toBeNull();
    });

    it('calls onToggleSearch when search dropdown item is clicked', async () => {
      const user = userEvent.setup();
      const onToggleSearch = vi.fn();
      const panelControls = makePanelControls({ onToggleSearch });
      render(<Toolbar {...makeProps({ viewMode: 'code', panelControls })} />);
      const dropdownBtn = document.querySelector('.cg-analysis-dropdown-btn') as HTMLButtonElement;
      await user.click(dropdownBtn);
      const searchItem = document.querySelector('.cg-search-btn') as HTMLButtonElement;
      expect(searchItem).toBeTruthy();
      await user.click(searchItem);
      expect(onToggleSearch).toHaveBeenCalledOnce();
    });

    it('calls onToggleCallChain when chain dropdown item is clicked', async () => {
      const user = userEvent.setup();
      const onToggleCallChain = vi.fn();
      const panelControls = makePanelControls({ onToggleCallChain });
      render(<Toolbar {...makeProps({ viewMode: 'callgraph', panelControls })} />);
      const dropdownBtn = document.querySelector('.cg-analysis-dropdown-btn') as HTMLButtonElement;
      await user.click(dropdownBtn);
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
      const dropdownBtn = document.querySelector('.cg-quality-dropdown-btn') as HTMLButtonElement;
      await user.click(dropdownBtn);
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
      const dropdownBtn = document.querySelector('.cg-quality-dropdown-btn') as HTMLButtonElement;
      await user.click(dropdownBtn);
      const hotspotItem = document.querySelector('.cg-hotspot-btn') as HTMLButtonElement;
      expect(hotspotItem).toBeTruthy();
      await user.click(hotspotItem);
      expect(onToggleHotspot).toHaveBeenCalledOnce();
    });

    it('shows active class when search panel is active in code view', async () => {
      const user = userEvent.setup();
      const panelControls = makePanelControls({ showSearch: true });
      render(<Toolbar {...makeProps({ viewMode: 'code', panelControls })} />);
      await openAnalysisDropdown(user);
      const btn = document.querySelector('.cg-search-btn') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.className).toContain('active');
    });

    it('shows active class when health panel is active in code view', async () => {
      const user = userEvent.setup();
      const panelControls = makePanelControls({ showHealthScore: true });
      render(<Toolbar {...makeProps({ viewMode: 'code', panelControls })} />);
      await openQualityDropdown(user);
      const btn = document.querySelector('.cg-health-btn') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.className).toContain('active');
    });

    it('shows active class when call chain panel is active in callgraph view', async () => {
      const user = userEvent.setup();
      const panelControls = makePanelControls({ showCallChain: true });
      render(<Toolbar {...makeProps({ viewMode: 'callgraph', panelControls })} />);
      await openAnalysisDropdown(user);
      const btn = document.querySelector('.cg-chain-btn') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.className).toContain('active');
    });

    it('shows active class when hotspot panel is active in callgraph view', async () => {
      const user = userEvent.setup();
      const panelControls = makePanelControls({ showHotspot: true });
      render(<Toolbar {...makeProps({ viewMode: 'callgraph', panelControls })} />);
      await openQualityDropdown(user);
      const btn = document.querySelector('.cg-hotspot-btn') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.className).toContain('active');
    });

    it('closes analysis dropdown after clicking an item', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      await openAnalysisDropdown(user);
      expect(document.querySelector('.cg-dropdown-content')).toBeTruthy();
      const item = document.querySelector('.cg-dropdown-item') as HTMLButtonElement;
      await user.click(item);
      expect(document.querySelector('.cg-dropdown-content')).toBeNull();
    });

    it('closes quality dropdown after clicking an item', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      await openQualityDropdown(user);
      expect(document.querySelector('.cg-dropdown-content')).toBeTruthy();
      const item = document.querySelector('.cg-dropdown-item') as HTMLButtonElement;
      await user.click(item);
      expect(document.querySelector('.cg-dropdown-content')).toBeNull();
    });
  });


  // 9. 视图工具按钮渲染和点击响应
  describe('view tool buttons', () => {
    it('renders minimap, legend, and refresh buttons', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.cg-minimap-btn')).toBeTruthy();
      expect(document.querySelector('.cg-legend-btn')).toBeTruthy();
      expect(document.querySelector('.cg-refresh-btn')).toBeTruthy();
    });

    it('calls onToggleMiniMap when minimap button is clicked', async () => {
      const user = userEvent.setup();
      const onToggleMiniMap = vi.fn();
      const panelControls = makePanelControls({ onToggleMiniMap });
      render(<Toolbar {...makeProps({ panelControls })} />);
      await user.click(document.querySelector('.cg-minimap-btn') as HTMLButtonElement);
      expect(onToggleMiniMap).toHaveBeenCalledOnce();
    });

    it('calls onToggleLegend when legend button is clicked', async () => {
      const user = userEvent.setup();
      const onToggleLegend = vi.fn();
      const panelControls = makePanelControls({ onToggleLegend });
      render(<Toolbar {...makeProps({ panelControls })} />);
      await user.click(document.querySelector('.cg-legend-btn') as HTMLButtonElement);
      expect(onToggleLegend).toHaveBeenCalledOnce();
    });

    it('calls onRefresh when refresh button is clicked', async () => {
      const user = userEvent.setup();
      const onRefresh = vi.fn();
      render(<Toolbar {...makeProps({ onRefresh })} />);
      await user.click(document.querySelector('.cg-refresh-btn') as HTMLButtonElement);
      expect(onRefresh).toHaveBeenCalledOnce();
    });

    it('renders undo button when onUndo is provided', () => {
      render(<Toolbar {...makeProps({ onUndo: noop, canUndo: true })} />);
      expect(document.querySelector('.cg-undo-btn')).toBeTruthy();
    });

    it('does not render undo button when onUndo is not provided', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.cg-undo-btn')).toBeNull();
    });

    it('disables undo button when canUndo is false', () => {
      render(<Toolbar {...makeProps({ onUndo: noop, canUndo: false })} />);
      const undoBtn = document.querySelector('.cg-undo-btn') as HTMLButtonElement;
      expect(undoBtn.disabled).toBe(true);
    });

    it('calls onUndo when undo button is clicked', async () => {
      const user = userEvent.setup();
      const onUndo = vi.fn();
      render(<Toolbar {...makeProps({ onUndo, canUndo: true })} />);
      await user.click(document.querySelector('.cg-undo-btn') as HTMLButtonElement);
      expect(onUndo).toHaveBeenCalledOnce();
    });

    it('renders redo button when onRedo is provided', () => {
      render(<Toolbar {...makeProps({ onRedo: noop, canRedo: true })} />);
      expect(document.querySelector('.cg-redo-btn')).toBeTruthy();
    });

    it('does not render redo button when onRedo is not provided', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.cg-redo-btn')).toBeNull();
    });

    it('disables redo button when canRedo is false', () => {
      render(<Toolbar {...makeProps({ onRedo: noop, canRedo: false })} />);
      const redoBtn = document.querySelector('.cg-redo-btn') as HTMLButtonElement;
      expect(redoBtn.disabled).toBe(true);
    });

    it('calls onRedo when redo button is clicked', async () => {
      const user = userEvent.setup();
      const onRedo = vi.fn();
      render(<Toolbar {...makeProps({ onRedo, canRedo: true })} />);
      await user.click(document.querySelector('.cg-redo-btn') as HTMLButtonElement);
      expect(onRedo).toHaveBeenCalledOnce();
    });
  });

  // 10. 主题切换按钮
  describe('theme toggle button', () => {
    it('renders theme button', () => {
      render(<Toolbar {...makeProps({ theme: 'dark' })} />);
      expect(document.querySelector('.cg-theme-btn')).toBeTruthy();
    });

    it('calls onThemeToggle when theme button is clicked', async () => {
      const user = userEvent.setup();
      const onThemeToggle = vi.fn();
      render(<Toolbar {...makeProps({ onThemeToggle })} />);
      await user.click(document.querySelector('.cg-theme-btn') as HTMLButtonElement);
      expect(onThemeToggle).toHaveBeenCalledOnce();
    });
  });

  // 11. 语言切换按钮
  describe('language toggle button', () => {
    it('renders language button with current language label', () => {
      render(<Toolbar {...makeProps()} />);
      const langBtn = document.querySelector('.cg-lang-btn');
      expect(langBtn).toBeTruthy();
      const label = langBtn!.querySelector('.cg-lang-label');
      expect(label).toBeTruthy();
    });

    it('toggles language when lang button is clicked', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const langBtn = document.querySelector('.cg-lang-btn') as HTMLButtonElement;
      const labelBefore = langBtn.querySelector('.cg-lang-label')!.textContent;
      await user.click(langBtn);
      const labelAfter = langBtn.querySelector('.cg-lang-label')!.textContent;
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

  // 14. 微观视图按钮在无选中函数时禁用
  describe('micro view mode button disabled state', () => {
    it('disables micro view mode buttons when hasSelectedFunction is false or undefined', () => {
      const { rerender } = render(<Toolbar {...makeProps({ hasSelectedFunction: false })} />);
      const microBtns = document.querySelectorAll('.cg-view-mode-btn--micro');
      expect(microBtns.length).toBe(3);
      microBtns.forEach((btn) => {
        expect((btn as HTMLButtonElement).disabled).toBe(true);
        expect(btn.getAttribute('aria-disabled')).toBe('true');
      });

      rerender(<Toolbar {...makeProps()} />);
      const microBtns2 = document.querySelectorAll('.cg-view-mode-btn--micro');
      microBtns2.forEach((btn) => {
        expect((btn as HTMLButtonElement).disabled).toBe(true);
      });
    });

    it('enables micro view mode buttons when hasSelectedFunction is true', () => {
      render(<Toolbar {...makeProps({ hasSelectedFunction: true })} />);
      const microBtns = document.querySelectorAll('.cg-view-mode-btn--micro');
      expect(microBtns.length).toBe(3);
      microBtns.forEach((btn) => {
        expect((btn as HTMLButtonElement).disabled).toBe(false);
        expect(btn.getAttribute('aria-disabled')).toBe('false');
      });
    });

    it('shows disabled tooltip when hasSelectedFunction is false', () => {
      render(<Toolbar {...makeProps({ hasSelectedFunction: false })} />);
      const microBtns = document.querySelectorAll('.cg-view-mode-btn--micro');
      microBtns.forEach((btn) => {
        expect(btn.getAttribute('title')).toBe('请先选中函数节点');
      });
    });

    it('shows view mode tooltip when hasSelectedFunction is true', () => {
      render(<Toolbar {...makeProps({ hasSelectedFunction: true })} />);
      const microBtns = document.querySelectorAll('.cg-view-mode-btn--micro');
      const cfgBtn = microBtns[0] as HTMLButtonElement;
      expect(cfgBtn.getAttribute('title')).toContain('控制流');
    });
  });

  // 额外覆盖：层级名截断逻辑
  describe('layer name truncation', () => {
    it('displays full layer name when length <= 4', () => {
      render(<Toolbar {...makeProps({ layerNames: ['L0', 'L1'] })} />);
      const layerSelector = document.querySelector('.cg-layer-selector');
      const btns = layerSelector!.querySelectorAll('button');
      expect(btns[0]!.textContent).toBe('L0');
      expect(btns[1]!.textContent).toBe('L1');
    });

    it('truncates layer name to 3 characters when length > 4', () => {
      render(<Toolbar {...makeProps({ layerNames: ['LongLayerName', 'L1'] })} />);
      const layerSelector = document.querySelector('.cg-layer-selector');
      const btn = layerSelector!.querySelector('button');
      expect(btn!.textContent).toBe('Lon');
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
    it('renders SunIcon when theme is dark', () => {
      render(<Toolbar {...makeProps({ theme: 'dark' })} />);
      const themeBtn = document.querySelector('.cg-theme-btn');
      expect(themeBtn).toBeTruthy();
      const svg = themeBtn!.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('renders MoonIcon when theme is light', () => {
      render(<Toolbar {...makeProps({ theme: 'light' })} />);
      const themeBtn = document.querySelector('.cg-theme-btn');
      expect(themeBtn).toBeTruthy();
      const svg = themeBtn!.querySelector('svg');
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

  // 额外覆盖：filter select
  describe('filter type select', () => {
    it('renders filter select with all options', () => {
      render(<Toolbar {...makeProps()} />);
      const filterSelect = document.querySelector('.cg-filter-select') as HTMLSelectElement;
      expect(filterSelect).toBeTruthy();
      const options = filterSelect.querySelectorAll('option');
      expect(options.length).toBe(6);
    });

    it('calls onFilterChange when filter type is changed', async () => {
      const user = userEvent.setup();
      const onFilterChange = vi.fn();
      render(<Toolbar {...makeProps({ onFilterChange })} />);
      const filterSelect = document.querySelector('.cg-filter-select') as HTMLSelectElement;
      await user.selectOptions(filterSelect, 'class');
      expect(onFilterChange).toHaveBeenCalledWith('class');
    });
  });

  // 额外覆盖：import button
  describe('import button', () => {
    it('renders import button', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.cg-import-btn')).toBeTruthy();
    });

    it('calls onToggleImport when import button is clicked', async () => {
      const user = userEvent.setup();
      const onToggleImport = vi.fn();
      const panelControls = makePanelControls({ onToggleImport });
      render(<Toolbar {...makeProps({ panelControls })} />);
      await user.click(document.querySelector('.cg-import-btn') as HTMLButtonElement);
      expect(onToggleImport).toHaveBeenCalledOnce();
    });
  });

  // 额外覆盖：collapse-all button
  describe('collapse-all button', () => {
    it('renders collapse-all button when onCollapseAll is provided', () => {
      render(<Toolbar {...makeProps({ onCollapseAll: noop })} />);
      expect(document.querySelector('.cg-collapse-all-btn')).toBeTruthy();
    });

    it('does not render collapse-all button when onCollapseAll is not provided', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.cg-collapse-all-btn')).toBeNull();
    });

    it('calls onCollapseAll when collapse-all button is clicked', async () => {
      const user = userEvent.setup();
      const onCollapseAll = vi.fn();
      render(<Toolbar {...makeProps({ onCollapseAll })} />);
      await user.click(document.querySelector('.cg-collapse-all-btn') as HTMLButtonElement);
      expect(onCollapseAll).toHaveBeenCalledOnce();
    });
  });

  describe('dagre rank-dir buttons', () => {
    it('renders rank-dir buttons when layout is dagre', () => {
      render(<Toolbar {...makeProps({ layout: 'dagre' })} />);
      const rankDirGroup = document.querySelector('.cg-rank-dir-buttons');
      expect(rankDirGroup).toBeTruthy();
      const buttons = rankDirGroup!.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('calls onDagreRankDirChange when a rank-dir button is clicked', async () => {
      const user = userEvent.setup();
      const onDagreRankDirChange = vi.fn();
      render(<Toolbar {...makeProps({ layout: 'dagre', onDagreRankDirChange })} />);
      const rankDirGroup = document.querySelector('.cg-rank-dir-buttons');
      const firstBtn = rankDirGroup!.querySelector('button') as HTMLButtonElement;
      await user.click(firstBtn);
      expect(onDagreRankDirChange).toHaveBeenCalled();
    });

    it('does not render rank-dir buttons when layout is not dagre', () => {
      render(<Toolbar {...makeProps({ layout: 'cose' })} />);
      expect(document.querySelector('.cg-rank-dir-buttons')).toBeNull();
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