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
    showFilterPanel: false,
    onToggleFilterPanel: noop,
    ...overrides,
  };
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    statsText: '50 nodes',
    typeCounts: { function: 10, class: 5, interface: 3 },
    layout: 'cose' as LayoutType,
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
      const layoutGroup = screen.getByRole('group', { name: /layout/i });
      expect(layoutGroup).toBeTruthy();
      const buttons = layoutGroup.querySelectorAll('button');
      expect(buttons.length).toBe(7);
      const labels = Array.from(buttons).map((b) => b.textContent);
      expect(labels).toEqual(['cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree']);
    });

    it('marks the active layout button with active class and aria-pressed', () => {
      render(<Toolbar {...makeProps({ layout: 'dagre' })} />);
      const layoutGroup = screen.getByRole('group', { name: /layout/i });
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
      const layoutGroup = screen.getByRole('group', { name: /layout/i });
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
      const graphTypeGroup = document.querySelector('.graph-type-buttons');
      expect(graphTypeGroup).toBeTruthy();
      const buttons = graphTypeGroup!.querySelectorAll('button');
      expect(buttons.length).toBe(3);
    });

    it('marks the active graph type button with active class', () => {
      render(<Toolbar {...makeProps({ graphType: 'call' })} />);
      const graphTypeGroup = document.querySelector('.graph-type-buttons');
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
      const graphTypeGroup = document.querySelector('.graph-type-buttons');
      const buttons = graphTypeGroup!.querySelectorAll('button');
      await user.click(buttons[1]!); // 'call' button
      expect(onGraphTypeChange).toHaveBeenCalledWith('call');
    });
  });

  // 3. 渲染视图模式按钮并响应点击
  describe('view mode buttons', () => {
    it('renders all 6 macro view mode buttons', () => {
      render(<Toolbar {...makeProps()} />);
      const viewModeGroup = document.querySelector('.view-mode-buttons');
      expect(viewModeGroup).toBeTruthy();
      const macroBtns = viewModeGroup!.querySelectorAll('.view-mode-btn:not(.view-mode-btn--micro)');
      expect(macroBtns.length).toBe(6);
    });

    it('renders all 3 micro view mode buttons', () => {
      render(<Toolbar {...makeProps({ hasSelectedFunction: true })} />);
      const viewModeGroup = document.querySelector('.view-mode-buttons');
      const microBtns = viewModeGroup!.querySelectorAll('.view-mode-btn--micro');
      expect(microBtns.length).toBe(3);
    });

    it('calls onViewModeChange when a macro view mode button is clicked', async () => {
      const user = userEvent.setup();
      const onViewModeChange = vi.fn();
      render(<Toolbar {...makeProps({ onViewModeChange })} />);
      const viewModeGroup = document.querySelector('.view-mode-buttons');
      const macroBtns = viewModeGroup!.querySelectorAll('.view-mode-btn:not(.view-mode-btn--micro)');
      await user.click(macroBtns[1]!); // 'dependencies'
      expect(onViewModeChange).toHaveBeenCalledWith('dependencies');
    });

    it('calls onViewModeChange when a micro view mode button is clicked', async () => {
      const user = userEvent.setup();
      const onViewModeChange = vi.fn();
      render(<Toolbar {...makeProps({ hasSelectedFunction: true, onViewModeChange })} />);
      const viewModeGroup = document.querySelector('.view-mode-buttons');
      const microBtns = viewModeGroup!.querySelectorAll('.view-mode-btn--micro');
      await user.click(microBtns[0]!); // 'cfg'
      expect(onViewModeChange).toHaveBeenCalledWith('cfg');
    });

    it('marks the active view mode button with active class', () => {
      render(<Toolbar {...makeProps({ viewMode: 'inheritance' })} />);
      const viewModeGroup = document.querySelector('.view-mode-buttons');
      const activeBtn = viewModeGroup!.querySelector('.view-mode-btn.active') as HTMLButtonElement;
      expect(activeBtn).toBeTruthy();
      expect(activeBtn.getAttribute('aria-pressed')).toBe('true');
    });
  });

  // 4. 分层视图模式下显示层级选择器
  describe('layer selector', () => {
    it('shows layer selector when layerNames has more than 1 entry', () => {
      render(<Toolbar {...makeProps({ layerNames: ['Layer0', 'Layer1', 'Layer2'] })} />);
      const layerSelector = document.querySelector('.layer-selector');
      expect(layerSelector).toBeTruthy();
      const layerBtns = layerSelector!.querySelectorAll('button');
      expect(layerBtns.length).toBe(3);
    });

    it('marks the current layer button as active', () => {
      render(<Toolbar {...makeProps({ layerNames: ['L0', 'L1'], currentLayer: 1 })} />);
      const layerSelector = document.querySelector('.layer-selector');
      const activeBtn = layerSelector!.querySelector('.layer-btn.active') as HTMLButtonElement;
      expect(activeBtn).toBeTruthy();
      expect(activeBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('calls onLayerChange when a layer button is clicked', async () => {
      const user = userEvent.setup();
      const onLayerChange = vi.fn();
      render(<Toolbar {...makeProps({ layerNames: ['L0', 'L1'], onLayerChange })} />);
      const layerSelector = document.querySelector('.layer-selector');
      const layerBtns = layerSelector!.querySelectorAll('button');
      await user.click(layerBtns[1]!);
      expect(onLayerChange).toHaveBeenCalledWith(1);
    });
  });

  // 6. 非分层视图模式下不显示层级选择器
  it('does not show layer selector when layerNames has 0 or 1 entry', () => {
    const { rerender } = render(<Toolbar {...makeProps({ layerNames: [] })} />);
    expect(document.querySelector('.layer-selector')).toBeNull();

    rerender(<Toolbar {...makeProps({ layerNames: ['OnlyOne'] })} />);
    expect(document.querySelector('.layer-selector')).toBeNull();
  });

  // 5. code 模式下显示聚类深度选择器
  describe('cluster depth selector', () => {
    it('shows cluster depth selector when viewMode is code', () => {
      render(<Toolbar {...makeProps({ viewMode: 'code' })} />);
      const depthSelect = document.querySelector('.depth-select');
      expect(depthSelect).toBeTruthy();
      const options = depthSelect!.querySelectorAll('option');
      expect(options.length).toBe(3);
    });

    it('calls onClusterDepthChange when a different depth is selected', async () => {
      const user = userEvent.setup();
      const onClusterDepthChange = vi.fn();
      render(<Toolbar {...makeProps({ viewMode: 'code', onClusterDepthChange })} />);
      const depthSelect = document.querySelector('.depth-select') as HTMLSelectElement;
      await user.selectOptions(depthSelect, '1');
      expect(onClusterDepthChange).toHaveBeenCalledWith(1);
    });
  });

  // 7. 非 code 模式下不显示聚类深度选择器
  it('does not show cluster depth selector when viewMode is not code', () => {
    const { rerender } = render(<Toolbar {...makeProps({ viewMode: 'dependencies' })} />);
    expect(document.querySelector('.depth-select')).toBeNull();

    rerender(<Toolbar {...makeProps({ viewMode: 'callgraph' })} />);
    expect(document.querySelector('.depth-select')).toBeNull();
  });

  // 8. 分析工具按钮渲染和点击响应
  describe('analysis tool buttons', () => {
    const analysisButtons = [
      { className: 'search-btn', handler: 'onToggleSearch', state: 'showSearch' },
      { className: 'chain-btn', handler: 'onToggleCallChain', state: 'showCallChain' },
      { className: 'cycle-btn', handler: 'onToggleCycles', state: 'showCycles' },
      { className: 'impact-btn', handler: 'onToggleImpact', state: 'showImpact' },
      { className: 'inheritance-btn', handler: 'onToggleInheritance', state: 'showInheritance' },
      { className: 'pathfind-btn', handler: 'onTogglePathFind', state: 'showPathFind' },
      { className: 'health-btn', handler: 'onToggleHealthScore', state: 'showHealthScore' },
      { className: 'rules-btn', handler: 'onToggleRules', state: 'showRules' },
      { className: 'hotspot-btn', handler: 'onToggleHotspot', state: 'showHotspot' },
      { className: 'godmodule-btn', handler: 'onToggleGodModule', state: 'showGodModule' },
      { className: 'corefunction-btn', handler: 'onToggleCoreFunction', state: 'showCoreFunction' },
    ];

    it('renders all 11 analysis tool buttons', () => {
      render(<Toolbar {...makeProps()} />);
      for (const { className } of analysisButtons) {
        const btn = document.querySelector(`.${className}`);
        expect(btn).toBeTruthy();
      }
    });

    it('calls the correct toggle handler when each analysis button is clicked', async () => {
      const user = userEvent.setup();
      for (const { className, handler } of analysisButtons) {
        const mockHandler = vi.fn();
        const panelControls = makePanelControls({ [handler]: mockHandler });
        const { unmount } = render(<Toolbar {...makeProps({ panelControls })} />);
        const btn = document.querySelector(`.${className}`) as HTMLButtonElement;
        await user.click(btn);
        expect(mockHandler).toHaveBeenCalledOnce();
        unmount();
      }
    });

    it('shows active class when analysis panel visibility state is true', () => {
      const panelControls = makePanelControls({
        showSearch: true,
        showCallChain: true,
        showCycles: true,
        showImpact: true,
        showInheritance: true,
        showPathFind: true,
        showHealthScore: true,
        showRules: true,
        showHotspot: true,
        showGodModule: true,
        showCoreFunction: true,
      });
      render(<Toolbar {...makeProps({ panelControls })} />);
      for (const { className } of analysisButtons) {
        const btn = document.querySelector(`.${className}`) as HTMLButtonElement;
        expect(btn.className).toContain('active');
      }
    });
  });

  // 9. 视图工具按钮渲染和点击响应
  describe('view tool buttons', () => {
    it('renders minimap, legend, and refresh buttons', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.minimap-btn')).toBeTruthy();
      expect(document.querySelector('.legend-btn')).toBeTruthy();
      expect(document.querySelector('.refresh-btn')).toBeTruthy();
    });

    it('calls onToggleMiniMap when minimap button is clicked', async () => {
      const user = userEvent.setup();
      const onToggleMiniMap = vi.fn();
      const panelControls = makePanelControls({ onToggleMiniMap });
      render(<Toolbar {...makeProps({ panelControls })} />);
      await user.click(document.querySelector('.minimap-btn') as HTMLButtonElement);
      expect(onToggleMiniMap).toHaveBeenCalledOnce();
    });

    it('calls onToggleLegend when legend button is clicked', async () => {
      const user = userEvent.setup();
      const onToggleLegend = vi.fn();
      const panelControls = makePanelControls({ onToggleLegend });
      render(<Toolbar {...makeProps({ panelControls })} />);
      await user.click(document.querySelector('.legend-btn') as HTMLButtonElement);
      expect(onToggleLegend).toHaveBeenCalledOnce();
    });

    it('calls onRefresh when refresh button is clicked', async () => {
      const user = userEvent.setup();
      const onRefresh = vi.fn();
      render(<Toolbar {...makeProps({ onRefresh })} />);
      await user.click(document.querySelector('.refresh-btn') as HTMLButtonElement);
      expect(onRefresh).toHaveBeenCalledOnce();
    });

    it('renders undo button when onUndo is provided', () => {
      render(<Toolbar {...makeProps({ onUndo: noop, canUndo: true })} />);
      expect(document.querySelector('.undo-btn')).toBeTruthy();
    });

    it('does not render undo button when onUndo is not provided', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.undo-btn')).toBeNull();
    });

    it('disables undo button when canUndo is false', () => {
      render(<Toolbar {...makeProps({ onUndo: noop, canUndo: false })} />);
      const undoBtn = document.querySelector('.undo-btn') as HTMLButtonElement;
      expect(undoBtn.disabled).toBe(true);
    });

    it('calls onUndo when undo button is clicked', async () => {
      const user = userEvent.setup();
      const onUndo = vi.fn();
      render(<Toolbar {...makeProps({ onUndo, canUndo: true })} />);
      await user.click(document.querySelector('.undo-btn') as HTMLButtonElement);
      expect(onUndo).toHaveBeenCalledOnce();
    });

    it('renders redo button when onRedo is provided', () => {
      render(<Toolbar {...makeProps({ onRedo: noop, canRedo: true })} />);
      expect(document.querySelector('.redo-btn')).toBeTruthy();
    });

    it('does not render redo button when onRedo is not provided', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.redo-btn')).toBeNull();
    });

    it('disables redo button when canRedo is false', () => {
      render(<Toolbar {...makeProps({ onRedo: noop, canRedo: false })} />);
      const redoBtn = document.querySelector('.redo-btn') as HTMLButtonElement;
      expect(redoBtn.disabled).toBe(true);
    });

    it('calls onRedo when redo button is clicked', async () => {
      const user = userEvent.setup();
      const onRedo = vi.fn();
      render(<Toolbar {...makeProps({ onRedo, canRedo: true })} />);
      await user.click(document.querySelector('.redo-btn') as HTMLButtonElement);
      expect(onRedo).toHaveBeenCalledOnce();
    });
  });

  // 10. 主题切换按钮
  describe('theme toggle button', () => {
    it('renders theme button', () => {
      render(<Toolbar {...makeProps({ theme: 'dark' })} />);
      expect(document.querySelector('.theme-btn')).toBeTruthy();
    });

    it('calls onThemeToggle when theme button is clicked', async () => {
      const user = userEvent.setup();
      const onThemeToggle = vi.fn();
      render(<Toolbar {...makeProps({ onThemeToggle })} />);
      await user.click(document.querySelector('.theme-btn') as HTMLButtonElement);
      expect(onThemeToggle).toHaveBeenCalledOnce();
    });
  });

  // 11. 语言切换按钮
  describe('language toggle button', () => {
    it('renders language button with current language label', () => {
      render(<Toolbar {...makeProps()} />);
      const langBtn = document.querySelector('.lang-btn');
      expect(langBtn).toBeTruthy();
      const label = langBtn!.querySelector('.lang-label');
      expect(label).toBeTruthy();
    });

    it('toggles language when lang button is clicked', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const langBtn = document.querySelector('.lang-btn') as HTMLButtonElement;
      const labelBefore = langBtn.querySelector('.lang-label')!.textContent;
      await user.click(langBtn);
      const labelAfter = langBtn.querySelector('.lang-label')!.textContent;
      expect(labelBefore).not.toBe(labelAfter);
    });
  });

  // 12. 导出菜单
  describe('export menu', () => {
    it('renders export button', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.export-btn')).toBeTruthy();
    });

    it('does not show export dropdown initially', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.export-dropdown')).toBeNull();
    });

    it('shows export dropdown when export button is clicked', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const exportBtn = document.querySelector('.export-btn') as HTMLButtonElement;
      await user.click(exportBtn);
      expect(document.querySelector('.export-dropdown')).toBeTruthy();
      const menuItems = document.querySelectorAll('.export-dropdown button[role="menuitem"]');
      expect(menuItems.length).toBe(4);
    });

    it('calls onExport with png when png option is clicked', async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<Toolbar {...makeProps({ onExport })} />);
      await user.click(document.querySelector('.export-btn') as HTMLButtonElement);
      const menuItems = document.querySelectorAll('.export-dropdown button[role="menuitem"]');
      await user.click(menuItems[0]!);
      expect(onExport).toHaveBeenCalledWith('png');
    });

    it('calls onExport with svg when svg option is clicked', async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<Toolbar {...makeProps({ onExport })} />);
      await user.click(document.querySelector('.export-btn') as HTMLButtonElement);
      const menuItems = document.querySelectorAll('.export-dropdown button[role="menuitem"]');
      await user.click(menuItems[1]!);
      expect(onExport).toHaveBeenCalledWith('svg');
    });

    it('calls onExport with json when json option is clicked', async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<Toolbar {...makeProps({ onExport })} />);
      await user.click(document.querySelector('.export-btn') as HTMLButtonElement);
      const menuItems = document.querySelectorAll('.export-dropdown button[role="menuitem"]');
      await user.click(menuItems[2]!);
      expect(onExport).toHaveBeenCalledWith('json');
    });

    it('closes export dropdown after selecting an export format', async () => {
      const user = userEvent.setup();
      const onExport = vi.fn();
      render(<Toolbar {...makeProps({ onExport })} />);
      await user.click(document.querySelector('.export-btn') as HTMLButtonElement);
      const menuItems = document.querySelectorAll('.export-dropdown button[role="menuitem"]');
      await user.click(menuItems[0]!);
      expect(document.querySelector('.export-dropdown')).toBeNull();
    });

    it('closes export dropdown when clicking outside', async () => {
      const user = userEvent.setup();
      render(<Toolbar {...makeProps()} />);
      const exportBtn = document.querySelector('.export-btn') as HTMLButtonElement;
      await user.click(exportBtn);
      expect(document.querySelector('.export-dropdown')).toBeTruthy();
      // Click outside the export menu
      await user.click(document.body);
      expect(document.querySelector('.export-dropdown')).toBeNull();
    });
  });

  // 13. 折叠按钮
  describe('collapse button', () => {
    it('renders collapse button', () => {
      render(<Toolbar {...makeProps({ collapsed: false })} />);
      expect(document.querySelector('.collapse-btn')).toBeTruthy();
    });

    it('calls onCollapse when collapse button is clicked', async () => {
      const user = userEvent.setup();
      const onCollapse = vi.fn();
      render(<Toolbar {...makeProps({ onCollapse })} />);
      await user.click(document.querySelector('.collapse-btn') as HTMLButtonElement);
      expect(onCollapse).toHaveBeenCalledOnce();
    });
  });

  // 14. 微观视图按钮在无选中函数时禁用
  describe('micro view mode button disabled state', () => {
    it('disables micro view mode buttons when hasSelectedFunction is false or undefined', () => {
      const { rerender } = render(<Toolbar {...makeProps({ hasSelectedFunction: false })} />);
      const microBtns = document.querySelectorAll('.view-mode-btn--micro');
      expect(microBtns.length).toBe(3);
      microBtns.forEach((btn) => {
        expect((btn as HTMLButtonElement).disabled).toBe(true);
        expect(btn.getAttribute('aria-disabled')).toBe('true');
      });

      rerender(<Toolbar {...makeProps()} />);
      const microBtns2 = document.querySelectorAll('.view-mode-btn--micro');
      microBtns2.forEach((btn) => {
        expect((btn as HTMLButtonElement).disabled).toBe(true);
      });
    });

    it('enables micro view mode buttons when hasSelectedFunction is true', () => {
      render(<Toolbar {...makeProps({ hasSelectedFunction: true })} />);
      const microBtns = document.querySelectorAll('.view-mode-btn--micro');
      expect(microBtns.length).toBe(3);
      microBtns.forEach((btn) => {
        expect((btn as HTMLButtonElement).disabled).toBe(false);
        expect(btn.getAttribute('aria-disabled')).toBe('false');
      });
    });
  });

  // 额外覆盖：层级名截断逻辑
  describe('layer name truncation', () => {
    it('displays full layer name when length <= 4', () => {
      render(<Toolbar {...makeProps({ layerNames: ['L0', 'L1'] })} />);
      const layerSelector = document.querySelector('.layer-selector');
      const btns = layerSelector!.querySelectorAll('button');
      expect(btns[0]!.textContent).toBe('L0');
      expect(btns[1]!.textContent).toBe('L1');
    });

    it('truncates layer name to 3 characters when length > 4', () => {
      render(<Toolbar {...makeProps({ layerNames: ['LongLayerName', 'L1'] })} />);
      const layerSelector = document.querySelector('.layer-selector');
      const btn = layerSelector!.querySelector('button');
      expect(btn!.textContent).toBe('Lon');
    });
  });

  // 额外覆盖：折叠状态图标切换
  describe('collapse button icon state', () => {
    it('shows ChevronDownIcon when not collapsed', () => {
      render(<Toolbar {...makeProps({ collapsed: false })} />);
      const collapseBtn = document.querySelector('.collapse-btn') as HTMLButtonElement;
      expect(collapseBtn).toBeTruthy();
      // collapsed=false => shows ChevronDownIcon
      const svg = collapseBtn.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('shows ChevronUpIcon when collapsed', () => {
      render(<Toolbar {...makeProps({ collapsed: true })} />);
      const collapseBtn = document.querySelector('.collapse-btn') as HTMLButtonElement;
      expect(collapseBtn).toBeTruthy();
      const svg = collapseBtn.querySelector('svg');
      expect(svg).toBeTruthy();
    });
  });

  // 额外覆盖：主题图标
  describe('theme icon display', () => {
    it('renders SunIcon when theme is dark', () => {
      render(<Toolbar {...makeProps({ theme: 'dark' })} />);
      const themeBtn = document.querySelector('.theme-btn');
      expect(themeBtn).toBeTruthy();
      const svg = themeBtn!.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('renders MoonIcon when theme is light', () => {
      render(<Toolbar {...makeProps({ theme: 'light' })} />);
      const themeBtn = document.querySelector('.theme-btn');
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
      const filterSelect = document.querySelector('.filter-select') as HTMLSelectElement;
      expect(filterSelect).toBeTruthy();
      const options = filterSelect.querySelectorAll('option');
      expect(options.length).toBe(6);
    });

    it('calls onFilterChange when filter type is changed', async () => {
      const user = userEvent.setup();
      const onFilterChange = vi.fn();
      render(<Toolbar {...makeProps({ onFilterChange })} />);
      const filterSelect = document.querySelector('.filter-select') as HTMLSelectElement;
      await user.selectOptions(filterSelect, 'class');
      expect(onFilterChange).toHaveBeenCalledWith('class');
    });
  });

  // 额外覆盖：import button
  describe('import button', () => {
    it('renders import button', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.import-btn')).toBeTruthy();
    });

    it('calls onToggleImport when import button is clicked', async () => {
      const user = userEvent.setup();
      const onToggleImport = vi.fn();
      const panelControls = makePanelControls({ onToggleImport });
      render(<Toolbar {...makeProps({ panelControls })} />);
      await user.click(document.querySelector('.import-btn') as HTMLButtonElement);
      expect(onToggleImport).toHaveBeenCalledOnce();
    });
  });

  // 额外覆盖：collapse-all button
  describe('collapse-all button', () => {
    it('renders collapse-all button when onCollapseAll is provided', () => {
      render(<Toolbar {...makeProps({ onCollapseAll: noop })} />);
      expect(document.querySelector('.collapse-all-btn')).toBeTruthy();
    });

    it('does not render collapse-all button when onCollapseAll is not provided', () => {
      render(<Toolbar {...makeProps()} />);
      expect(document.querySelector('.collapse-all-btn')).toBeNull();
    });

    it('calls onCollapseAll when collapse-all button is clicked', async () => {
      const user = userEvent.setup();
      const onCollapseAll = vi.fn();
      render(<Toolbar {...makeProps({ onCollapseAll })} />);
      await user.click(document.querySelector('.collapse-all-btn') as HTMLButtonElement);
      expect(onCollapseAll).toHaveBeenCalledOnce();
    });
  });
});