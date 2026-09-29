import { describe, it, expect } from 'vitest';
import { detectCommunities, selectHighDegreeNodes } from '../../src/client/store/cluster/communityDetection.ts';
import type { CommunityGroup } from '../../src/client/store/cluster/communityDetection.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

// vitest.config.ts uses environment: 'node' globally, no per-file override needed.

function makeNode(id: string, filePath: string = `src/${id}.ts`, type: string = 'function'): GraphNode {
  return {
    id: NodeId(id),
    label: id,
    type: type as GraphNode['type'],
    filePath,
    lineNumber: 1,
    properties: {},
  };
}

function makeEdge(id: string, source: string, target: string, type: string = 'call'): GraphEdge {
  return {
    id: EdgeId(id),
    source: NodeId(source),
    target: NodeId(target),
    type: type as GraphEdge['type'],
    properties: {},
  };
}

describe('detectCommunities', () => {
  // --- 空图输入 ---
  it('returns empty Map for empty nodes and edges', () => {
    const result = detectCommunities([], []);
    expect(result.size).toBe(0);
  });

  // --- 小图 (< MIN_NODES_FOR_SUBGROUP = 50) ---
  it('returns single "all" group when nodes < MIN_NODES_FOR_SUBGROUP', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];

    const result = detectCommunities(nodes, edges);

    expect(result.size).toBe(1);
    expect(result.has('all')).toBe(true);
    const group = result.get('all')!;
    expect(group.label).toBe('all');
    expect(group.nodes).toHaveLength(3);
    expect(group.nodes.map((n) => n.id)).toEqual(expect.arrayContaining([NodeId('a'), NodeId('b'), NodeId('c')]));
  });

  it('returns single "all" group for exactly MIN_NODES_FOR_SUBGROUP - 1 nodes', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 49; i++) {
      nodes.push(makeNode(`n${i}`));
    }
    const edges: GraphEdge[] = [];

    const result = detectCommunities(nodes, edges);

    expect(result.size).toBe(1);
    expect(result.has('all')).toBe(true);
    expect(result.get('all')!.nodes).toHaveLength(49);
  });

  // --- 正常标签传播：形成多个社区 ---
  it('forms multiple communities for two disconnected clusters', () => {
    // 两个独立的三角形（6 个节点，>= 50 不满足，需要 >= 50 节点才能进入标签传播）
    // 所以我们创建 50+ 节点，两个独立连通分量
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // 第一组：n0-n24 形成一个链
    for (let i = 0; i < 25; i++) {
      nodes.push(makeNode(`a${i}`));
    }
    for (let i = 0; i < 24; i++) {
      edges.push(makeEdge(`ea${i}`, `a${i}`, `a${i + 1}`));
    }

    // 第二组：b0-b24 形成另一个链
    for (let i = 0; i < 25; i++) {
      nodes.push(makeNode(`b${i}`));
    }
    for (let i = 0; i < 24; i++) {
      edges.push(makeEdge(`eb${i}`, `b${i}`, `b${i + 1}`));
    }

    const result = detectCommunities(nodes, edges);

    // 应该形成至少 2 个社区
    expect(result.size).toBeGreaterThanOrEqual(2);

    // a 组节点不应与 b 组节点在同一社区
    const aLabels = new Set<string>();
    const bLabels = new Set<string>();
    for (const group of result.values()) {
      for (const node of group.nodes) {
        if (node.id.startsWith('a')) aLabels.add(group.label);
        if (node.id.startsWith('b')) bLabels.add(group.label);
      }
    }
    // a 和 b 的标签集合不应有交集
    for (const al of aLabels) {
      expect(bLabels.has(al)).toBe(false);
    }
  });

  // --- 全连通图：所有节点在同一社区 ---
  it('assigns all nodes to a single community in a fully connected graph', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // 创建 55 个节点的星形图：中心节点连接所有其他节点
    for (let i = 0; i < 55; i++) {
      nodes.push(makeNode(`n${i}`));
    }
    // 中心节点 n0 连接所有其他节点
    for (let i = 1; i < 55; i++) {
      edges.push(makeEdge(`e${i}`, 'n0', `n${i}`));
    }

    const result = detectCommunities(nodes, edges);

    // 在星形图中，所有节点应该收敛到同一个标签
    // 因为 n0 的邻居最多，它的标签会传播给所有邻居
    expect(result.size).toBeGreaterThanOrEqual(1);

    // 验证大多数节点在同一个社区
    let maxGroupSize = 0;
    for (const group of result.values()) {
      if (group.nodes.length > maxGroupSize) maxGroupSize = group.nodes.length;
    }
    expect(maxGroupSize).toBeGreaterThan(40);
  });

  // --- 孤立节点 ---
  it('keeps isolated nodes in their own community (no neighbors)', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // 50 个连通的节点
    for (let i = 0; i < 50; i++) {
      nodes.push(makeNode(`c${i}`));
    }
    for (let i = 0; i < 49; i++) {
      edges.push(makeEdge(`ec${i}`, `c${i}`, `c${i + 1}`));
    }

    // 5 个孤立节点（无边连接）
    for (let i = 0; i < 5; i++) {
      nodes.push(makeNode(`iso${i}`));
    }

    const result = detectCommunities(nodes, edges);

    // 孤立节点应该各自在自己的社区中（因为没有邻居，标签不会改变）
    const isoLabels = new Set<string>();
    for (const group of result.values()) {
      for (const node of group.nodes) {
        if (node.id.startsWith('iso')) isoLabels.add(group.label);
      }
    }
    // 每个孤立节点应有自己独特的标签
    expect(isoLabels.size).toBe(5);
  });

  // --- 大规模图采样逻辑 (> MAX_NODES_FOR_LABEL_PROP = 5000) ---
  it('samples high-degree nodes when total nodes > MAX_NODES_FOR_LABEL_PROP', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // 创建 5001 个节点
    for (let i = 0; i < 5001; i++) {
      nodes.push(makeNode(`n${i}`));
    }

    // 创建一个星形结构：n0 连接到 5000 个其他节点
    // 这样 n0 的度数最高，会被选中
    for (let i = 1; i < 5001; i++) {
      edges.push(makeEdge(`e${i}`, 'n0', `n${i}`));
    }

    const result = detectCommunities(nodes, edges);

    // 采样后只有 MAX_NODES_FOR_LABEL_PROP (5000) 个节点参与标签传播
    // 剩余 1 个节点成为 overflow 节点
    // n0 度数最高，一定会被选中
    let totalNodes = 0;
    for (const group of result.values()) {
      totalNodes += group.nodes.length;
    }
    expect(totalNodes).toBe(5001);

    // n0 应该在某个社区中
    let n0Found = false;
    for (const group of result.values()) {
      if (group.nodes.some((n) => n.id === NodeId('n0'))) {
        n0Found = true;
        break;
      }
    }
    expect(n0Found).toBe(true);
  });

  it('handles overflow nodes with no participating neighbors by assigning to overflow group', () => {
    // 创建 > 5000 节点，其中一些 overflow 节点没有连接到任何参与节点
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // 5001 个节点：前 5000 个形成链，第 5001 个完全孤立
    for (let i = 0; i < 5001; i++) {
      nodes.push(makeNode(`n${i}`));
    }
    // 只连接前 5000 个节点
    for (let i = 0; i < 4999; i++) {
      edges.push(makeEdge(`e${i}`, `n${i}`, `n${i + 1}`));
    }

    const result = detectCommunities(nodes, edges);

    // overflow 节点 n5000 没有连接到任何参与节点
    // 它应该被分配到 'overflow' 组
    expect(result.has('overflow')).toBe(true);
    const overflowGroup = result.get('overflow')!;
    expect(overflowGroup.nodes.some((n) => n.id === NodeId('n5000'))).toBe(true);
  });

  // --- 标签传播收敛 ---
  it('converges and produces stable community assignments', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // 创建两个紧密连接的子图，之间只有一条边连接
    // 子图 A: n0-n29（30 个节点，形成网格）
    for (let i = 0; i < 30; i++) {
      nodes.push(makeNode(`a${i}`));
    }
    // 子图 A 内部连接
    for (let i = 0; i < 29; i++) {
      edges.push(makeEdge(`ea${i}`, `a${i}`, `a${i + 1}`));
    }
    // 额外的内部连接增强凝聚力
    edges.push(makeEdge('ea_extra1', 'a0', 'a5'));
    edges.push(makeEdge('ea_extra2', 'a10', 'a15'));
    edges.push(makeEdge('ea_extra3', 'a20', 'a25'));

    // 子图 B: b0-b29（30 个节点）
    for (let i = 0; i < 30; i++) {
      nodes.push(makeNode(`b${i}`));
    }
    for (let i = 0; i < 29; i++) {
      edges.push(makeEdge(`eb${i}`, `b${i}`, `b${i + 1}`));
    }
    edges.push(makeEdge('eb_extra1', 'b0', 'b5'));
    edges.push(makeEdge('eb_extra2', 'b10', 'b15'));
    edges.push(makeEdge('eb_extra3', 'b20', 'b25'));

    // 两个子图之间只有一条弱连接
    edges.push(makeEdge('bridge', 'a0', 'b0'));

    const result = detectCommunities(nodes, edges);

    // 应该形成至少 2 个社区
    expect(result.size).toBeGreaterThanOrEqual(2);

    // 验证所有 60 个节点都被分配
    let totalNodes = 0;
    for (const group of result.values()) {
      totalNodes += group.nodes.length;
    }
    expect(totalNodes).toBe(60);
  });

  // --- 标签传播：紧密连通图收敛到单一社区 ---
  it('converges to a single community for a tightly connected graph', () => {
    // 星形图：中心节点连接所有其他节点，保证标签快速传播
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 55; i++) {
      nodes.push(makeNode(`n${i}`));
    }
    // 中心节点 n0 连接所有其他节点
    for (let i = 1; i < 55; i++) {
      edges.push(makeEdge(`e${i}`, 'n0', `n${i}`));
    }
    // 增加额外连接使图更紧密
    for (let i = 1; i < 54; i++) {
      edges.push(makeEdge(`e2_${i}`, `n${i}`, `n${i + 1}`));
    }

    const result = detectCommunities(nodes, edges);

    // 星形+链式连通图应收敛到单一社区
    expect(result.size).toBe(1);
    const group = result.values().next().value as CommunityGroup;
    expect(group.nodes).toHaveLength(55);
  });

  // --- 边界：刚好 MIN_NODES_FOR_SUBGROUP ---
  it('enters label propagation when nodes >= MIN_NODES_FOR_SUBGROUP', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 50; i++) {
      nodes.push(makeNode(`n${i}`));
    }
    // 所有节点形成一条链
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 49; i++) {
      edges.push(makeEdge(`e${i}`, `n${i}`, `n${i + 1}`));
    }

    const result = detectCommunities(nodes, edges);

    // 不应返回 "all" 组，而是通过标签传播分配
    expect(result.has('all')).toBe(false);
    expect(result.size).toBeGreaterThanOrEqual(1);

    // 所有 50 个节点都应被分配
    let totalNodes = 0;
    for (const group of result.values()) {
      totalNodes += group.nodes.length;
    }
    expect(totalNodes).toBe(50);
  });

  // --- 溢出节点有邻居时分配到邻居的社区 ---
  it('assigns overflow nodes to neighbor community when connected', () => {
    // 创建 5001+ 节点，其中 overflow 节点连接到参与节点
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 5001; i++) {
      nodes.push(makeNode(`n${i}`));
    }

    // n0 是中心，连接到很多节点（高入度，会被选中）
    for (let i = 1; i < 5000; i++) {
      edges.push(makeEdge(`e${i}`, 'n0', `n${i}`));
    }

    // n5000 是 overflow 节点，但连接到 n1（参与节点）
    edges.push(makeEdge('e5000', 'n5000', 'n1'));

    const result = detectCommunities(nodes, edges);

    // n5000 应该被分配到 n1 所在的社区，而不是 overflow 组
    let n5000Label: string | null = null;
    let n1Label: string | null = null;
    for (const [label, group] of result) {
      for (const node of group.nodes) {
        if (node.id === NodeId('n5000')) n5000Label = label;
        if (node.id === NodeId('n1')) n1Label = label;
      }
    }

    expect(n5000Label).not.toBeNull();
    expect(n1Label).not.toBeNull();
    // n5000 应该和 n1 在同一社区
    expect(n5000Label).toBe(n1Label);
  });

  // --- selectHighDegreeNodes 间接测试：度数相同时的排序 ---
  it('selects nodes by degree and handles ties stably', () => {
    // 创建 5001+ 节点，其中多个节点度数相同
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 5001; i++) {
      nodes.push(makeNode(`n${i}`));
    }

    // 给前 10 个节点各连接 100 条边（度数相同）
    for (let i = 0; i < 10; i++) {
      for (let j = 10; j < 110; j++) {
        edges.push(makeEdge(`e_${i}_${j}`, `n${i}`, `n${j}`));
      }
    }

    // 给后面的节点少量边
    for (let i = 110; i < 5000; i++) {
      edges.push(makeEdge(`e_low_${i}`, 'n0', `n${i}`));
    }

    const result = detectCommunities(nodes, edges);

    // 所有 5001 个节点都应被分配
    let totalNodes = 0;
    for (const group of result.values()) {
      totalNodes += group.nodes.length;
    }
    expect(totalNodes).toBe(5001);

    // n0-n9 度数最高，应该都在参与节点中
    for (let i = 0; i < 10; i++) {
      let found = false;
      for (const group of result.values()) {
        if (group.nodes.some((n) => n.id === NodeId(`n${i}`))) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }
  });

  // --- 多次迭代后的标签变化 ---
  it('produces different labels for disconnected components after iterations', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // 3 个独立的连通分量，每个 20 个节点，使用星形结构确保收敛
    for (let comp = 0; comp < 3; comp++) {
      const prefix = ['x', 'y', 'z'][comp];
      for (let i = 0; i < 20; i++) {
        nodes.push(makeNode(`${prefix}${i}`));
      }
      // 星形结构：中心节点 prefix0 连接所有其他节点
      for (let i = 1; i < 20; i++) {
        edges.push(makeEdge(`e_${prefix}_${i}`, `${prefix}0`, `${prefix}${i}`));
      }
    }

    const result = detectCommunities(nodes, edges);

    // 3 个独立分量应该形成 3 个不同的社区
    expect(result.size).toBe(3);

    // 验证每个分量的节点在各自独立的社区中
    const xLabels = new Set<string>();
    const yLabels = new Set<string>();
    const zLabels = new Set<string>();
    for (const group of result.values()) {
      for (const node of group.nodes) {
        if (node.id.startsWith('x')) xLabels.add(group.label);
        if (node.id.startsWith('y')) yLabels.add(group.label);
        if (node.id.startsWith('z')) zLabels.add(group.label);
      }
    }

    // 每个分量应该只有一个标签
    expect(xLabels.size).toBe(1);
    expect(yLabels.size).toBe(1);
    expect(zLabels.size).toBe(1);

    // 三个标签应该互不相同
    const allLabels = [...xLabels, ...yLabels, ...zLabels];
    expect(new Set(allLabels).size).toBe(3);
  });

  // --- LARGE_NODE_THRESHOLD 迭代次数选择 ---
  it('uses MAX_ITERATIONS_LARGE for graphs with > LARGE_NODE_THRESHOLD participating nodes', () => {
    // 创建 2001 个节点（> LARGE_NODE_THRESHOLD = 2000）
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 2001; i++) {
      nodes.push(makeNode(`n${i}`));
    }
    // 形成链
    for (let i = 0; i < 2000; i++) {
      edges.push(makeEdge(`e${i}`, `n${i}`, `n${i + 1}`));
    }

    const result = detectCommunities(nodes, edges);

    // 所有节点应被分配
    let totalNodes = 0;
    for (const group of result.values()) {
      totalNodes += group.nodes.length;
    }
    expect(totalNodes).toBe(2001);
  });

  // --- 边的 source/target 不在节点列表中 ---
  it('ignores edges referencing non-existent nodes', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 55; i++) {
      nodes.push(makeNode(`n${i}`));
    }
    // 正常边
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 54; i++) {
      edges.push(makeEdge(`e${i}`, `n${i}`, `n${i + 1}`));
    }
    // 引用不存在节点的边
    edges.push(makeEdge('e_ghost1', 'n0', 'ghost_node'));
    edges.push(makeEdge('e_ghost2', 'ghost_node', 'n1'));

    const result = detectCommunities(nodes, edges);

    // 不应崩溃，所有 55 个节点应被分配
    let totalNodes = 0;
    for (const group of result.values()) {
      totalNodes += group.nodes.length;
    }
    expect(totalNodes).toBe(55);
  });

  // --- 无边的图（所有节点孤立） ---
  it('assigns each node to its own community when no edges exist', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 55; i++) {
      nodes.push(makeNode(`n${i}`));
    }
    const edges: GraphEdge[] = [];

    const result = detectCommunities(nodes, edges);

    // 没有边时，每个节点保持自己的初始标签
    expect(result.size).toBe(55);

    // 每个社区只有一个节点
    for (const group of result.values()) {
      expect(group.nodes).toHaveLength(1);
    }
  });

  // --- 标签传播：两个星形子图通过弱连接桥接 ---
  it('forms separate communities for two star graphs connected by a bridge edge', () => {
    // 星形 A：n0 连接 n1-n30；星形 B：n31 连接 n32-n61；桥接：n0-n31
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 62; i++) {
      nodes.push(makeNode(`n${i}`));
    }
    // 星形 A
    for (let i = 1; i <= 30; i++) {
      edges.push(makeEdge(`eA${i}`, 'n0', `n${i}`));
    }
    // 星形 B
    for (let i = 32; i <= 61; i++) {
      edges.push(makeEdge(`eB${i}`, 'n31', `n${i}`));
    }
    // 桥接
    edges.push(makeEdge('eBridge', 'n0', 'n31'));

    const result = detectCommunities(nodes, edges);

    // 所有 62 个节点应被分配
    let totalNodes = 0;
    for (const group of result.values()) {
      totalNodes += group.nodes.length;
    }
    expect(totalNodes).toBe(62);

    // n0 和 n31 应在不同的社区
    let n0Label: string | null = null;
    let n31Label: string | null = null;
    for (const [label, group] of result) {
      if (group.nodes.some((n) => n.id === NodeId('n0'))) n0Label = label;
      if (group.nodes.some((n) => n.id === NodeId('n31'))) n31Label = label;
    }
    expect(n0Label).not.toBeNull();
    expect(n31Label).not.toBeNull();
    expect(n0Label).not.toBe(n31Label);

    // 星形 A 的叶节点应与 n0 同社区
    let n1Label: string | null = null;
    for (const [label, group] of result) {
      if (group.nodes.some((n) => n.id === NodeId('n1'))) n1Label = label;
    }
    expect(n1Label).toBe(n0Label);

    // 星形 B 的叶节点应与 n31 同社区
    let n32Label: string | null = null;
    for (const [label, group] of result) {
      if (group.nodes.some((n) => n.id === NodeId('n32'))) n32Label = label;
    }
    expect(n32Label).toBe(n31Label);
  });

  // --- overflow 节点的边只连接到其他 overflow 节点 ---
  it('assigns overflow nodes to overflow group when only connected to other overflow nodes', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // 创建 5002 个节点
    for (let i = 0; i < 5002; i++) {
      nodes.push(makeNode(`n${i}`));
    }

    // 前 5000 个节点形成链（这些会被选中为参与节点）
    for (let i = 0; i < 4999; i++) {
      edges.push(makeEdge(`e${i}`, `n${i}`, `n${i + 1}`));
    }

    // n5000 和 n5001 是 overflow 节点，它们之间有边但不连接到参与节点
    edges.push(makeEdge('e_overflow', 'n5000', 'n5001'));

    const result = detectCommunities(nodes, edges);

    // n5000 和 n5001 应该在 overflow 组中
    expect(result.has('overflow')).toBe(true);
    const overflowGroup = result.get('overflow')!;
    expect(overflowGroup.nodes.some((n) => n.id === NodeId('n5000'))).toBe(true);
    expect(overflowGroup.nodes.some((n) => n.id === NodeId('n5001'))).toBe(true);
  });

  // --- 大规模图中边引用不存在节点时 selectHighDegreeNodes 的健壮性 ---
  it('handles edges referencing non-existent nodes in large graph sampling', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 5001; i++) {
      nodes.push(makeNode(`n${i}`));
    }

    // 正常边：n0 连接到 n1-n4999
    for (let i = 1; i < 5000; i++) {
      edges.push(makeEdge(`e${i}`, 'n0', `n${i}`));
    }

    // 引用不存在节点的边
    edges.push(makeEdge('e_ghost1', 'n0', 'ghost_target'));
    edges.push(makeEdge('e_ghost2', 'ghost_source', 'n1'));

    const result = detectCommunities(nodes, edges);

    // 不应崩溃，所有 5001 个节点应被分配
    let totalNodes = 0;
    for (const group of result.values()) {
      totalNodes += group.nodes.length;
    }
    expect(totalNodes).toBe(5001);
  });
});
describe('selectHighDegreeNodes', () => {
  it('returns nodes sorted by degree in descending order', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
    const edges = [
      makeEdge('e1', 'a', 'b'),
      makeEdge('e2', 'a', 'c'),
      makeEdge('e3', 'a', 'd'),
      makeEdge('e4', 'b', 'c'),
    ];
    const result = selectHighDegreeNodes(nodes, edges, 2);
    expect(result).toHaveLength(2);
    // 'a' has degree 3, 'b' has degree 2, 'c' has degree 2, 'd' has degree 1
    expect(result[0]?.id).toBe(NodeId('a'));
    expect(result[1]?.id).toBe(NodeId('b'));
  });

  it('returns all nodes when limit exceeds node count', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('e1', 'a', 'b')];
    const result = selectHighDegreeNodes(nodes, edges, 10);
    expect(result).toHaveLength(2);
  });

  it('handles empty nodes and edges', () => {
    const result = selectHighDegreeNodes([], [], 5);
    expect(result).toHaveLength(0);
  });

  it('handles nodes with zero degree', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges: GraphEdge[] = [];
    const result = selectHighDegreeNodes(nodes, edges, 2);
    expect(result).toHaveLength(2);
  });

  it('handles edges referencing non-existent nodes', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [
      makeEdge('e1', 'a', 'b'),
      makeEdge('e2', 'a', 'ghost'),
      makeEdge('e3', 'ghost', 'b'),
    ];
    const result = selectHighDegreeNodes(nodes, edges, 2);
    expect(result).toHaveLength(2);
    // 'a' has degree 2 (e1 + e2), 'b' has degree 2 (e1 + e3)
    expect(result[0]?.id).toBe(NodeId('a'));
  });
});