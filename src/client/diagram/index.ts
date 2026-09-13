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
    { level: 0, name: 'layer.inheritance.0', nodeFilter: (n) => n.properties?.depth === 0 },
    { level: 1, name: 'layer.inheritance.1', nodeFilter: (n) => (n.properties?.depth as number) <= 2 },
    { level: 2, name: 'layer.inheritance.2', nodeFilter: () => true },
  ],
  callgraph: [
    { level: 0, name: 'layer.callgraph.0', nodeFilter: (n) => n.properties?.isEntry === true },
    { level: 1, name: 'layer.callgraph.1', nodeFilter: (n) => (n.properties?.depth as number) <= 2 },
    { level: 2, name: 'layer.callgraph.2', nodeFilter: () => true },
  ],
  package: [
    { level: 0, name: 'layer.package.0', nodeFilter: (n) => n.properties?.depth === 0 },
    { level: 1, name: 'layer.package.1', nodeFilter: (n) => (n.properties?.depth as number) <= 1 },
    { level: 2, name: 'layer.package.2', nodeFilter: () => true },
  ],
  class: [
    { level: 0, name: 'layer.class.0', nodeFilter: (n) => n.properties?.depth === 0 },
    { level: 1, name: 'layer.class.1', nodeFilter: (n) => (n.properties?.depth as number) <= 2 },
    { level: 2, name: 'layer.class.2', nodeFilter: () => true },
  ],
  code: [
    { level: 0, name: 'layer.code.0', nodeFilter: () => true },
    { level: 1, name: 'layer.code.1', nodeFilter: () => true },
    { level: 2, name: 'layer.code.2', nodeFilter: () => true },
  ],
  dependencies: [
    { level: 0, name: 'layer.dependencies.0', nodeFilter: (n) => n.properties?.depth === 0 },
    { level: 1, name: 'layer.dependencies.1', nodeFilter: (n) => (n.properties?.depth as number) <= 1 },
    { level: 2, name: 'layer.dependencies.2', nodeFilter: () => true },
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
): Promise<AssembledDiagram> {
  if (!filePath) {
    throw new Error('filePath is empty — cannot fetch AST');
  }
  if (!functionName) {
    throw new Error('functionName is empty — cannot locate function in AST');
  }

  let response: Response;
  try {
    response = await fetch('/api/v1/codegraph/ast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
  } catch (e) {
    throw new Error(`Network error: unable to reach AST endpoint`);
  }
  if (!response.ok) {
    const status = response.status;
    if (status === 400) {
      throw new Error(`Bad request: filePath "${filePath}" is invalid or workspace not configured`);
    }
    if (status === 403) {
      throw new Error(`Access denied: filePath "${filePath}" is outside workspace`);
    }
    if (status === 413) {
      throw new Error(`File too large for AST parsing: ${filePath}`);
    }
    if (status === 500) {
      const errorBody = await response.text();
      let serverMsg = '';
      try { const parsed = JSON.parse(errorBody); serverMsg = parsed.error || ''; } catch { serverMsg = errorBody; }
      throw new Error(serverMsg || `AST parsing failed for "${filePath}"`);
    }
    throw new Error(`AST request failed (HTTP ${status})`);
  }

  const astRoot: ASTNode = await response.json();
  if (!astRoot || !astRoot.children || astRoot.children.length === 0) {
    throw new Error(`AST is empty for "${filePath}" — parsing produced no nodes`);
  }

  switch (viewMode) {
    case 'cfg':
      return cfgAssembler.assemble(astRoot, filePath, functionName);
    case 'flowchart':
      return flowchartAssembler.assemble(astRoot, filePath, functionName);
    case 'sequence':
      return sequenceAssembler.assemble(astRoot, filePath, functionName);
    default:
      throw new Error(`Unsupported view mode: ${viewMode}`);
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
