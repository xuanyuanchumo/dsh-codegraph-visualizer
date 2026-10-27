import { StatsPanel } from './StatsPanel.tsx';
import { HotspotPanel } from './HotspotPanel.tsx';
import { GodModulePanel } from './GodModulePanel.tsx';
import { CoreFunctionPanel } from './CoreFunctionPanel.tsx';
import { DeadCodePanel } from './DeadCodePanel.tsx';
import { FilterPanel } from './FilterPanel.tsx';
import { TourPanel } from './TourPanel.tsx';
import { ImpactPanel } from './ImpactPanel.tsx';
import { CyclePanel } from './CyclePanel.tsx';
import { RuntimePanel } from './RuntimePanel.tsx';
import { DiffPanel } from './DiffPanel.tsx';
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
  isCollapsed: boolean;
  nodeTypeCounts: { function: number; class: number; variable: number; module: number; interface: number };
  thumbnail: string | null;
  viewportInfo: { zoom: number; pan: { x: number; y: number }; renderedSize: { w: number; h: number }; totalSize: { w: number; h: number } } | null;
  onFocusArea: (ratioX: number, ratioY: number) => void;
  hotspotNodes: HotspotNode[];
  /** 变更频率的取数状态；可选，缺省时热点面板退化为「只显示入度」。 */
  churnStatus?: ChurnStatus;
  godModules: GodModule[];
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
    hotspot: string;
    godModule: string;
    coreFunction: string;
    deadCode: string;
    impact: string;
    impactTotal: string;
    cycles: string;
    cyclesEmpty: string;
    runtime: string;
    godModuleStats: (n: number, e: number) => string;
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
      visible: panel.showGodModule && props.godModules.length > 0,
      children: <GodModulePanel godModules={props.godModules} onClose={() => panel.setShowGodModule(false)}
        label={props.labels.godModule} statsLabel={props.labels.godModuleStats} />,
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
  ];

  return <PanelStack side="right" isCollapsed={isCollapsed} items={items} />;
}