import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId as makeNodeId, EdgeId } from '../../types/index.ts';
import type { DiagramAssembler, AssembledDiagram } from './DiagramAssembler.ts';
import { computeDepths } from './DiagramAssembler.ts';
import { getTopLevelDir } from '../../shared/pathUtils.ts';



const DEPENDENCY_EDGE_TYPES = new Set(['import', 'dependency']);

export class DependencyAssembler implements DiagramAssembler {
  assemble(nodes: GraphNode[], edges: GraphEdge[]): AssembledDiagram {

    const depEdges = edges.filter((e) => DEPENDENCY_EDGE_TYPES.has(e.type));

    const dirNodes = new Map<string, GraphNode>();
    const dirChildCount = new Map<string, number>();
    const dirTypeDist = new Map<string, Record<string, number>>();

    for (const n of nodes) {
      const dir = getTopLevelDir(n.filePath, { simplified: true });
      if (!dirNodes.has(dir)) {
        dirNodes.set(dir, {
          id: makeNodeId(`depdir:${dir}`),
          label: dir === '/' ? 'root' : dir,
          type: 'module',
          filePath: dir,
          lineNumber: 0,
          properties: {
            isDependencyDir: true,
            directory: dir,
          },
        });
        dirChildCount.set(dir, 0);
        dirTypeDist.set(dir, {});
      }
      dirChildCount.set(dir, (dirChildCount.get(dir) ?? 0) + 1);

      const dist = dirTypeDist.get(dir)!;
      dist[n.type] = (dist[n.type] ?? 0) + 1;
    }

    const nodeIdToDir = new Map<string, string>();
    for (const n of nodes) {
      nodeIdToDir.set(n.id, getTopLevelDir(n.filePath, { simplified: true }));
    }

    const aggregatedEdges = new Map<string, { source: string; target: string; count: number; types: Set<string> }>();
    for (const e of depEdges) {
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

    const depEdgeList: GraphEdge[] = [];
    let edgeIdx = 0;
    for (const [, agg] of aggregatedEdges) {
      const sourceDirId = `depdir:${agg.source}`;
      const targetDirId = `depdir:${agg.target}`;
      if (!dirNodes.has(agg.source) || !dirNodes.has(agg.target)) continue;

      depEdgeList.push({
        id: EdgeId(`dep-edge:${edgeIdx++}`),
        source: makeNodeId(sourceDirId),
        target: makeNodeId(targetDirId),
        type: agg.types.has('import') ? 'import' : 'dependency',
        properties: {
          aggregatedCount: agg.count,
          isDependencyEdge: true,
        },
      });
    }

    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    for (const e of depEdgeList) {
      outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }

    const rootIds: string[] = [];
    for (const [, dirNode] of dirNodes) {
      if ((inDegree.get(dirNode.id) ?? 0) === 0) rootIds.push(dirNode.id);
    }

    const depEdgeMap = new Map<string, GraphEdge[]>();
    for (const e of depEdgeList) {
      const list = depEdgeMap.get(e.source) ?? [];
      list.push(e);
      depEdgeMap.set(e.source, list);
    }
    const depthMap = computeDepths(rootIds, depEdgeMap, 'target');

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
      const umlLabel = `${dirNode.label}\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${childCount} items${typeSummary ? '\n' + typeSummary : ''}`;

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
      edges: depEdgeList,
      metadata: {
        rootIds,
        maxDepth,
        nodeCount: assembledNodes.length,
        edgeCount: depEdgeList.length,
      },
    };
  }

}
