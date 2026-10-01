
import { GraphErrorBoundary } from './ErrorBoundary.tsx';
import { StatsPanel } from './StatsPanel.tsx';
import { HotspotPanel } from './HotspotPanel.tsx';
import { GodModulePanel } from './GodModulePanel.tsx';
import { CoreFunctionPanel } from './CoreFunctionPanel.tsx';
import { DeadCodePanel } from './DeadCodePanel.tsx';
import { FilterPanel } from './FilterPanel.tsx';
import { TourPanel } from './TourPanel.tsx';
import { ImpactPanel } from './ImpactPanel.tsx';
import { CyclePanel } from './CyclePanel.tsx';
import type { PanelState } from '../hooks/usePanelState.ts';
import type { HotspotNode, GodModule, ImpactStats } from '../hooks/useAnalysisPanels.ts';
import type { CoreFunction } from '../../shared/analysis/CoreFunctionAnalyzer.ts';
import type { DeadCodeResult } from '../../shared/analysis/DeadCodeAnalyzer.ts';
import type { CycleInfo } from '../renderer/CycleDetector.ts';

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
    godModuleStats: (n: number, e: number) => string;
  };
}

export function RightPanelStack(props: RightPanelStackProps) {
  const { panel, isCollapsed } = props;
  if (isCollapsed) return null;

  return (
    <div className="cg-panel-stack cg-panel-stack-right">
      {panel.showMiniMap && (
        <GraphErrorBoundary><StatsPanel
          counts={props.nodeTypeCounts}
          onClose={() => panel.setShowMiniMap(false)} thumbnail={props.thumbnail} viewportInfo={props.viewportInfo}
          onFocusArea={props.onFocusArea} /></GraphErrorBoundary>
      )}

      {panel.showHotspot && props.hotspotNodes.length > 0 && (
        <GraphErrorBoundary><HotspotPanel hotspotNodes={props.hotspotNodes} onClose={() => panel.setShowHotspot(false)} label={props.labels.hotspot} /></GraphErrorBoundary>
      )}

      {panel.showGodModule && props.godModules.length > 0 && (
        <GraphErrorBoundary><GodModulePanel godModules={props.godModules} onClose={() => panel.setShowGodModule(false)}
          label={props.labels.godModule} statsLabel={props.labels.godModuleStats} /></GraphErrorBoundary>
      )}

      {panel.showCoreFunction && props.coreFunctions.length > 0 && (
        <GraphErrorBoundary><CoreFunctionPanel coreFunctions={props.coreFunctions} onClose={() => panel.setShowCoreFunction(false)}
          label={props.labels.coreFunction} onSelectFunction={props.onSelectCoreFunction} /></GraphErrorBoundary>
      )}

      {panel.showDeadCode && props.deadCodeResult && props.deadCodeResult.deadNodes.length > 0 && (
        <GraphErrorBoundary><DeadCodePanel result={props.deadCodeResult} onClose={() => panel.setShowDeadCode(false)}
          label={props.labels.deadCode} onSelectNode={props.onSelectDeadNode} /></GraphErrorBoundary>
      )}

      {panel.showFilterPanel && (
        <GraphErrorBoundary><FilterPanel onClose={() => panel.setShowFilterPanel(false)} /></GraphErrorBoundary>
      )}

      {panel.showTour && (
        <GraphErrorBoundary><TourPanel tour={props.tourData as never} onClose={() => panel.setShowTour(false)} /></GraphErrorBoundary>
      )}

      {panel.showImpact && props.impactStats && (
        <GraphErrorBoundary><ImpactPanel impactStats={props.impactStats} label={props.labels.impact} totalLabel={props.labels.impactTotal} onClose={() => panel.setShowImpact(false)} /></GraphErrorBoundary>
      )}

      {panel.showCycles && props.cycleDetails.length > 0 && (
        <GraphErrorBoundary><CyclePanel cycles={props.cycleDetails} label={props.labels.cycles} emptyLabel={props.labels.cyclesEmpty} onClose={() => panel.setShowCycles(false)} /></GraphErrorBoundary>
      )}
    </div>
  );
}