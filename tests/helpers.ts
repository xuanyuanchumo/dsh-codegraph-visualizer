// Shared test helpers: build Branded graph elements without leaking bare strings.
import { NodeId, EdgeId, RepoId } from '../src/types/index.ts';
import type { GraphNode, GraphEdge, GraphData } from '../src/types/index.ts';
import type { PrerequisiteStatus } from '../src/shared/prerequisiteStatus.ts';

export function makeNode(
  id: string,
  label: string,
  type: GraphNode['type'],
  file: string,
  line: number,
  properties: Record<string, unknown> = {},
  parentId?: string,
): GraphNode {
  const node: GraphNode = { id: NodeId(id), label, type, filePath: file, lineNumber: line, properties };
  if (parentId) node.parentId = NodeId(parentId);
  return node;
}

export function makeEdge(
  id: string,
  source: string,
  target: string,
  type: GraphEdge['type'],
  properties: Record<string, unknown> = {},
): GraphEdge {
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type, properties };
}

export function makeGraphData(
  nodes: GraphNode[],
  edges: GraphEdge[],
  repoId = 'test-repo',
  timestamp = 1,
): GraphData {
  return {
    nodes,
    edges,
    metadata: { repoId: RepoId(repoId), timestamp, nodeCount: nodes.length, edgeCount: edges.length },
  };
}
/**
 * 能力位 fixture。
 *
 * 存在的理由（不是"少写几个字"）：`PrerequisiteStatus` 有五个字段（`codegraph` / `lens` /
 * `astSource` / `graphSource` / `builtin`），而能力位形状在 cycle-111 刚被拆开。若每个用例
 * 手写全量字面量，**新增一个位就要改 60+ 处**，而漏掉的那一处会以"缺字段"的形态在
 * typecheck 里爆一堆无关文件。更糟的是反向风险：手写字面量时人人都会抄上一个用例的值，
 * 于是"这个用例到底在验证哪一位"被样板掩盖 —— 本仓记录过「fixture 的默认值掩盖缺陷」。
 *
 * 因此：**用 `overrides` 显式声明本次关心的位**，其余位取保守缺省（全 `false`）。
 * `builtin` 由 `astSource` 派生（与宿主 `checkPrerequisites` 的规则一致），
 * 传 `builtin` 会被忽略 —— 别名不接受独立声明，否则两个来源迟早分叉。
 */
export function makePrerequisiteStatus(
  overrides: Partial<Omit<PrerequisiteStatus, 'builtin'>> = {},
): PrerequisiteStatus {
  const astSource = overrides.astSource ?? false;
  return {
    codegraph: overrides.codegraph ?? false,
    lens: overrides.lens ?? false,
    astSource,
    graphSource: overrides.graphSource ?? false,
    builtin: astSource,
  };
}
