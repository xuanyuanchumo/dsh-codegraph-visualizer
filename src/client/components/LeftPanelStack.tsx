import type { GraphNode, GraphEdge, ViewMode } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import { NodeId } from '../../types/index.ts';
import { GraphErrorBoundary } from './ErrorBoundary.tsx';
import { ImportPanel } from './ImportPanel.tsx';
import { Legend } from './Legend.tsx';
import { SearchBar, type SearchResultItem } from './SearchBar.tsx';
import { NodeDetail } from './NodeDetail.tsx';
import { PathBar } from './PathBar.tsx';
import { HealthScoreCard } from './HealthScoreCard.tsx';
import { RuleConfigPanel } from './RuleConfigPanel.tsx';
import type { PanelState } from '../hooks/usePanelState.ts';

interface LeftPanelStackProps {
  panel: PanelState;
  isCollapsed: boolean;
  searchQuery: string;
  searchResults: SearchResultItem[];
  searchMatchCount: number | null;
  onSearchChange: (q: string) => void;
  onSelectSearchResult: (id: string) => void;
  onFindPath: (sourceId: NodeId, targetId: NodeId) => void;
  onClearPath: () => void;
  pathResult: NodeId[] | null;
  ruleViolations: ReturnType<typeof Object> | unknown;
  onCheckRules: () => void;
  selectedNodeData: GraphNode | ClusterNode | null;
  onCloseDetail: () => void;
  expandedNodeIds: Set<string>;
  adjacencyMap: Map<string, { in: number; out: number }>;
  onCollapseNode: (id: string) => void;
  onSelectFunction: (node: GraphNode | ClusterNode, mode: 'cfg' | 'flowchart' | 'sequence') => void;
  onAggregateCallChain: (nodeId: string) => void;
  viewMode: ViewMode;
  currentWorkspace: string;
  prerequisites: { codegraph: boolean; lens: boolean };
  initStatus: 'idle' | 'initializing' | 'done' | 'error';
  watchEnabled: boolean;
  onSetGraphData: (nodes: GraphNode[], edges: GraphEdge[], workspace: string) => void;
  onSetLoading: (v: boolean) => void;
  onSetError: (e: string | null) => void;
  onSetInitStatus: (s: 'idle' | 'initializing' | 'done' | 'error') => void;
  onSetWatchEnabled: (v: boolean) => void;
}

export function LeftPanelStack(props: LeftPanelStackProps) {
  const { panel, isCollapsed } = props;
  if (isCollapsed) return null;

  return (
    <div className="cg-panel-stack cg-panel-stack-left">
      {panel.showSearch && (
        <GraphErrorBoundary><SearchBar query={props.searchQuery} matchCount={props.searchMatchCount}
          searchResults={props.searchResults}
          onChange={props.onSearchChange} onClose={() => panel.setShowSearch(false)}
          onSelectResult={props.onSelectSearchResult} /></GraphErrorBoundary>
      )}

      {panel.showPathFind && (
        <GraphErrorBoundary><PathBar onFindPath={props.onFindPath} onClearPath={props.onClearPath}
          pathResult={props.pathResult} pathLength={props.pathResult ? props.pathResult.length - 1 : null}
          onClose={() => panel.setShowPathFind(false)} /></GraphErrorBoundary>
      )}

      {panel.showHealthScore && (
        <GraphErrorBoundary><HealthScoreCard onClose={() => panel.setShowHealthScore(false)} /></GraphErrorBoundary>
      )}

      {panel.showRules && (
        <GraphErrorBoundary><RuleConfigPanel violations={props.ruleViolations as never} onCheckRules={props.onCheckRules}
          onClose={() => panel.setShowRules(false)} /></GraphErrorBoundary>
      )}

      {props.selectedNodeData && (
        <GraphErrorBoundary><NodeDetail node={props.selectedNodeData} onClose={props.onCloseDetail}
          isExpanded={props.expandedNodeIds.has(props.selectedNodeData.id)}
          connectionCount={(props.adjacencyMap.get(props.selectedNodeData.id)?.in ?? 0) + (props.adjacencyMap.get(props.selectedNodeData.id)?.out ?? 0)}
          onCollapse={() => props.selectedNodeData && props.onCollapseNode(props.selectedNodeData.id)}
          onSelectFunction={(node, mode) => props.onSelectFunction(node, mode)}
          onAggregateCallChain={props.onAggregateCallChain} /></GraphErrorBoundary>
      )}

      {panel.showLegend && (
        <GraphErrorBoundary><Legend viewMode={props.viewMode} onClose={() => panel.setShowLegend(false)} /></GraphErrorBoundary>
      )}

      {panel.showImport && (
        <GraphErrorBoundary><ImportPanel onClose={() => panel.setShowImport(false)} workspacePath={props.currentWorkspace}
          prerequisites={props.prerequisites} initStatus={props.initStatus} watchEnabled={props.watchEnabled}
          onSetGraphData={props.onSetGraphData} onSetLoading={props.onSetLoading} onSetError={props.onSetError}
          onSetInitStatus={props.onSetInitStatus} onSetWatchEnabled={props.onSetWatchEnabled} /></GraphErrorBoundary>
      )}
    </div>
  );
}