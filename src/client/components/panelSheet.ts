import type { PanelTier } from '../hooks/usePanelTier.ts';

/**
 * 窄档「抽屉面板」与叠加层的避让关系（cycle-110 / T3）。
 *
 * ## 缺陷形态
 *
 * 窄宿主（≤480px 面板）上，节点详情面板被 `responsive.css` 撑成
 * `width: calc(100% - 24px)` 且 `max-height: calc(100% - 24px)`。它从小地图
 * （右下 200px）与图例（左下 180px）**上层**盖过去，而三者都是
 * `z-index: var(--cg-z-panel)` 的绝对定位元素，于是：
 *
 *   - 小地图/图例被吃掉一半，用户以为它们「坏了」；
 *   - 详情面板底部的展开按钮与图例重叠，点击落在错误元素上。
 *
 * 修法有两条，必须同时明确：
 *   1. 窄档下面板改为**底部抽屉**（`bottom` 贴合状态栏上方、左右贴边、限高）；
 *   2. 抽屉打开时，小地图与图例**临时让位**（`display: none`），关闭后回归。
 *
 * 第 2 条必须由数据驱动：CSS 无法知道「有没有面板打开」，所以由 `GraphPanel`
 * 在根元素上写 `data-cg-sheet="open"`，样式只消费这个标记。
 *
 * 这里把「哪些面板算抽屉」和「要不要写标记」抽成纯函数，组件与契约测试共用同一判据，
 * 避免「CSS 里列了 4 个面板、组件里只判了 3 个」的静默漂移。
 */

/** GraphPanel 里会占满窄屏宽度的面板开关。 */
export interface SheetPanelState {
  /** 节点详情面板（选中节点即出现）。 */
  hasSelectedNode: boolean;
  showSearch: boolean;
  showPathFind: boolean;
  showFilterPanel: boolean;
  showImport: boolean;
}

/** 会改写窄档版式（抽屉式全宽）的面板键，顺序与界面层级一致。 */
export const SHEET_PANEL_KEYS = Object.freeze([
  'detail', 'search', 'pathFind', 'filter', 'import',
] as const);

export type SheetPanelKey = (typeof SHEET_PANEL_KEYS)[number];

/** 当前打开着的抽屉面板清单（空数组表示没有）。 */
export function openSheetPanels(state: SheetPanelState): SheetPanelKey[] {
  const open: SheetPanelKey[] = [];
  if (state.hasSelectedNode) open.push('detail');
  if (state.showSearch) open.push('search');
  if (state.showPathFind) open.push('pathFind');
  if (state.showFilterPanel) open.push('filter');
  if (state.showImport) open.push('import');
  return open;
}

/**
 * 根元素上要写的 `data-cg-*` 属性。
 *
 * - `data-cg-tier` 在宽档也写出（便于 E2E 直接读档位，而不是从样式反推）；
 * - `data-cg-sheet="open"` 在**任何**档位只要有抽屉面板打开就写出。
 *
 * 为什么不在写标记时就按档位过滤：两套窄档机制（容器查询 / `data-cg-tier`）
 * 的生效条件不同，而容器查询那一套在 JS 量不到宽度时（宿主没有 `ResizeObserver`）
 * 依然要工作 —— 若标记只在 JS 判定 narrow 时才写，容器查询分支就永远等不到它。
 * 因此标记只描述**事实**（有面板打开），由样式按档位决定要不要隐藏小地图/图例。
 */
export function panelRootDataAttributes(
  tier: PanelTier,
  state: SheetPanelState,
): Record<string, string> {
  const attrs: Record<string, string> = { 'data-cg-tier': tier };
  if (openSheetPanels(state).length > 0) attrs['data-cg-sheet'] = 'open';
  return attrs;
}
