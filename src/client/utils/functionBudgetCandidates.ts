import type { GraphEdge, GraphNode } from '../../types/index.ts';

/**
 * 收集 NodeDetail 预算区「展开更多 / 展开全部 / 收起全部」三个动作的候选函数体 id。
 *
 * 背景：`FUNCTION_BODY.MAX_EXPANDED`（默认 2）把同时展开的函数体数量限制在很小的
 * 范围内，因此预算提示必须提供出口，否则用户会误以为「图谱里没有这些函数」，而事实
 * 只是「按预算没有展开」。依据：docs/图谱按需加载.md 第五节「提供入口：展开更多 /
 * 只看调用链 / 展开全部（警告节点数）」，以及同文档风险 8「UI 必须明确：不是数据
 * 没有，而是按预算展开」。
 *
 * 候选优先级（高优先级的先入列，调用方可按顺序取「最相关的一个」）：
 *   1. 选中节点自身（若它本身就是函数体）—— 用户正看着它，最自然的期待是先展开它；
 *   2. 聚类子函数（`clusterChildIds`）—— 聚类节点的语义就是「这些函数被折叠了」；
 *   3. 调用邻居（`rawEdges` 上与 `node.id` 直接相连的另一端）—— 沿调用链继续展开；
 *   4. 当前视图已知的其它函数 —— 兜底，避免前三者皆空时入口永远不可用。
 *
 * 返回结果已去重、只含 `type === 'function'` 的节点。**不读 store、不过滤展开态**：
 * 「哪些还处于展开态」由调用方用 `expandedNodeIds` 划分（`展开更多` 取未展开的首个，
 * `收起全部` 取已展开的全部）。纯函数，便于单元测试直接覆盖优先级与去重规则。
 */
export function collectFunctionBodyCandidates(params: {
  node: GraphNode;
  rawNodes: readonly GraphNode[];
  rawEdges: readonly GraphEdge[];
  clusterChildIds?: readonly string[];
}): string[] {
  const { node, rawNodes, rawEdges, clusterChildIds } = params;
  const typeById = new Map<string, string>();
  for (const n of rawNodes) typeById.set(n.id as string, n.type);

  const result: string[] = [];
  const seen = new Set<string>();

  const push = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    if (typeById.get(id) !== 'function') return;
    result.push(id);
  };

  push(node.id as string);

  for (const id of clusterChildIds ?? []) push(id);

  for (const edge of rawEdges) {
    if (edge.source === node.id) push(edge.target as string);
    else if (edge.target === node.id) push(edge.source as string);
  }

  for (const n of rawNodes) {
    if (n.type === 'function') push(n.id as string);
  }

  return result;
}
