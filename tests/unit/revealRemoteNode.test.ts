/**
 * revealRemoteNode 切片测试（cycle-133）。
 *
 * 覆盖「expand-then-reveal」完整闭环的四条分支 + 一条防回归契约：
 * 1. 节点已在显示层 ⇒ 直接选中，不发请求（幂等路径）；
 * 2. 节点不在 ⇒ /query depth=1 拉子图 → mergeAndRecluster 合并 → 选中 + 种子高亮；
 * 3. 载荷不含目标节点（上游对未知 id 返回空 seeds）⇒ 诚实失败 false，不合并无关节点；
 * 4. 请求失败/超时 ⇒ false；
 * 5. 防回归：合并走 mergeAndRecluster（只增不替换）——rawNodes 里合并前已有的节点
 *    必须原样保留（整图替换语义会清掉 outline/AST 与 etag 缓存，是 cycle-85 家族缺陷）。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGraphStore } from '../../src/client/store/graphStore.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';

function node(id: string, label = id): GraphNode {
  return { id: NodeId(id), label, type: 'function', filePath: `src/${id}.ts`, lineNumber: 1, properties: {} };
}
function edge(id: string, source: string, target: string): GraphEdge {
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type: 'call', properties: {} };
}

/** 构造 /query 成功响应体（与宿主 buildPayload 同形，seeds/nodes/edges 必备）。 */
function queryPayload(nodeIds: string[], edgeList: GraphEdge[], seedIds: string[]) {
  return {
    query: 'q',
    terms: ['q'],
    seeds: seedIds.map((id) => ({ id, label: id, score: 100, matchedTerms: ['q'] })),
    nodes: nodeIds.map((id) => node(id)),
    edges: edgeList,
    text: 'stub',
    tokens: 100,
    truncated: false,
    reason: 'fits',
    meta: { depth: 1, depthEffective: 1, tokenBudget: 800, source: 'slot', revision: 1, reason: 'fits' },
  };
}

function jsonResponse(body: unknown, etag = 'W/"t1"'): Response {
  return {
    ok: true,
    status: 200,
    headers: new Map([['etag', etag]]),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  useGraphStore.setState({
    rawNodes: [node('existing-1', 'Existing One')],
    rawEdges: [],
    selectedNodeId: null,
    highlightedNodeIds: [],
    currentWorkspace: '/test/ws',
    keywordQueryStatus: 'idle',
    keywordQueryResult: null,
    keywordQueryError: null,
    keywordQuerySeq: 0,
    keywordQuery: '',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('revealRemoteNode（cycle-133 · expand-then-reveal 闭环）', () => {
  it('节点已在显示层：直接选中并返回 true，不发请求（幂等路径）', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const ok = await useGraphStore.getState().revealRemoteNode('existing-1', 'existing-1');
    expect(ok).toBe(true);
    expect(useGraphStore.getState().selectedNodeId).toBe('existing-1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('节点不在显示层：拉 depth=1 子图 → 合并 → 选中 + 种子高亮，既有节点保留（只增不替换）', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(
      queryPayload(['remote-1', 'remote-2'], [edge('e-r1', 'remote-1', 'remote-2')], ['remote-1']),
    ));
    vi.stubGlobal('fetch', fetchSpy);
    const ok = await useGraphStore.getState().revealRemoteNode('remote-1', 'remote-1');
    expect(ok).toBe(true);
    const state = useGraphStore.getState();
    // 目标节点已进图并选中。
    expect(state.rawNodes.some((n) => n.id === 'remote-1')).toBe(true);
    expect(state.selectedNodeId).toBe('remote-1');
    // 种子高亮集合来自载荷的 seeds。
    expect(state.highlightedNodeIds).toContain('remote-1');
    // 防回归决定性断言：合并前就存在的节点必须原样保留（整图替换会把它清掉）。
    expect(state.rawNodes.some((n) => n.id === 'existing-1')).toBe(true);
    // 请求参数：q=节点id、depth=1（有界子图）。
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('q=remote-1'); // label 缺省=id（本测试节点 label=id）
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('depth=1');
  });

  it('载荷不含目标节点（上游对未知 id 返回空结果）⇒ false 且不合并无关节点', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
      queryPayload(['other-1'], [], []),
    )));
    const ok = await useGraphStore.getState().revealRemoteNode('ghost-node', 'ghost-node');
    expect(ok).toBe(false);
    const state = useGraphStore.getState();
    // 无关载荷不得进画布。
    expect(state.rawNodes.some((n) => n.id === 'other-1')).toBe(false);
    expect(state.selectedNodeId).not.toBe('ghost-node');
  });

  it('请求失败（网络错误）⇒ false（诚实失败，不假装成功）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    const ok = await useGraphStore.getState().revealRemoteNode('remote-1', 'remote-1');
    expect(ok).toBe(false);
    expect(useGraphStore.getState().selectedNodeId).not.toBe('remote-1');
  });
});
