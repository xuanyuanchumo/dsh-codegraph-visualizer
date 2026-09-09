import type { GraphNode, GraphEdge, ViewMode } from '../../types/index.ts';

export interface AssembledDiagram {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    rootIds: string[];
    maxDepth: number;
    nodeCount: number;
    edgeCount: number;
  };
}

export interface DiagramLayer {
  level: number;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

export interface LayeredDiagram {
  viewMode: ViewMode;
  layers: DiagramLayer[];
  currentLayer: number;
  expandedNodes: Set<string>;
  allNodes: GraphNode[];
  allEdges: GraphEdge[];
  metadata: {
    rootIds: string[];
    maxDepth: number;
    nodeCount: number;
    edgeCount: number;
  };
}

export interface DiagramAssembler {
  assemble(nodes: GraphNode[], edges: GraphEdge[]): AssembledDiagram;
}