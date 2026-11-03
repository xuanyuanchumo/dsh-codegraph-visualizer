import type { GraphNode, GraphEdge, ViewMode } from '../../types/index.ts';
import type { ClusterNode } from '../store/cluster/index.ts';
import { NodeId } from '../../types/index.ts';
import { ImportPanel } from './ImportPanel.tsx';
import { GraphManagePanel } from './GraphManagePanel.tsx';
import { Legend } from './Legend.tsx';
import { SearchBar, type SearchResultItem } from './SearchBar.tsx';
import { NodeDetail } from './NodeDetail.tsx';
import { PathBar } from './PathBar.tsx';
import { HealthScoreCard } from './HealthScoreCard.tsx';
import { RuleConfigPanel } from './RuleConfigPanel.tsx';
import { PanelStack, type PanelStackItem } from './PanelStack.tsx';
import type { PanelState } from '../hooks/usePanelState.ts';
import type { RuleViolation } from '../../shared/analysis/RuleEngine.ts';

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
  /** 枚举结果点击跳转（cycle-124 补遗）：选中 + reveal 入视野（GraphPanel 注入）。 */
  onJumpToNode?: (id: string) => void;
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
  /**
   * 「只看调用链」轻通路：只让渲染器高亮调用链，不切换视图。
   * 由 GraphPanel 注入，因为高亮需要 rendererRef（渲染器实例只在面板内可见）。
   */
  onHighlightCallChain: (nodeId: string) => void;
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

  const items: PanelStackItem[] = [
    {
      visible: panel.showSearch,
      children: <SearchBar query={props.searchQuery} matchCount={props.searchMatchCount}
        searchResults={props.searchResults}
        onChange={props.onSearchChange} onClose={() => panel.setShowSearch(false)}
        onSelectResult={props.onSelectSearchResult} />,
    },
    {
      visible: panel.showPathFind,
      children: <PathBar onFindPath={props.onFindPath} onClearPath={props.onClearPath}
        onJumpToNode={props.onJumpToNode}
        pathResult={props.pathResult} pathLength={props.pathResult ? props.pathResult.length - 1 : null}
        onClose={() => panel.setShowPathFind(false)} />,
    },
    {
      visible: panel.showHealthScore,
      children: <HealthScoreCard onClose={() => panel.setShowHealthScore(false)} />,
    },
    {
      visible: panel.showRules,
      children: <RuleConfigPanel violations={props.ruleViolations as RuleViolation[]} onCheckRules={props.onCheckRules}
        onClose={() => panel.setShowRules(false)} />,
    },
    {
      visible: !!props.selectedNodeData,
      children: props.selectedNodeData ? <NodeDetail node={props.selectedNodeData} onClose={props.onCloseDetail}
        isExpanded={props.expandedNodeIds.has(props.selectedNodeData.id)}
        connectionCount={(props.adjacencyMap.get(props.selectedNodeData.id)?.in ?? 0) + (props.adjacencyMap.get(props.selectedNodeData.id)?.out ?? 0)}
        onCollapse={() => props.selectedNodeData && props.onCollapseNode(props.selectedNodeData.id)}
        onSelectFunction={(node, mode) => props.onSelectFunction(node, mode)}
        onAggregateCallChain={props.onAggregateCallChain}
        onHighlightCallChain={props.onHighlightCallChain} /> : null,
    },
    {
      visible: panel.showLegend,
      children: <Legend viewMode={props.viewMode} onClose={() => panel.setShowLegend(false)} />,
    },
    {
      visible: panel.showImport,
      children: <ImportPanel onClose={() => panel.setShowImport(false)} workspacePath={props.currentWorkspace}
        prerequisites={props.prerequisites} initStatus={props.initStatus} watchEnabled={props.watchEnabled}
        onSetGraphData={props.onSetGraphData} onSetLoading={props.onSetLoading} onSetError={props.onSetError}
        onSetInitStatus={props.onSetInitStatus} onSetWatchEnabled={props.onSetWatchEnabled} />,
    },
    {
      visible: panel.showManage,
      children: <GraphManagePanel onClose={() => panel.setShowManage(false)} workspacePath={props.currentWorkspace}
        prerequisites={props.prerequisites} onSetLoading={props.onSetLoading} onSetError={props.onSetError} />,
    },
  ];

  return <PanelStack side="left" isCollapsed={isCollapsed} items={items} />;
}