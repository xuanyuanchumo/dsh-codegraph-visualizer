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
import type { AssembledDiagram, DiagramLayer, LayeredDiagram, DiagramAssembler } from './DiagramAssembler.ts';
import type { ASTNode } from '../../shared/CFGTypes.ts';
import { scoped } from '../../shared/Logger.ts';
import { fetchWithTimeout } from '../api/index.ts';

const log = scoped('diagram');
import { InheritanceAssembler } from './InheritanceAssembler.ts';
import { CallGraphAssembler } from './CallGraphAssembler.ts';
import { PackageAssembler } from './PackageAssembler.ts';
import { ClassAssembler } from './ClassAssembler.ts';
import { DependencyAssembler } from './DependencyAssembler.ts';
import { CFGAssembler } from './CFGAssembler.ts';
import { FlowchartAssembler } from './FlowchartAssembler.ts';
import { SequenceAssembler } from './SequenceAssembler.ts';

const macroAssemblerRegistry = new Map<ViewMode, DiagramAssembler>([
  ['inheritance', new InheritanceAssembler()],
  ['callgraph', new CallGraphAssembler()],
  ['package', new PackageAssembler()],
  ['class', new ClassAssembler()],
  ['dependencies', new DependencyAssembler()],
]);

interface MicroAssembler {
  assemble(astRoot: ASTNode, filePath: string, functionName: string): AssembledDiagram;
}

const microAssemblerRegistry = new Map<'cfg' | 'flowchart' | 'sequence', MicroAssembler>([
  ['cfg', new CFGAssembler()],
  ['flowchart', new FlowchartAssembler()],
  ['sequence', new SequenceAssembler()],
]);

export function registerMacroAssembler(viewMode: ViewMode, assembler: DiagramAssembler): void {
  macroAssemblerRegistry.set(viewMode, assembler);
}

export function registerMicroAssembler(viewMode: 'cfg' | 'flowchart' | 'sequence', assembler: MicroAssembler): void {
  microAssemblerRegistry.set(viewMode, assembler);
}

interface LayerDefinition {
  level: number;
  name: string;
  nodeFilter: (node: GraphNode, allNodes: GraphNode[], allEdges: GraphEdge[]) => boolean;
}

const LAYER_DEFINITIONS: Record<string, LayerDefinition[]> = {
  inheritance: [
    { level: 0, name: 'layer.inheritance.0', nodeFilter: (n) => (n.properties?.depth as number) <= 1 },
    { level: 1, name: 'layer.inheritance.1', nodeFilter: (n) => (n.properties?.depth as number) <= 3 },
    { level: 2, name: 'layer.inheritance.2', nodeFilter: () => true },
  ],
  callgraph: [
    { level: 0, name: 'layer.callgraph.0', nodeFilter: (n) => n.properties?.isEntry === true || (n.properties?.depth as number) <= 1 },
    { level: 1, name: 'layer.callgraph.1', nodeFilter: (n) => (n.properties?.depth as number) <= 3 },
    { level: 2, name: 'layer.callgraph.2', nodeFilter: () => true },
  ],
  package: [
    { level: 0, name: 'layer.package.0', nodeFilter: (n) => (n.properties?.depth as number) <= 1 },
    { level: 1, name: 'layer.package.1', nodeFilter: (n) => (n.properties?.depth as number) <= 3 },
    { level: 2, name: 'layer.package.2', nodeFilter: () => true },
  ],
  class: [
    { level: 0, name: 'layer.class.0', nodeFilter: (n) => (n.properties?.depth as number) <= 1 },
    { level: 1, name: 'layer.class.1', nodeFilter: (n) => (n.properties?.depth as number) <= 3 },
    { level: 2, name: 'layer.class.2', nodeFilter: () => true },
  ],
  code: [
    { level: 0, name: 'layer.code.0', nodeFilter: () => true },
    { level: 1, name: 'layer.code.1', nodeFilter: () => true },
    { level: 2, name: 'layer.code.2', nodeFilter: () => true },
  ],
  dependencies: [
    { level: 0, name: 'layer.dependencies.0', nodeFilter: (n) => (n.properties?.depth as number) <= 1 },
    { level: 1, name: 'layer.dependencies.1', nodeFilter: (n) => (n.properties?.depth as number) <= 3 },
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
        name: 'graphType.all',
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
  const assembler = macroAssemblerRegistry.get(viewMode);
  if (!assembler) return null;
  const result = assembler.assemble(nodes, edges);
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
  const assembler = microAssemblerRegistry.get('cfg');
  if (!assembler) throw new Error('CFG assembler not registered');
  return assembler.assemble(astRoot, filePath, functionName);
}

export function assembleFlowchart(
  astRoot: ASTNode,
  filePath: string,
  functionName: string,
): AssembledDiagram {
  const assembler = microAssemblerRegistry.get('flowchart');
  if (!assembler) throw new Error('Flowchart assembler not registered');
  return assembler.assemble(astRoot, filePath, functionName);
}

export function assembleSequence(
  astRoot: ASTNode,
  filePath: string,
  functionName: string,
): AssembledDiagram {
  const assembler = microAssemblerRegistry.get('sequence');
  if (!assembler) throw new Error('Sequence assembler not registered');
  return assembler.assemble(astRoot, filePath, functionName);
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
    response = await fetchWithTimeout('/api/v1/codegraph/ast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
  } catch (e) {
    log.warn('AST fetch failed', e);
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
      try { const parsed = JSON.parse(errorBody); serverMsg = parsed.error || ''; } catch (e) { log.warn('AST error body parse failed', e); serverMsg = errorBody; }
      throw new Error(serverMsg || `AST parsing failed for "${filePath}"`);
    }
    throw new Error(`AST request failed (HTTP ${status})`);
  }

  const astRoot: ASTNode = await response.json();
  if (!astRoot || !astRoot.children || astRoot.children.length === 0) {
    throw new Error(`AST is empty for "${filePath}" — parsing produced no nodes`);
  }

  const assembler = microAssemblerRegistry.get(viewMode);
  if (!assembler) {
    throw new Error(`Unsupported view mode: ${viewMode}`);
  }
  return assembler.assemble(astRoot, filePath, functionName);
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
