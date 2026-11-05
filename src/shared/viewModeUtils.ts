import type { ViewMode } from '../types/index.ts';
import { assertNever } from './assertNever.ts';

export type ThemeType = 'light' | 'dark';
export type LayoutType = 'cose' | 'fcose' | 'dagre' | 'circle' | 'grid' | 'radial' | 'tree';
export type RankDir = 'TB' | 'LR' | 'BT' | 'RL';
export type ViewLayer = 'structural' | 'behavioral' | 'runtime';

/**
 * 布局类型的**唯一权威顺序表**（cycle-84 收敛）。
 *
 * 在此之前，同一份 7 项列表在仓库里有 4 份互相独立的副本：工具栏下拉
 * （`src/client/components/toolbarConfig.ts`）、斜杠命令循环
 * （`src/client/integrations/CommandUiIntegration.ts`）、持久化迁移校验
 * （`src/client/store/graphStore.ts` 的 `migrate`）、键盘快捷键循环
 * （`src/client/hooks/usePanelKeyboard.ts`）。四份副本同序但各写各的，任何
 * 一次「新增一种布局」都要记得改 4 处，漏改的后果是静默的：工具栏能选、
 * 命令循环跳过、持久化把它当脏值回退、键盘循环永远轮不到。
 *
 * 这里把它提升到 `LayoutType` 的类型归属地（`src/shared/`），四者一律引用
 * 本常量；`tests/unit/layoutOrderContract.test.ts` 用源码守卫锁死这件事。
 *
 * 顺序即 UI 呈现顺序，也是键盘/命令循环顺序，**不要按字母序重排**：
 * `cose`（默认）必须排在第一位，`migrate` 的兜底值也依赖它。
 *
 * `Object.freeze` 是运行期保险：`readonly` 只在编译期生效，而 JS 侧任何一处
 * `LAYOUT_ORDER[0] = 'grid'` 都能静默改掉全局顺序（`tests/unit/layoutOrderContract.test.ts`
 * 对此有断言）。
 */
export const LAYOUT_ORDER: readonly LayoutType[] = Object.freeze([
  'cose', 'fcose', 'dagre', 'circle', 'grid', 'radial', 'tree',
]);

export const VIEW_MODE_LAYOUT: Record<ViewMode, LayoutType> = {
  code: 'cose',
  dependencies: 'cose',
  inheritance: 'tree',
  callgraph: 'dagre',
  package: 'tree',
  class: 'dagre',
  cfg: 'dagre',
  flowchart: 'dagre',
  sequence: 'cose',
  // 运行时层没有图谱，布局值只用于满足 `Record<ViewMode, LayoutType>` 的穷尽性；
  // 该模式下不渲染 cy 容器，因此这个值不会被消费。
  runtime: 'cose',
};

export function isLayeredViewMode(mode: ViewMode): boolean {
  switch (mode) {
    case 'inheritance':
    case 'callgraph':
    case 'package':
    case 'class':
    case 'dependencies':
      return true;
    case 'code':
    case 'cfg':
    case 'flowchart':
    case 'sequence':
    case 'runtime':
      return false;
    default:
      return assertNever(mode);
  }
}

export function getViewLayer(mode: ViewMode): ViewLayer {
  switch (mode) {
    case 'code':
      return 'structural';
    case 'runtime':
      return 'runtime';
    case 'dependencies':
    case 'inheritance':
    case 'callgraph':
    case 'package':
    case 'class':
    case 'cfg':
    case 'flowchart':
    case 'sequence':
      return 'behavioral';
    default:
      return assertNever(mode);
  }
}

export const STRUCTURAL_VIEW_MODES: ViewMode[] = ['code'];
export const BEHAVIORAL_VIEW_MODES: ViewMode[] = ['dependencies', 'inheritance', 'callgraph', 'package', 'class'];
export const BEHAVIORAL_MICRO_VIEW_MODES: ViewMode[] = ['cfg', 'flowchart', 'sequence'];
/**
 * 运行时层的视图模式集合（cycle-88）。
 *
 * 与 `STRUCTURAL_VIEW_MODES` / `BEHAVIORAL_VIEW_MODES` 同级，是工具栏第四段的
 * 数据来源。之所以是数组而不是单个字面量，是为了让工具栏、测试与未来的
 * 「运行时子模式」共用同一份顺序表——`tests/unit/viewModeUtils.test.ts`
 * 的 `ALL_VIEW_MODES` 交叉校验会保证它不漏项。
 */
export const RUNTIME_VIEW_MODES: ViewMode[] = ['runtime'];
export type AnalysisPanelKey =
  | 'showSearch' | 'showPathFind' | 'showHealthScore' | 'showRules' | 'showImport' | 'showFilterPanel'
  | 'showCallChain' | 'showCycles' | 'showImpact' | 'showInheritance' | 'showHotspot' | 'showGodModule' | 'showCoreFunction'
  | 'showDeadCode'
  | 'showRuntime'
  | 'showDiff'
  | 'showKeywordQuery'
  | 'showPathPattern'
  | 'showViews'
  | 'showMiniMap' | 'showLegend';

/**
 * 结构层可用面板。
 *
 * `showDiff` 自 cycle-104 起进入本集合（研究报告 §六 #13）：版本对比要在画布上标
 * 「新增/修改/删除」，因此它需要一层**有图**的视图。结构层与行为层都有图，两层都提供；
 * 运行时层没有图（`computeViewModeTransition` 的 runtime 分支返回空子图），故不在
 * `RUNTIME_PANELS` 里——这正是能力矩阵该表达的事实，不需要额外一套门控逻辑。
 *
 * 曾经考虑过「按 `hasGraphData` 单独门控」而不入矩阵：那会让「切到运行时层时该不该收起
 * 对比面板」这个问题没有答案，用户会带着一堆无处落地的标记停在一张空画布上。
 *
 * `showKeywordQuery`（cycle-111 / N-5）与 `showDiff` 同一条判据：关键词检索的**产出是一张
 * 子图**——种子要能点、命中集合要在画布上高亮，所以它必须有图可标。结构层与行为层都提供。
 *
 * ### 为什么运行时层刻意**不**加它
 *
 * 两个理由，任一独立成立：
 *   1. 运行时层的可用集合是 `RUNTIME_PANELS`（只有 `showRuntime` + 两个全局叠加层），
 *      它的职责是 Trace / 日志 / 性能排查；关键词检索是**图查询**，在这一层没有落地面。
 *   2. 更硬的一条：本仓踩过「`ViewLayer` 三个成员只有两个可达」的坑
 *      （`docs/需求分析.md` §59.x）——一个可读但永不可达的成员会让「能力矩阵」变成叙事。
 *      反过来同样成立：往 `RUNTIME_PANELS` 里加一个在这一层永远点不出结果的入口，
 *      就是给用户一个死按钮。`tests/unit/viewModeUtils.test.ts` 的层矩阵用例对
 *      三层逐层断言 `showKeywordQuery` 的有无，两个方向都钉住。
 *
 * `showPathPattern`（cycle-135 / 璇玑图 ρ）与 `showKeywordQuery` **同一条判据**：
 * ρ 路径模式枚举的是**图上的路径序列**，结果要能被渲染（路径列表 + 起止节点），
 * 因此它需要一层有图的视图。运行时层没有图，故不在 `RUNTIME_PANELS` 里。
 *
 * 为什么它和 `showKeywordQuery` 是两个独立键而不是合并：ρ 的输入是**结构化模式文本**
 * （边类型序列正则），关键词检索的输入是**自由文本**；两者的提交语义、诊断形态
 * （拼错类型名 vs 语法错误）、结果形状（路径列表 vs 子图）都不同。合并成一个面板
 * 会让「为什么这一项要打字」从分组标题读不出来——与 `DIFF_ITEMS` / `KEYWORD_QUERY_ITEMS`
 * 是同一个理由。
 */
export const STRUCTURAL_PANELS: Set<AnalysisPanelKey> = new Set([
  'showSearch', 'showPathFind', 'showHealthScore', 'showRules', 'showImport', 'showFilterPanel',
  'showDeadCode',
  'showDiff',
  'showKeywordQuery',
  'showPathPattern',
  // showViews（cycle-143）：Π 视图划分读的是「当前图」的划分事实，与 showDiff/
  // showKeywordQuery 同一条判据——需要一层有图的视图。运行时层没有图，不提供。
  'showViews',
  'showMiniMap', 'showLegend',
]);

export const BEHAVIORAL_PANELS: Set<AnalysisPanelKey> = new Set([
  'showCallChain', 'showCycles', 'showImpact', 'showInheritance', 'showHotspot', 'showGodModule', 'showCoreFunction',
  'showDeadCode',
  'showDiff',
  'showKeywordQuery',
  'showPathPattern',
  'showViews',
  'showSearch', 'showPathFind', 'showMiniMap', 'showLegend',
]);

/**
 * 运行时层的可用面板集合（cycle-88）。
 *
 * 之前这里是 `getAvailablePanels` 内联的 `new Set([...])`，每次调用都新建对象，
 * 于是 `getAvailablePanels('runtime') === getAvailablePanels('runtime')` 为
 * false，无法与 structural/behavioral 两个模块级常量对齐。三层的可用集合
 * 属于同一类事实，必须同构，否则「运行时层能不能开某个面板」这个问题会有
 * 两种答案形状。
 *
 * 集合刻意最小（独立面板 + 两个全局叠加层）：运行时层的职责是「Trace / 日志 /
 * 性能排查」（`docs/图谱按需加载.md:196-200`），图分析类面板在该层没有数据面，
 * 让它们出现在工具下拉里只会产生点击无反应的死入口。
 */
export const RUNTIME_PANELS: Set<AnalysisPanelKey> = new Set([
  'showRuntime',
  'showMiniMap', 'showLegend',
]);

export function getAvailablePanels(layer: ViewLayer): Set<AnalysisPanelKey> {
  switch (layer) {
    case 'structural':
      return STRUCTURAL_PANELS;
    case 'behavioral':
      return BEHAVIORAL_PANELS;
    case 'runtime':
      return RUNTIME_PANELS;
    default:
      return assertNever(layer);
  }
}
