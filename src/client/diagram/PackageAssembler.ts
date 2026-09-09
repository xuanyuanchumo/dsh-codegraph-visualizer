import type { GraphNode, GraphEdge } from '../../types/index.ts';
import { NodeId as makeNodeId, EdgeId } from '../../types/index.ts';
import type { DiagramAssembler, AssembledDiagram } from './DiagramAssembler.ts';

function getDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return normalized.substring(0, lastSlash);
}

function getPackageLabel(dir: string): string {
  if (dir === '/') return 'root';
  const parts = dir.split('/');
  return parts[parts.length - 1] ?? dir;
}

export class PackageAssembler implements DiagramAssembler {
  assemble(nodes: GraphNode[], edges: GraphEdge[]): AssembledDiagram {
    const moduleNodes = nodes.filter((n) => n.type === 'module');
    const importEdges = edges.filter((e) => e.type === 'import' || e.type === 'dependency');

    const packageNodes = new Map<string, GraphNode>();
    const packageChildCount = new Map<string, number>();
    const packageTypeDist = new Map<string, Record<string, number>>();

    for (const n of moduleNodes) {
      const dir = getDirectory(n.filePath);
      if (!packageNodes.has(dir)) {
        packageNodes.set(dir, {
          id: makeNodeId(`pkg:${dir}`),
          label: getPackageLabel(dir),
          type: 'module',
          filePath: dir,
          lineNumber: 0,
          properties: {
            isPackage: true,
            directory: dir,
          },
        });
        packageChildCount.set(dir, 0);
        packageTypeDist.set(dir, {});
      }
      packageChildCount.set(dir, (packageChildCount.get(dir) ?? 0) + 1);
    }

    for (const n of nodes) {
      if (n.type === 'module') continue;
      const dir = getDirectory(n.filePath);
      if (!packageTypeDist.has(dir)) {
        packageNodes.set(dir, {
          id: makeNodeId(`pkg:${dir}`),
          label: getPackageLabel(dir),
          type: 'module',
          filePath: dir,
          lineNumber: 0,
          properties: {
            isPackage: true,
            directory: dir,
          },
        });
        packageChildCount.set(dir, 0);
        packageTypeDist.set(dir, {});
      }
      const dist = packageTypeDist.get(dir)!;
      dist[n.type] = (dist[n.type] ?? 0) + 1;
    }

    const nodeIdToDir = new Map<string, string>();
    for (const n of nodes) {
      nodeIdToDir.set(n.id, getDirectory(n.filePath));
    }

    const aggregatedEdges = new Map<string, { source: string; target: string; count: number; types: Set<string> }>();
    for (const e of importEdges) {
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

    const packageEdgeList: GraphEdge[] = [];
    let edgeIdx = 0;
    for (const [, agg] of aggregatedEdges) {
      const sourcePkgId = `pkg:${agg.source}`;
      const targetPkgId = `pkg:${agg.target}`;
      if (!packageNodes.has(agg.source) || !packageNodes.has(agg.target)) continue;

      packageEdgeList.push({
        id: EdgeId(`pkg-edge:${edgeIdx++}`),
        source: makeNodeId(sourcePkgId),
        target: makeNodeId(targetPkgId),
        type: agg.types.has('import') ? 'import' : 'dependency',
        properties: {
          aggregatedCount: agg.count,
          isPackageEdge: true,
        },
      });
    }

    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    for (const e of packageEdgeList) {
      outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }

    const rootIds: string[] = [];
    for (const [, pkgNode] of packageNodes) {
      if ((inDegree.get(pkgNode.id) ?? 0) === 0) rootIds.push(pkgNode.id);
    }

    const depthMap = this.computeDepths(rootIds, packageEdgeList);

    const assembledNodes: GraphNode[] = [];
    for (const [dir, pkgNode] of packageNodes) {
      const childCount = packageChildCount.get(dir) ?? 0;
      const typeDist = packageTypeDist.get(dir) ?? {};
      const inDeg = inDegree.get(pkgNode.id) ?? 0;
      const outDeg = outDegree.get(pkgNode.id) ?? 0;
      const depth = depthMap.get(pkgNode.id) ?? 0;

      const typeSummary = Object.entries(typeDist)
        .map(([t, c]) => `${t}: ${c}`)
        .join(', ');
      const umlLabel = `${pkgNode.label}\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n${childCount} items${typeSummary ? '\n' + typeSummary : ''}`;

      assembledNodes.push({
        ...pkgNode,
        properties: {
          ...pkgNode.properties,
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

    return {
      nodes: assembledNodes,
      edges: packageEdgeList,
      metadata: {
        rootIds,
        maxDepth: Math.max(0, ...depthMap.values()),
        nodeCount: assembledNodes.length,
        edgeCount: packageEdgeList.length,
      },
    };
  }

  private computeDepths(
    rootIds: string[],
    edges: GraphEdge[],
  ): Map<string, number> {
    const outEdges = new Map<string, string[]>();
    for (const e of edges) {
      const list = outEdges.get(e.source) ?? [];
      list.push(e.target);
      outEdges.set(e.source, list);
    }
    const depths = new Map<string, number>();
    const queue: Array<{ id: string; depth: number }> = rootIds.map((id) => ({ id, depth: 0 }));
    let head = 0;
    while (head < queue.length) {
      const { id, depth } = queue[head++]!;
      if (depths.has(id) && depths.get(id)! <= depth) continue;
      depths.set(id, depth);
      for (const target of (outEdges.get(id) ?? [])) {
        if (!depths.has(target) || depths.get(target)! > depth + 1) {
          queue.push({ id: target, depth: depth + 1 });
        }
      }
    }
    return depths;
  }
}