import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId as makeNodeId, EdgeId } from '../../types/index.ts';
import type { DiagramAssembler, AssembledDiagram } from './DiagramAssembler.ts';
import { computeDepths } from './DiagramAssembler.ts';

const UML_SEPARATOR = '\u2500'.repeat(20);

export interface HierarchicalAssemblerConfig {
  nodePrefix: string;

  edgeIdPrefix: string;
  isDirProperty: string;
  isEdgeProperty: string;
  edgeTypes: Set<string>;
  getDirectory: (filePath: string) => string;
  getLabel: (dir: string) => string;
  filterNodes?: (nodes: GraphNode[]) => GraphNode[];
  excludeTypesFromDist?: Set<string>;
}

export abstract class HierarchicalAssembler implements DiagramAssembler {
  protected abstract config: HierarchicalAssemblerConfig;

  assemble(nodes: GraphNode[], edges: GraphEdge[]): AssembledDiagram {
    const cfg = this.config;
    const filteredNodes = cfg.filterNodes ? cfg.filterNodes(nodes) : nodes;
    const relevantEdges = edges.filter((e) => cfg.edgeTypes.has(e.type));

    const dirNodes = new Map<string, GraphNode>();
    const dirChildCount = new Map<string, number>();
    const dirTypeDist = new Map<string, Record<string, number>>();

    for (const n of filteredNodes) {
      const dir = cfg.getDirectory(n.filePath);
      if (!dirNodes.has(dir)) {
        dirNodes.set(dir, {
          id: makeNodeId(`${cfg.nodePrefix}:${dir}`),
          label: cfg.getLabel(dir),
          type: 'module',
          filePath: dir,
          lineNumber: 0,
          properties: {
            [cfg.isDirProperty]: true,
            directory: dir,
          },
        });
        dirChildCount.set(dir, 0);
        dirTypeDist.set(dir, {});
      }
      dirChildCount.set(dir, (dirChildCount.get(dir) ?? 0) + 1);

      const dist = dirTypeDist.get(dir)!;
      if (!cfg.excludeTypesFromDist?.has(n.type)) {
        dist[n.type] = (dist[n.type] ?? 0) + 1;
      }
    }

    const nodeIdToDir = new Map<string, string>();
    for (const n of filteredNodes) {
      nodeIdToDir.set(n.id, cfg.getDirectory(n.filePath));
    }

    const aggregatedEdges = new Map<string, { source: string; target: string; count: number; types: Set<string> }>();
    for (const e of relevantEdges) {
      const sourceDir = nodeIdToDir.get(e.source);
      const targetDir = nodeIdToDir.get(e.target);
      if (!sourceDir || !targetDir || sourceDir === targetDir) continue;

      const key = `${sourceDir}->${targetDir}`;
      const existing = aggregatedEdges.get(key);
      if (existing) {
        existing.count++;
        existing.types.add(e.type);
      } else {
        aggregatedEdges.set(key, {
          source: sourceDir,
          target: targetDir,
          count: 1,
          types: new Set([e.type]),
        });
      }
    }

    const edgeList: GraphEdge[] = [];
    let edgeIdx = 0;
    for (const [, agg] of aggregatedEdges) {
      const sourceId = `${cfg.nodePrefix}:${agg.source}`;
      const targetId = `${cfg.nodePrefix}:${agg.target}`;
      if (!dirNodes.has(agg.source) || !dirNodes.has(agg.target)) continue;

      edgeList.push({
        id: EdgeId(`${cfg.edgeIdPrefix}:${edgeIdx++}`),
        source: makeNodeId(sourceId),
        target: makeNodeId(targetId),
        type: agg.types.has('import') ? 'import' : 'dependency',
        properties: {
          aggregatedCount: agg.count,
          [cfg.isEdgeProperty]: true,
        },
      });
    }

    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    for (const e of edgeList) {
      outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }

    const rootIds: string[] = [];
    for (const [, dirNode] of dirNodes) {
      if ((inDegree.get(dirNode.id) ?? 0) === 0) rootIds.push(dirNode.id);
    }

    const edgeMap = new Map<string, GraphEdge[]>();
    for (const e of edgeList) {
      const list = edgeMap.get(e.source) ?? [];
      list.push(e);
      edgeMap.set(e.source, list);
    }
    const depthMap = computeDepths(rootIds, edgeMap, 'target');

    const assembledNodes: GraphNode[] = [];
    for (const [dir, dirNode] of dirNodes) {
      const childCount = dirChildCount.get(dir) ?? 0;
      const typeDist = dirTypeDist.get(dir) ?? {};
      const inDeg = inDegree.get(dirNode.id) ?? 0;
      const outDeg = outDegree.get(dirNode.id) ?? 0;
      const depth = depthMap.get(dirNode.id) ?? 0;

      const typeSummary = Object.entries(typeDist)
        .map(([t, c]) => `${t}: ${c}`)
        .join(', ');
      const umlLabel = `${dirNode.label}\n${UML_SEPARATOR}\n${childCount} items${typeSummary ? '\n' + typeSummary : ''}`;

      assembledNodes.push({
        ...dirNode,
        properties: {
          ...dirNode.properties,
          childCount,
          typeDistribution: typeDist,
          inDegree: inDeg,
          outDegree: outDeg,
          depth,
          isRoot: inDeg === 0,
          umlLabel,
        },
      });
    }

    const maxDepth = Math.max(0, ...depthMap.values());

    return {
      nodes: assembledNodes,
      edges: edgeList,
      metadata: {
        rootIds,
        maxDepth,
        nodeCount: assembledNodes.length,
        edgeCount: edgeList.length,
      },
    };
  }
}