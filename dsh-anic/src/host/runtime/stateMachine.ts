/**
 * 工作流状态机（F1，M2-a）。
 *
 * 读 workflow-graph.yaml（或快照的 graph 结构），跟踪节点状态，
 * advance(nodeId, record) / check(strict) / getCurrentState()。
 *
 * 门禁是唯一暂停点：没有 approved record 不能越过 gate 节点（INV-1）。
 * 状态：pending → running → done / blocked。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type NodeStatus = 'pending' | 'running' | 'done' | 'blocked';

export interface WorkflowNode {
  id: string;
  type: 'Play' | 'Artifact' | 'Gate' | 'Trigger';
  produces?: string;
  gate?: string;
  done_status?: string;
  triggers?: string[];
}

export interface WorkflowEdge {
  from: string;
  to: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface NodeState {
  nodeId: string;
  status: NodeStatus;
  gateApproved?: boolean;
  updatedAt: string;
}

export interface StateMachineResult {
  ok: boolean;
  state: Record<string, NodeState>;
  reason?: string;
}

/** 从 .cycles/workflow-graph.yaml 加载图（简化解析：提取 nodes/edges）。 */
export function loadWorkflowGraph(cyclesDir: string): WorkflowGraph | null {
  const p = join(cyclesDir, 'workflow-graph.yaml');
  if (!existsSync(p)) return null;
  const text = readFileSync(p, 'utf-8');
  return parseWorkflowGraph(text);
}

/** 从 workflow-graph.yaml 文本解析（行级，零依赖）。 */
export function parseWorkflowGraph(text: string): WorkflowGraph {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  let currentNode: WorkflowNode | null = null;

  for (const line of text.split('\n')) {
    const nodeMatch = line.match(/^\s*-?\s*id:\s*(\S+)/);
    if (nodeMatch?.[1]) {
      currentNode = { id: nodeMatch[1], type: 'Play' };
      nodes.push(currentNode);
      continue;
    }
    if (currentNode) {
      const typeMatch = line.match(/^\s*type:\s*(\S+)/);
      if (typeMatch?.[1]) {
        currentNode.type = typeMatch[1] as WorkflowNode['type'];
        continue;
      }
      const gateMatch = line.match(/^\s*gate:\s*(\S+)/);
      if (gateMatch?.[1]) {
        currentNode.gate = gateMatch[1];
        continue;
      }
      const triggersMatch = line.match(/^\s*triggers:\s*\[(.+)\]/);
      if (triggersMatch?.[1]) {
        currentNode.triggers = triggersMatch[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
        continue;
      }
    }
    const edgeMatch = line.match(/^\s*-?\s*from:\s*(\S+)\s+to:\s*(\S+)/);
    if (edgeMatch?.[1] && edgeMatch?.[2]) {
      edges.push({ from: edgeMatch[1], to: edgeMatch[2] });
    }
  }
  return { nodes, edges };
}

/** 从 workflow-state.json 加载当前状态。 */
export function loadState(cyclesDir: string): Record<string, NodeState> {
  const p = join(cyclesDir, 'workflow-state.json');
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    return raw?.nodeStatus ?? raw ?? {};
  } catch {
    return {};
  }
}

/** 初始化状态：所有节点 pending。 */
export function initState(graph: WorkflowGraph): Record<string, NodeState> {
  const state: Record<string, NodeState> = {};
  const now = new Date().toISOString();
  for (const node of graph.nodes) {
    state[node.id] = { nodeId: node.id, status: 'pending', updatedAt: now };
  }
  return state;
}

/** 预计算图索引：节点 Map + 前驱邻接表，O(1) 查找（advance 热路径优化）。 */
export interface WorkflowGraphIndex {
  nodeMap: Map<string, WorkflowNode>;
  predecessors: Map<string, string[]>;
}

export function buildGraphIndex(graph: WorkflowGraph): WorkflowGraphIndex {
  const nodeMap = new Map<string, WorkflowNode>();
  for (const n of graph.nodes) nodeMap.set(n.id, n);
  const predecessors = new Map<string, string[]>();
  for (const e of graph.edges) {
    const arr = predecessors.get(e.to);
    if (arr) arr.push(e.from);
    else predecessors.set(e.to, [e.from]);
  }
  return { nodeMap, predecessors };
}

/**
 * 推进节点状态。
 * - Gate 节点需要 gateApproved=true 才能推进到 done。
 * - 前驱全部 done 才能推进（拓扑序）。
 */
export function advance(
  graph: WorkflowGraph,
  state: Record<string, NodeState>,
  nodeId: string,
  record?: { gateApproved?: boolean },
): StateMachineResult {
  // O(1) node lookup via precomputed index (was O(n) find)
  const idx = buildGraphIndex(graph);
  const node = idx.nodeMap.get(nodeId);
  if (!node) return { ok: false, state, reason: `unknown node: ${nodeId}` };

  // O(1) predecessor lookup via adjacency list (was O(e) filter)
  const preds = idx.predecessors.get(nodeId) ?? [];
  for (const pred of preds) {
    const ps = state[pred];
    if (!ps || ps.status !== 'done') {
      return { ok: false, state, reason: `predecessor ${pred} not done` };
    }
  }

  // Gate 节点需要批准
  if (node.type === 'Gate' && !record?.gateApproved) {
    return { ok: false, state, reason: `gate ${nodeId} requires gateApproved` };
  }

  const now = new Date().toISOString();
  state[nodeId] = {
    nodeId,
    status: 'done',
    gateApproved: record?.gateApproved,
    updatedAt: now,
  };
  return { ok: true, state };
}

/** 严格检查：所有 gate 节点必须有 approved record。 */
export function checkStrict(graph: WorkflowGraph, state: Record<string, NodeState>): StateMachineResult {
  for (const node of graph.nodes) {
    if (node.type === 'Gate') {
      const ns = state[node.id];
      if (!ns || ns.status !== 'done' || !ns.gateApproved) {
        return { ok: false, state, reason: `gate ${node.id} not approved` };
      }
    }
  }
  return { ok: true, state };
}
