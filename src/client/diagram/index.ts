export type { DiagramAssembler, AssembledDiagram, DiagramLayer, LayeredDiagram } from './DiagramAssembler.ts';
export { InheritanceAssembler } from './InheritanceAssembler.ts';
export { CallGraphAssembler } from './CallGraphAssembler.ts';
export { PackageAssembler } from './PackageAssembler.ts';
export { ClassAssembler } from './ClassAssembler.ts';
export { DependencyAssembler } from './DependencyAssembler.ts';
export { CFGAssembler } from './CFGAssembler.ts';
export { FlowchartAssembler } from './FlowchartAssembler.ts';
export { SequenceAssembler } from './SequenceAssembler.ts';
export { CallChainAggregator } from './CallChainAggregator.ts';
export type { ASTNode, BasicBlock, StatementInfo, CFGEdgeData, CFGData } from '../../shared/CFGTypes.ts';
export type { CallChainAggregateOptions, CallChainResult } from './CallChainAggregator.ts';
export type { Participant, ParticipantType, SequenceMessage, MessageType, CombinedFragment, FragmentType, FragmentOperand, SequenceData } from './SequenceTypes.ts';

import type { GraphNode, GraphEdge, ViewMode } from '../../types/index.ts';
import type { AssembledDiagram, DiagramLayer, LayeredDiagram } from './DiagramAssembler.ts';
import type { ASTNode } from '../../shared/CFGTypes.ts';
import { InheritanceAssembler } from './InheritanceAssembler.ts';
import { CallGraphAssembler } from './CallGraphAssembler.ts';
import { PackageAssembler } from './PackageAssembler.ts';
import { ClassAssembler } from './ClassAssembler.ts';
import { DependencyAssembler } from './DependencyAssembler.ts';
import { CFGAssembler } from './CFGAssembler.ts';
import { FlowchartAssembler } from './FlowchartAssembler.ts';
import { SequenceAssembler } from './SequenceAssembler.ts';

const inheritanceAssembler = new InheritanceAssembler();
const callGraphAssembler = new CallGraphAssembler();
const packageAssembler = new PackageAssembler();
const classAssembler = new ClassAssembler();
const dependencyAssembler = new DependencyAssembler();
const cfgAssembler = new CFGAssembler();
const flowchartAssembler = new FlowchartAssembler();
const sequenceAssembler = new SequenceAssembler();

interface LayerDefinition {
  level: number;
  name: string;
  nodeFilter: (node: GraphNode, allNodes: GraphNode[], allEdges: GraphEdge[]) => boolean;
}

const LAYER_DEFINITIONS: Record<string, LayerDefinition[]> = {
  inheritance: [
    { level: 0, name: '根接口概览', nodeFilter: (n) => n.properties?.depth === 0 },
    { level: 1, name: '2层继承深度', nodeFilter: (n) => (n.properties?.depth as number) <= 2 },
    { level: 2, name: '完整继承树', nodeFilter: () => true },
  ],
  callgraph: [
    { level: 0, name: '入口函数概览', nodeFilter: (n) => n.properties?.isEntry === true },
    { level: 1, name: '调用链2层', nodeFilter: (n) => (n.properties?.depth as number) <= 2 },
    { level: 2, name: '完整调用图', nodeFilter: () => true },
  ],
  package: [
    { level: 0, name: '顶层包概览', nodeFilter: (n) => n.properties?.depth === 0 },
    { level: 1, name: '子包展开', nodeFilter: (n) => (n.properties?.depth as number) <= 1 },
    { level: 2, name: '包内模块', nodeFilter: () => true },
  ],
  class: [
    { level: 0, name: '类概览', nodeFilter: (n) => n.properties?.depth === 0 },
    { level: 1, name: '类关系图', nodeFilter: (n) => (n.properties?.depth as number) <= 2 },
    { level: 2, name: '完整类图', nodeFilter: () => true },
  ],
  code: [
    { level: 0, name: '目录聚类', nodeFilter: () => true },
    { level: 1, name: '文件聚类', nodeFilter: () => true },
    { level: 2, name: '全部节点', nodeFilter: () => true },
  ],
  dependencies: [
    { level: 0, name: '目录依赖概览', nodeFilter: (n) => n.properties?.depth === 0 },
    { level: 1, name: '文件依赖', nodeFilter: (n) => (n.properties?.depth as number) <= 1 },
    { level: 2, name: '模块依赖', nodeFilter: () => true },
  ],
};

function sliceByLayer(
  allNodes: GraphNode[],
  allEdges: GraphEdge[],
  layerDef: LayerDefinition,
): DiagramLayer {
  const filteredNodes = allNodes.filter((n) => layerDef.nodeFilter(n, allNodes, allEdges));
  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = allEdges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );
  return {
    level: layerDef.level,
    name: layerDef.name,
    nodes: filteredNodes,
    edges: filteredEdges,
    nodeIds,
    edgeIds: new Set(filteredEdges.map((e) => e.id)),
  };
}

function buildLayeredDiagram(
  viewMode: ViewMode,
  assembled: AssembledDiagram,
): LayeredDiagram {
  const layerDefs = LAYER_DEFINITIONS[viewMode];
  if (!layerDefs) {
    return {
      viewMode,
      layers: [{
        level: 0,
        name: '全部',
        nodes: assembled.nodes,
        edges: assembled.edges,
        nodeIds: new Set(assembled.nodes.map((n) => n.id)),
        edgeIds: new Set(assembled.edges.map((e) => e.id)),
      }],
      currentLayer: 0,
      expandedNodes: new Set(),
      allNodes: assembled.nodes,
      allEdges: assembled.edges,
      metadata: assembled.metadata,
    };
  }

  const layers = layerDefs.map((def) =>
    sliceByLayer(assembled.nodes, assembled.edges, def),
  );

  return {
    viewMode,
    layers,
    currentLayer: 0,
    expandedNodes: new Set(),
    allNodes: assembled.nodes,
    allEdges: assembled.edges,
    metadata: assembled.metadata,
  };
}

export function assembleDiagram(
  viewMode: ViewMode,
  nodes: GraphNode[],
  edges: GraphEdge[],
): LayeredDiagram | null {
  let result: AssembledDiagram | null = null;
  switch (viewMode) {
    case 'inheritance':
      result = inheritanceAssembler.assemble(nodes, edges);
      break;
    case 'callgraph':
      result = callGraphAssembler.assemble(nodes, edges);
      break;
    case 'package':
      result = packageAssembler.assemble(nodes, edges);
      break;
    case 'class':
      result = classAssembler.assemble(nodes, edges);
      break;
    case 'dependencies':
      result = dependencyAssembler.assemble(nodes, edges);
      break;
    default:
      return null;
  }
  if (result) {
    const taggedNodes = result.nodes.map((n) => ({
      ...n,
      properties: { ...n.properties, diagramType: viewMode },
    }));
    const taggedEdges = result.edges.map((e) => ({
      ...e,
      properties: { ...e.properties, diagramType: viewMode },
    }));
    return buildLayeredDiagram(viewMode, { nodes: taggedNodes, edges: taggedEdges, metadata: result.metadata });
  }
  return null;
}

export function assembleCFG(
  astRoot: ASTNode,
  filePath: string,
  functionName: string,
): AssembledDiagram {
  return cfgAssembler.assemble(astRoot, filePath, functionName);
}

export function assembleFlowchart(
  astRoot: ASTNode,
  filePath: string,
  functionName: string,
): AssembledDiagram {
  return flowchartAssembler.assemble(astRoot, filePath, functionName);
}

export function assembleSequence(
  astRoot: ASTNode,
  filePath: string,
  functionName: string,
): AssembledDiagram {
  return sequenceAssembler.assemble(astRoot, filePath, functionName);
}

export async function assembleMicroDiagram(
  viewMode: 'cfg' | 'flowchart' | 'sequence',
  filePath: string,
  functionName: string,
): Promise<AssembledDiagram | null> {
  try {
    const response = await fetch('/api/v1/codegraph/ast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    if (!response.ok) return null;
    const astRoot: ASTNode = await response.json();
    switch (viewMode) {
      case 'cfg':
        return cfgAssembler.assemble(astRoot, filePath, functionName);
      case 'flowchart':
        return flowchartAssembler.assemble(astRoot, filePath, functionName);
      case 'sequence':
        return sequenceAssembler.assemble(astRoot, filePath, functionName);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function getLayerDefinitions(viewMode: ViewMode): LayerDefinition[] | null {
  return LAYER_DEFINITIONS[viewMode] ?? null;
}

export function getLayerData(
  layered: LayeredDiagram,
  layer: number,
): DiagramLayer | null {
  if (layer < 0 || layer >= layered.layers.length) return null;
  return layered.layers[layer] ?? null;
}
