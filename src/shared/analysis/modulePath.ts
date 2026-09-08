import type { GraphNode } from '../../types/index.ts';

export function normalizeFilePath(filePath: string): string {
  return filePath.replace(/^(file|import):/, '');
}

export function extractModulePath(filePath: string, maxDepth: number): string {
  const rawPath = normalizeFilePath(filePath);
  const parts = rawPath.split(/[\\/]/);
  const dirParts = parts.length > 1 ? parts.slice(0, -1) : [rawPath];
  return dirParts.length > maxDepth
    ? dirParts.slice(0, maxDepth).join('/')
    : dirParts.join('/');
}

export function buildModuleMap(nodes: GraphNode[], maxDepth: number): Map<string, string> {
  const moduleOfNode = new Map<string, string>();
  for (const node of nodes) {
    moduleOfNode.set(node.id, extractModulePath(node.filePath, maxDepth));
  }
  return moduleOfNode;
}