import { NodeId } from '../../../types/index.ts';
import type { GraphNode, GraphEdge } from '../../../types/index.ts';
import type { ClusterNode, ClusterResult } from './types.ts';
import { aggregateEdges } from './types.ts';

function getTopLevelDir(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  if (parts.length <= 2) return filePath;
  let startIdx = 0;
  if (/^[A-Za-z]:$/.test(parts[0]!)) startIdx = 1;
  if (parts[0] === 'crates' && parts.length >= 2) {
    return `crates/${parts[1]}`;
  }
  if (parts[startIdx] === 'src' || parts[startIdx] === 'lib' || parts[startIdx] === 'app') {
    return parts.slice(startIdx, startIdx + 2).join('/');
  }
  return parts.slice(startIdx, startIdx + 2).join('/');
}

function getDependencyGroup(node: GraphNode): string | null {
  const depType = node.properties?.depType;
  if (typeof depType === 'string') {
    return `dep:${depType}`;
  }
  return null;
}

function getDirLabel(dirPath: string): string {
  const parts = dirPath.split('/');
  return parts[parts.length - 1] ?? dirPath;
}

function getFileLabel(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}


export function computeProgressiveClusters(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  expandedNodeIds: Set<string>,
): ClusterResult {
  const visibleNodes: (GraphNode | ClusterNode)[] = [];
  const nodeIdToVisibleId = new Map<string, string>();

  // Separate expanded IDs by type
  const expandedDirs = new Set<string>();
  const expandedFileClusters = new Set<string>();
  const expandedFuncClusters = new Set<string>();

  for (const id of expandedNodeIds) {
    if (id.startsWith('cluster__')) {
      expandedDirs.add(id);
    } else if (id.startsWith('filecluster__file__')) {
      expandedFileClusters.add(id);
    } else if (id.startsWith('funccluster__')) {
      expandedFuncClusters.add(id);
    }
  }

  // Step 1: Group nodes by top-level directory
  const nodeToDir = new Map<string, string>();
  const dirToNodes = new Map<string, GraphNode[]>();

  for (const n of rawNodes) {
    const depGroup = getDependencyGroup(n);
    const dir = depGroup ?? (n.filePath ? getTopLevelDir(n.filePath) : n.id);
    nodeToDir.set(n.id, dir);
    const list = dirToNodes.get(dir);
    if (list) list.push(n);
    else dirToNodes.set(dir, [n]);
  }

  // Step 2: For each directory, decide what to show
  for (const [dirPath, nodes] of dirToNodes) {
    const clusterId = `cluster__${dirPath.replace(/[/:\\]/g, '__')}`;

    if (expandedDirs.has(clusterId) || expandedDirs.has(dirPath)) {
      // Directory is expanded → show file-level clusters inside
      const fileGroups = new Map<string, GraphNode[]>();


      for (const n of nodes) {
        if (n.type === 'module') {
          // Module nodes are shown directly (they represent files)
          const fileClusterId = `filecluster__file__${(n.parentId ?? n.filePath ?? n.id).replace(/[/:\\]/g, '__')}`;
          if (expandedFileClusters.has(fileClusterId)) {
            // File cluster is expanded → show function-level nodes inside
            // Find all non-module nodes whose parentId matches this module
            const childNodes = rawNodes.filter(
              (rn) => rn.parentId === n.id || rn.filePath === n.filePath,
            );
            if (childNodes.length > 0) {
              // Show module node + its function children
              visibleNodes.push(n);
              nodeIdToVisibleId.set(n.id, n.id);
              for (const child of childNodes) {
                if (child.id === n.id) continue;
                visibleNodes.push(child);
                nodeIdToVisibleId.set(child.id, child.id);
              }
            } else {
              // No children → just show the module node
              visibleNodes.push(n);
              nodeIdToVisibleId.set(n.id, n.id);
            }
          } else {
            // File cluster not expanded → show as file-level cluster
            const childNodes = rawNodes.filter(
              (rn) => rn.parentId === n.id || (rn.filePath === n.filePath && rn.id !== n.id),
            );
            if (childNodes.length > 0) {
              const fileClusterNodeId = `filecluster__file__${(n.parentId ?? n.filePath ?? n.id).replace(/[/:\\]/g, '__')}`;
              nodeIdToVisibleId.set(n.id, fileClusterNodeId);
              for (const child of childNodes) {
                nodeIdToVisibleId.set(child.id, fileClusterNodeId);
              }
              const clusterNode: ClusterNode = {
                id: NodeId(fileClusterNodeId),
                label: `${n.label} (${childNodes.length + 1})`,
                type: 'module',
                filePath: n.filePath,
                lineNumber: 0,
                properties: {},
                isCluster: true,
                childCount: childNodes.length + 1,
                childIds: [n.id, ...childNodes.map((c) => c.id)],
                clusterPath: n.filePath ?? n.id,
                clusterLevel: 'file',
              };
              visibleNodes.push(clusterNode);
            } else {
              // No children → show module node directly
              visibleNodes.push(n);
              nodeIdToVisibleId.set(n.id, n.id);
            }
          }
        } else {
          // Non-module node inside expanded directory
          const parentFileId = n.parentId ?? n.filePath;
          if (parentFileId) {
            const fileClusterId = `filecluster__file__${parentFileId.replace(/[/:\\]/g, '__')}`;
            if (expandedFileClusters.has(fileClusterId)) {
              // File cluster expanded → show node directly
              visibleNodes.push(n);
              nodeIdToVisibleId.set(n.id, n.id);
            } else {
              // File cluster not expanded → group by file
              nodeIdToVisibleId.set(n.id, fileClusterId);
              const list = fileGroups.get(fileClusterId);
              if (list) list.push(n);
              else fileGroups.set(fileClusterId, [n]);
            }
          } else {
            visibleNodes.push(n);
            nodeIdToVisibleId.set(n.id, n.id);
          }
        }
      }

      // Create file-level cluster nodes for non-module nodes grouped by file
      for (const [fileClusterId, children] of fileGroups) {
        const parentFileId = children[0]?.parentId ?? children[0]?.filePath ?? '';
        const parentNode = rawNodes.find((n) => n.id === parentFileId || n.filePath === parentFileId);
        const clusterNode: ClusterNode = {
          id: NodeId(fileClusterId),
          label: `${parentNode?.label ?? getFileLabel(parentFileId)} (${children.length})`,
          type: 'module',
          filePath: parentNode?.filePath ?? parentFileId,
          lineNumber: 0,
          properties: {},
          isCluster: true,
          childCount: children.length,
          childIds: children.map((c) => c.id),
          clusterPath: parentFileId,
          clusterLevel: 'file',
        };
        visibleNodes.push(clusterNode);
      }
    } else {
      // Directory not expanded → show as directory-level cluster
      const childIds = nodes.map((n) => n.id);
      const clusterNode: ClusterNode = {
        id: NodeId(clusterId),
        label: `${getDirLabel(dirPath)} (${nodes.length})`,
        type: 'module',
        filePath: dirPath,
        lineNumber: 0,
        properties: {},
        isCluster: true,
        childCount: nodes.length,
        childIds,
        clusterPath: dirPath,
        clusterLevel: 'directory',
      };
      visibleNodes.push(clusterNode);
      for (const n of nodes) {
        nodeIdToVisibleId.set(n.id, clusterId);
      }
    }
  }

  const visibleEdges = aggregateEdges(rawEdges, nodeIdToVisibleId, 'cluster__');

  return { nodes: visibleNodes, edges: visibleEdges };
}