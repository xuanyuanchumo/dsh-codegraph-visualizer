/**
 * 展开代价缓存（cycle-110 Q7 行为等价提取，从 `progressiveCluster.ts` 抽出）。
 *
 * 抽取契约（行为等价，语义一条不改）：
 *   · 缓存以 **`rawNodes` 数组对象身份**为失效判据（`_rawNodesRef === rawNodes`），
 *     不是长度、不是内容比较。任何整图替换都会换掉这个引用，因此旧缓存自然失效。
 *   · `_clusterIdToCountCache` / `_normalizedDirToCountCache` / `_normalizedFileToCountCache`
 *     由 `getDirToNodesCache` / `getFileToNodesCache` **顺带重建**，`estimateExpandCost`
 *     用非空断言读它们——因此 `estimateExpandCost` 必须先调用对应的 getter（重构前后一致）。
 *   · `invalidateExpandCostCache()` 把 6 个静态量全部置空：这是 `disposeStore` 的唯一入口，
 *     漏掉任一个都会留下指向旧 `rawNodes` 的悬垂引用（CLAUDE.md 记录的既有教训）。
 *
 * 为什么单独成文件：这 6 个模块级静态量 + 4 个函数是本模块里唯一有状态的区域，与纯函数式的
 * 簇构造器混在一个文件会让「谁持有状态」难以看出；同时 band-detector 的按文件预算需要切开。
 */
import type { GraphNode } from '../../../types/index.ts';
import { getDependencyGroup } from './types.ts';
import { getTopLevelDir } from '../../../shared/pathUtils.ts';

let _dirToNodesCache: Map<string, GraphNode[]> | null = null;
let _fileToNodesCache: Map<string, GraphNode[]> | null = null;
let _clusterIdToCountCache: Map<string, number> | null = null;
let _normalizedDirToCountCache: Map<string, number> | null = null;
let _normalizedFileToCountCache: Map<string, number> | null = null;
let _rawNodesRef: GraphNode[] | null = null;

/** 目录 → 节点。同时重建 `cluster__…` 与归一化目录两张计数表。 */
function getDirToNodesCache(rawNodes: GraphNode[]): Map<string, GraphNode[]> {
  if (_rawNodesRef === rawNodes && _dirToNodesCache) return _dirToNodesCache;
  _rawNodesRef = rawNodes;
  _dirToNodesCache = new Map();
  _clusterIdToCountCache = new Map();
  _normalizedDirToCountCache = new Map();
  for (const n of rawNodes) {
    const depGroup = getDependencyGroup(n);
    // cycle-141 第五轮：dir: 前缀目录节点自己是分组锚（与 progressiveCluster
    // buildDirMapping / incrementalCluster 同一判定——三处必须一致，否则展开
    // 代价估算与实际分组漂移）。
    const isDirNode = String(n.id).startsWith('dir:');
    const dir = depGroup
      ?? (isDirNode ? String(n.id).slice(4) : n.filePath ? getTopLevelDir(n.filePath) : n.id);
    const list = _dirToNodesCache.get(dir);
    if (list) list.push(n);
    else _dirToNodesCache.set(dir, [n]);
  }
  for (const [dir, nodes] of _dirToNodesCache) {
    const normalized = dir.replace(/[/:\\]/g, '__');
    _clusterIdToCountCache.set(`cluster__${normalized}`, (_clusterIdToCountCache.get(`cluster__${normalized}`) ?? 0) + nodes.length);
    _normalizedDirToCountCache.set(normalized, (_normalizedDirToCountCache.get(normalized) ?? 0) + nodes.length);
  }
  return _dirToNodesCache;
}

/** 文件路径 → 节点。同时重建归一化文件计数表。 */
function getFileToNodesCache(rawNodes: GraphNode[]): Map<string, GraphNode[]> {
  if (_rawNodesRef === rawNodes && _fileToNodesCache) return _fileToNodesCache;
  _rawNodesRef = rawNodes;
  _fileToNodesCache = new Map();
  _normalizedFileToCountCache = new Map();
  for (const n of rawNodes) {
    if (n.filePath) {
      const list = _fileToNodesCache.get(n.filePath);
      if (list) list.push(n);
      else _fileToNodesCache.set(n.filePath, [n]);
    }
  }
  for (const [fp, nodes] of _fileToNodesCache) {
    const normalized = fp.replace(/[/:\\]/g, '__');
    _normalizedFileToCountCache.set(normalized, (_normalizedFileToCountCache.get(normalized) ?? 0) + nodes.length);
  }
  return _fileToNodesCache;
}

/** `disposeStore` 的唯一失效入口：6 个静态量必须一起清。 */
export function invalidateExpandCostCache(): void {
  _dirToNodesCache = null;
  _fileToNodesCache = null;
  _clusterIdToCountCache = null;
  _normalizedDirToCountCache = null;
  _normalizedFileToCountCache = null;
  _rawNodesRef = null;
}

/**
 * 估算展开一个簇要露出多少节点：返回「成员数 - 1」（簇自身已经占了一个位置），下限 0。
 *
 * 契约：三种簇 id 前缀（`subgroup__` / `cluster__` / `filecluster__`）各有自己的解析方式；
 * 只有 `filecluster__file__` 前缀带 `file__` 标记，其余按 `__` 还原 `/`。
 * 无法识别的 id 返回 0（不是 -1，避免调用方把负代价当成「免费」）。
 */
export function estimateExpandCost(nodeId: string, rawNodes: GraphNode[]): number {
  if (nodeId.startsWith('subgroup__')) {
    const parts = nodeId.split('__');
    const dirPart = parts.slice(1, -1).join('__');
    const clusterId = `cluster__${dirPart}`;
    getDirToNodesCache(rawNodes);
    const count = _clusterIdToCountCache!.get(clusterId) ?? 0;
    return Math.max(0, count - 1);
  }
  if (nodeId.startsWith('cluster__')) {
    const dirPath = nodeId.replace(/^cluster__/, '').replace(/__/g, '/');
    const cache = getDirToNodesCache(rawNodes);
    const nodes = cache.get(dirPath);
    if (nodes) return Math.max(0, nodes.length - 1);
    const normalized = nodeId.replace(/^cluster__/, '');
    const count = _normalizedDirToCountCache!.get(normalized) ?? 0;
    return Math.max(0, count - 1);
  }
  if (nodeId.startsWith('filecluster__')) {
    const filePath = nodeId.replace(/^filecluster__file__/, '').replace(/__/g, '/');
    const cache = getFileToNodesCache(rawNodes);
    const nodes = cache.get(filePath);
    if (nodes) return Math.max(0, nodes.length - 1);
    const normalized = nodeId.replace(/^filecluster__file__/, '');
    const count = _normalizedFileToCountCache!.get(normalized) ?? 0;
    return Math.max(0, count - 1);
  }
  return 0;
}
