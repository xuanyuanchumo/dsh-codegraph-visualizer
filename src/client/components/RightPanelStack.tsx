import { StatsPanel } from './StatsPanel.tsx';
import { HotspotPanel } from './HotspotPanel.tsx';
import { GodModulePanel } from './GodModulePanel.tsx';
import { RegistryPanel } from './RegistryPanel.tsx';
import { CoreFunctionPanel } from './CoreFunctionPanel.tsx';
import { DeadCodePanel } from './DeadCodePanel.tsx';
import { FilterPanel } from './FilterPanel.tsx';
import { TourPanel } from './TourPanel.tsx';
import { ImpactPanel } from './ImpactPanel.tsx';
import { CyclePanel } from './CyclePanel.tsx';
import { RuntimePanel } from './RuntimePanel.tsx';
import { DiffPanel } from './DiffPanel.tsx';
import { KeywordQueryPanel } from './KeywordQueryPanel.tsx';
import { PathPatternPanel } from './PathPatternPanel.tsx';
import { useGraphStore } from '../store/graphStore.ts';
import { PanelStack, type PanelStackItem } from './PanelStack.tsx';
import type { PanelState } from '../hooks/usePanelState.ts';
import type { HotspotNode, GodModule, ImpactStats, ChurnStatus } from '../hooks/useAnalysisPanels.ts';
import type { CoreFunction } from '../../shared/analysis/CoreFunctionAnalyzer.ts';
import type { DeadCodeResult } from '../../shared/analysis/DeadCodeAnalyzer.ts';
import type { CycleInfo } from '../renderer/CycleDetector.ts';
import type { Tour } from '../../shared/analysis/TourBuilder.ts';
import type { DiffMarkStats } from '../../shared/diffStatus.ts';
import type { DiffState } from '../store/types.ts';

interface RightPanelStackProps {
  panel: PanelState;
  showRegistry?: boolean;
  onToggleRegistry?: (() => void) | undefined;
  isCollapsed: boolean;
  nodeTypeCounts: { function: number; class: number; variable: number; module: number; interface: number };
  thumbnail: string | null;
  viewportInfo: { zoom: number; pan: { x: number; y: number }; renderedSize: { w: number; h: number }; totalSize: { w: number; h: number } } | null;
  onFocusArea: (ratioX: number, ratioY: number) => void;
  hotspotNodes: HotspotNode[];
  /** 变更频率的取数状态；可选，缺省时热点面板退化为「只显示入度」。 */
  churnStatus?: ChurnStatus;
  godModules: GodModule[];
  /** God Module 扫描状态：区分「从未扫描」与「扫描后无结果」，驱动诚实空态。 */
  godModuleScan: { scanned: boolean; nodeCount: number };
  /** God Module 阈值（面板内可调，默认 50）。 */
  godModuleThreshold: number;
  /** 阈值变更回调（触发 useAnalysisPanels 重检测）。 */
  onGodModuleThresholdChange: (v: number) => void;
  coreFunctions: CoreFunction[];
  deadCodeResult: DeadCodeResult | null;
  impactStats: ImpactStats | null;
  cycleDetails: CycleInfo[];
  tourData: unknown;
  onSelectCoreFunction: (nodeId: string) => void;
  onSelectDeadNode: (nodeId: string) => void;
  /** 版本对比结果（研究报告 §六 #13）；`null` 表示尚未发起对比。 */
  diffResult: DiffState | null;
  diffMarkStats: DiffMarkStats | null;
  isDiffComparing: boolean;
  /** 已翻译的对比失败消息；`null` 表示没有错误。 */
  diffErrorMessage: string | null;
  onDiffCompare: (from: string, to: string) => void;
  onDiffClear: () => void;
  labels: {
    registry?: string;
    hotspot: string;
    godModule: string;
    coreFunction: string;
    deadCode: string;
    impact: string;
    impactTotal: string;
    cycles: string;
    cyclesEmpty: string;
    runtime: string;
    keywordQuery: string;
    pathPattern: string;
    godModuleStats: (n: number, e: number) => string;
    /** 扫描完成但无超标模块（诚实空态）。 */
    godModuleEmpty: string;
    /** 图还没加载（等待态）。 */
    godModuleWait: string;
    /** 阈值调节控件标签。 */
    godModuleThreshold: string;
  };
}

export function RightPanelStack(props: RightPanelStackProps) {
  const { panel, isCollapsed } = props;

  const items: PanelStackItem[] = [
    {
      visible: panel.showMiniMap,
      children: <StatsPanel
        counts={props.nodeTypeCounts}
        onClose={() => panel.setShowMiniMap(false)} thumbnail={props.thumbnail} viewportInfo={props.viewportInfo}
        onFocusArea={props.onFocusArea} />,
    },
    {
      visible: panel.showHotspot && props.hotspotNodes.length > 0,
      children: <HotspotPanel hotspotNodes={props.hotspotNodes} churnStatus={props.churnStatus} onClose={() => panel.setShowHotspot(false)} label={props.labels.hotspot} />,
    },
    {
      // cycle-113：可见门从「有结果」放宽为「已打开开关」——空态面板（阈值调节 + 诚实提示）
      // 本身就是功能；之前 13 节点桩图上整个功能静默不可达。
      visible: panel.showGodModule,
      children: <GodModulePanel godModules={props.godModules} godModuleScan={props.godModuleScan}
        threshold={props.godModuleThreshold} onThresholdChange={props.onGodModuleThresholdChange}
        onClose={() => panel.setShowGodModule(false)}
        label={props.labels.godModule} statsLabel={props.labels.godModuleStats}
        emptyLabel={props.labels.godModuleEmpty} waitLabel={props.labels.godModuleWait}
        thresholdLabel={props.labels.godModuleThreshold} />,
    },
    {
      visible: panel.showCoreFunction && props.coreFunctions.length > 0,
      children: <CoreFunctionPanel coreFunctions={props.coreFunctions} onClose={() => panel.setShowCoreFunction(false)}
        label={props.labels.coreFunction} onSelectFunction={props.onSelectCoreFunction} />,
    },
    {
      visible: panel.showDeadCode && !!props.deadCodeResult && props.deadCodeResult.deadNodes.length > 0,
      children: <DeadCodePanel result={props.deadCodeResult!} onClose={() => panel.setShowDeadCode(false)}
        label={props.labels.deadCode} onSelectNode={props.onSelectDeadNode} />,
    },
    {
      visible: panel.showFilterPanel,
      children: <FilterPanel onClose={() => panel.setShowFilterPanel(false)} />,
    },
    {
      visible: panel.showTour,
      children: <TourPanel tour={props.tourData as Tour} onClose={() => panel.setShowTour(false)} />,
    },
    {
      visible: panel.showRegistry ?? false,
      children: <RegistryPanel onClose={() => panel.setShowRegistry(false)} label={props.labels.registry ?? 'Registry'} />,
    },
    {
      visible: panel.showImpact && !!props.impactStats,
      children: <ImpactPanel impactStats={props.impactStats!} label={props.labels.impact} totalLabel={props.labels.impactTotal} onClose={() => panel.setShowImpact(false)} />,
    },
    {
      visible: panel.showCycles && props.cycleDetails.length > 0,
      children: <CyclePanel cycles={props.cycleDetails} label={props.labels.cycles} emptyLabel={props.labels.cyclesEmpty} onClose={() => panel.setShowCycles(false)} />,
    },
    {
      // 运行时层面板（cycle-88，P2-1）。刻意**不**附加任何「有没有数据」的前置条件：
      // 该面板的价值之一就是显示「窗口内没有数据」这一事实本身，若因空数据不渲染，
      // 用户点开开关却看不到任何反馈，会以为入口坏了。
      visible: panel.showRuntime,
      children: <RuntimePanel onClose={() => panel.setShowRuntime(false)} label={props.labels.runtime} />,
    },
    {
      // 版本对比面板（研究报告 §六 #13）。与运行时面板同一条判断：**不**加「有没有结果」
      // 的前置条件。首次打开时用户必须能看到两个输入框，否则「点开开关什么都没发生」。
      // 关闭按钮走 clearDiff：关闭面板即结束这次对比，标记必须一起从画布上消失，
      // 否则用户会看到一堆无法解释的彩色边框。
      visible: panel.showDiff,
      children: <DiffPanel
        diffResult={props.diffResult}
        markStats={props.diffMarkStats}
        isComparing={props.isDiffComparing}
        errorMessage={props.diffErrorMessage}
        onCompare={props.onDiffCompare}
        onClear={props.onDiffClear}
        onClose={() => { props.onDiffClear(); panel.setShowDiff(false); }}
      />,
    },
    {
      // 关键词图检索面板（cycle-111 / N-5）。与运行时/版本对比同一条判断：
      // **不**附加「有没有结果」的前置条件——首次打开必须能看到输入框，
      // 否则「点开开关什么都没发生」。
      //
      // 关闭时清空结果：`clearKeywordQuery` 会推进请求令牌，在途的旧请求因此
      // 无法把结果写回一个已经关闭的面板（否则下次打开会闪一下上一个词的结果）。
      visible: panel.showKeywordQuery,
      children: <KeywordQueryPanel
        label={props.labels.keywordQuery}
        onClose={() => {
          // 从 store 直接取动作而不经 props：这两个动作属于该面板自己的状态机，
          // 让 `RightPanelStack` 的 props 多背一层只会让"谁负责清空"更难回答。
          useGraphStore.getState().clearKeywordQuery();
          panel.setShowKeywordQuery(false);
        }}
      />,
    },
    {
      // ρ 路径模式面板（cycle-135 / 璇玑图 ρ）。与关键词检索同一条判断：
      // **不**附加「有没有结果」的前置条件——首次打开必须能看到输入框，
      // 否则「点开开关什么都没发生」。
      //
      // 关闭时清空结果：`clearPathPattern` 会推进请求令牌，在途的旧请求因此
      // 无法把结果写回一个已经关闭的面板。
      visible: panel.showPathPattern,
      children: <PathPatternPanel
        label={props.labels.pathPattern}
        onClose={() => {
          useGraphStore.getState().clearPathPattern();
          panel.setShowPathPattern(false);
        }}
      />,
    },
  ];

  return <PanelStack side="right" isCollapsed={isCollapsed} items={items} />;
}