import { useMemo } from 'react';
import type { GraphNode, GraphEdge } from '../../types/index.ts';
import type { CycleInfo } from '../renderer/CycleDetector.ts';
import { buildTour } from '../../shared/analysis/TourBuilder.ts';
import { isHostSizedIntegrationMode, type IntegrationMode } from '../../shared/constants.ts';
import type { useGraphDisplay } from './useGraphSelectors.ts';
import type { useGraphRenderer } from './useGraphRenderer.ts';
import type { useT } from '../i18n/index.ts';

type DiagramData = ReturnType<typeof useGraphDisplay>['diagramData'];
type RendererRef = ReturnType<typeof useGraphRenderer>['rendererRef'];
type TFunction = ReturnType<typeof useT>;

export interface GraphDerivedValuesParams {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rawNodes: GraphNode[];
  rawEdges: GraphEdge[];
  diagramData: DiagramData;
  expandedNodeIds: Set<string>;
  showCycles: boolean;
  collapsed: boolean;
  className: string;
  integrationMode: IntegrationMode;
  rendererRef: RendererRef;
  t: TFunction;
}

export interface GraphDerivedValues {
  statsText: string;
  expandedFunctionBodyCount: number;
  showFunctionBodyBudget: boolean;
  nodeTypeCounts: { function: number; class: number; variable: number; module: number; interface: number; type: number };
  cycleDetails: CycleInfo[];
  tourData: ReturnType<typeof buildTour>;
  panelClassName: string;
}

export function useGraphDerivedValues(params: GraphDerivedValuesParams): GraphDerivedValues {
  const { nodes, edges, rawNodes, rawEdges, diagramData, expandedNodeIds, showCycles, collapsed, className, integrationMode, rendererRef, t } = params;

  const statsText = useMemo(() => {
    const totalNodes = diagramData?.allNodes.length ?? nodes.length;
    const totalEdges = diagramData?.allEdges.length ?? edges.length;
    return t('stats.nodesEdges', { nodes: totalNodes, edges: totalEdges });
  }, [nodes.length, edges.length, diagramData, t]);

  const expandedFunctionBodyCount = useMemo(() => {
    const functionIdSet = new Set(rawNodes.filter(n => n.type === 'function').map(n => n.id as string));
    return [...expandedNodeIds].filter(id => functionIdSet.has(id)).length;
  }, [expandedNodeIds, rawNodes]);

  const showFunctionBodyBudget = expandedFunctionBodyCount > 0;

  const nodeTypeCounts = useMemo(() => {
    const counts = { function: 0, class: 0, variable: 0, module: 0, interface: 0, type: 0 };
    for (const n of rawNodes) { if (n.type in counts) counts[n.type as keyof typeof counts]++; }
    return counts;
  }, [rawNodes]);

  const cycleDetails = useMemo(() => {
    if (!showCycles) return [];
    return rendererRef.current?.detectCyclesDetailed() ?? [];
  }, [showCycles, nodes.length, edges.length, rendererRef]);

  const tourData = useMemo(() => buildTour(rawNodes, rawEdges), [rawNodes, rawEdges]);

  // `cg-resizable` is only meaningful where the panel owns its own geometry; in host-sized
  // integration modes the slot decides the size, so the drag handle would fight it.
  const panelClassName = useMemo(() => {
    const resizable = isHostSizedIntegrationMode(integrationMode) ? '' : 'cg-resizable';
    return `cg-graph-panel ${resizable} ${collapsed ? 'cg-collapsed' : ''} ${className}`.replace(/\s+/g, ' ').trim();
  }, [collapsed, className, integrationMode]);

  return { statsText, expandedFunctionBodyCount, showFunctionBodyBudget, nodeTypeCounts, cycleDetails, tourData, panelClassName };
}