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
import { PanelStack, type PanelStackItem } from './PanelStack.tsx';
import type { PanelState } from '../hooks/usePanelState.ts';
import type { HotspotNode, GodModule, ImpactStats } from '../hooks/useAnalysisPanels.ts';
import type { CoreFunction } from '../../shared/analysis/CoreFunctionAnalyzer.ts';
import type { DeadCodeResult } from '../../shared/analysis/DeadCodeAnalyzer.ts';
import type { CycleInfo } from '../renderer/CycleDetector.ts';
import type { Tour } from '../../shared/analysis/TourBuilder.ts';

interface RightPanelStackProps {
  panel: PanelState;
  isCollapsed: boolean;
  nodeTypeCounts: { function: number; class: number; variable: number; module: number; interface: number };
  thumbnail: string | null;
  viewportInfo: { zoom: number; pan: { x: number; y: number }; renderedSize: { w: number; h: number }; totalSize: { w: number; h: number } } | null;
  onFocusArea: (ratioX: number, ratioY: number) => void;
  hotspotNodes: HotspotNode[];
  godModules: GodModule[];
  coreFunctions: CoreFunction[];
  deadCodeResult: DeadCodeResult | null;
  impactStats: ImpactStats | null;
  cycleDetails: CycleInfo[];
  tourData: unknown;
  onSelectCoreFunction: (nodeId: string) => void;
  onSelectDeadNode: (nodeId: string) => void;
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
      children: <HotspotPanel hotspotNodes={props.hotspotNodes} onClose={() => panel.setShowHotspot(false)} label={props.labels.hotspot} />,
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
  ];

  return <PanelStack side="right" isCollapsed={isCollapsed} items={items} />;
}