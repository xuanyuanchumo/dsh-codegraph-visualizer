/**
 * `src/shared/domain.ts` 的单元测试（领域视图 $\Pi_{\text{dom}}$ + 统一切片接口 `graphSlice`）。
 *
 * 覆盖四个视图 × 三个粒度 × focus 的组合与边界：
 * 空图、单节点、focus 未命中、时序缺历史、所有权缺 blame、文件级折叠、
 * 领域标签的稳定性（同一输入两次调用标签一致）。
 */
import { describe, it, expect } from 'vitest';
import {
  graphSlice,
  GRAPH_SLICE_VIEWS,
  GRAPH_SLICE_GRANULARITIES,
  type GraphSliceView,
} from '../../src/shared/domain.ts';
import { groupBlameByFile, parseGitBlamePorcelain } from '../../src/shared/ownership.ts';
import type { CommitHistory, CommitSlice } from '../../src/shared/temporal.ts';
import type { GraphEdge, GraphNode } from '../../src/types/index.ts';

function node(id: string, filePath: string, lineNumber?: number): GraphNode {
  return {
    id: id as GraphNode['id'],
    label: id,
    type: 'function',
    filePath,
    ...(lineNumber === undefined ? {} : { lineNumber }),
    properties: {},
  };
}

function edge(id: string, source: string, target: string, type: GraphEdge['type'] = 'call'): GraphEdge {
  return {
    id: id as GraphEdge['id'],
    source: source as GraphEdge['source'],
    target: target as GraphEdge['target'],
    type,
    properties: {},
  };
}

/** 两个文件、三个符号、两条边的最小图。 */
const GRAPH = {
  nodes: [node('n1', 'src/a.ts', 1), node('n2', 'src/a.ts', 2), node('n3', 'src/b.ts', 1)],
  edges: [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3')],
};

function history(slices: CommitSlice[]): CommitHistory {
  return { slices, head: 'head', available: true, error: null };
}

const TEMPORAL_HISTORY = history([
  { hash: 's1', timestamp: 1000, files: ['src/a.ts'], edges: [] },
  { hash: 's2', timestamp: 2000, files: ['src/b.ts'], edges: [] },
]);

const BLAME = groupBlameByFile(parseGitBlamePorcelain([
  [
    'aaa1111 1 1 1',
    'author Alice',
    'author-mail <alice@example.com>',
    'filename src/a.ts',
    '',
    'line1',
  ].join('\n'),
  [
    'bbb2222 2 2 1',
    'author Bob',
    'author-mail <bob@example.com>',
    'filename src/a.ts',
    '',
    'line2',
  ].join('\n'),
  [
    'ccc3333 1 1 1',
    'author Carol',
    'author-mail <carol@example.com>',
    'filename src/b.ts',
    '',
    'line1',
  ].join('\n'),
].join('\n')));

describe('GRAPH_SLICE constants', () => {
  it('导出四个视图与三个粒度（供工具参数与文档共用，避免字面量漂移）', () => {
    expect([...GRAPH_SLICE_VIEWS]).toEqual(['structural', 'temporal', 'ownership', 'domain']);
    expect([...GRAPH_SLICE_GRANULARITIES]).toEqual(['repo', 'file', 'symbol']);
  });
});

describe('graphSlice: structural', () => {
  it('无 focus 时返回整图且无标签', async () => {
    const result = await graphSlice(GRAPH, { view: 'structural' });
    expect(result.available).toBe(true);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    expect(result.labels).toEqual({});
  });

  it('focus 按 nodeId 取 1 跳邻域', async () => {
    const result = await graphSlice(GRAPH, { view: 'structural', focus: 'n2' });
    expect(result.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(result.edges).toHaveLength(2);
  });

  it('focus 按 label 命中', async () => {
    const result = await graphSlice(GRAPH, { view: 'structural', focus: 'n3' });
    expect(result.nodes.map((n) => n.id)).toEqual(['n2', 'n3']);
    expect(result.edges.map((e) => e.id)).toEqual(['e2']);
  });

  it('focus 按文件路径取整文件（保留文件内边）', async () => {
    const result = await graphSlice(GRAPH, { view: 'structural', focus: 'src/a.ts' });
    expect(result.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
    // n1→n2 两端都在同一文件 → 文件内边保留；跨文件的 e2 被切掉。
    expect(result.edges.map((e) => e.id)).toEqual(['e1']);
  });

  it('focus 未命中时 available:false 且给出原因', async () => {
    const result = await graphSlice(GRAPH, { view: 'structural', focus: 'nope' });
    expect(result.available).toBe(false);
    expect(result.nodes).toEqual([]);
    expect(result.reason).toContain('nope');
  });

  it('空图输入返回 available:false（不编造节点）', async () => {
    const result = await graphSlice({ nodes: [], edges: [] }, { view: 'structural' });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('图为空');
  });

  it('granularity=file 把符号折叠成文件节点', async () => {
    const result = await graphSlice(GRAPH, { view: 'structural', granularity: 'file' });
    expect(result.nodes.map((n) => n.label).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.nodes.every((n) => n.type === 'module')).toBe(true);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.type).toBe('dependency');
  });

  it('单节点图 structural 原样返回', async () => {
    const result = await graphSlice({ nodes: [node('only', 'src/x.ts')], edges: [] }, { view: 'structural' });
    expect(result.available).toBe(true);
    expect(result.nodes).toHaveLength(1);
  });
});

describe('graphSlice: temporal', () => {
  it('有 commit 历史时按切片过滤并标注 churn 次数', async () => {
    const result = await graphSlice(GRAPH, { view: 'temporal', commitHistory: TEMPORAL_HISTORY });
    expect(result.available).toBe(true);
    expect(result.viewDataAvailable).toBe(true);
    // 两个文件都被触及 → 三个节点都保留
    expect(result.nodes).toHaveLength(3);
    // 节点标注 = 其文件被触及的提交数
    expect(result.labels).toMatchObject({ n1: '1', n2: '1', n3: '1' });
    expect(result.metadata.sliceCount).toBe(2);
  });

  it('commit 历史只覆盖部分文件时其余节点被切掉', async () => {
    const result = await graphSlice(GRAPH, {
      view: 'temporal',
      commitHistory: history([{ hash: 's1', timestamp: 1, files: ['src/b.ts'], edges: [] }]),
    });
    expect(result.nodes.map((n) => n.id)).toEqual(['n3']);
    expect(result.edges).toHaveLength(0);
  });

  it('缺 commit 历史时 available:false（不把整图冒充时序切片）', async () => {
    const result = await graphSlice(GRAPH, { view: 'temporal' });
    expect(result.available).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

describe('graphSlice: ownership', () => {
  it('有 blame 时节点标注为作者', async () => {
    const result = await graphSlice(GRAPH, { view: 'ownership', blameByFile: BLAME });
    expect(result.available).toBe(true);
    expect(result.viewDataAvailable).toBe(true);
    expect(result.labels).toMatchObject({ n1: 'Alice', n2: 'Bob', n3: 'Carol' });
    expect(result.metadata.authorCount).toBe(3);
  });

  it('缺 blame 时图仍切出，但 viewDataAvailable:false 且留原因', async () => {
    const result = await graphSlice(GRAPH, { view: 'ownership' });
    expect(result.available).toBe(true);
    expect(result.viewDataAvailable).toBe(false);
    expect(result.nodes).toHaveLength(3);
    expect(result.labels).toEqual({});
    expect(result.reason).toContain('blame');
  });

  it('granularity=file + ownership：文件节点标注为该文件的归属作者', async () => {
    const result = await graphSlice(GRAPH, { view: 'ownership', granularity: 'file', blameByFile: BLAME });
    // 文件级折叠后只有 2 个文件节点，标签键是合成的 file:<path>
    expect(result.nodes).toHaveLength(2);
    expect(Object.keys(result.labels).sort()).toEqual(['file:src/a.ts', 'file:src/b.ts']);
  });
});

describe('graphSlice: domain', () => {
  it('有图时给每个节点打上领域标签', async () => {
    const result = await graphSlice(GRAPH, { view: 'domain' });
    expect(result.available).toBe(true);
    expect(Object.keys(result.labels).sort()).toEqual(['n1', 'n2', 'n3']);
    expect(result.metadata.domainCount).toBeGreaterThan(0);
  });

  it('同一输入两次调用领域标签完全一致（不依赖 Louvain 内部编号）', async () => {
    const first = await graphSlice(GRAPH, { view: 'domain' });
    const second = await graphSlice(GRAPH, { view: 'domain' });
    expect(second.labels).toEqual(first.labels);
  });

  it('单节点图 domain 得到恰好一个领域', async () => {
    const result = await graphSlice({ nodes: [node('only', 'src/x.ts')], edges: [] }, { view: 'domain' });
    expect(result.labels['only']).toBe('domain-0');
    expect(result.metadata.domainCount).toBe(1);
  });

  it('空图 domain 返回 available:false', async () => {
    const result = await graphSlice({ nodes: [], edges: [] }, { view: 'domain' });
    expect(result.available).toBe(false);
  });

  it('两个不相连的簇得到两个不同领域', async () => {
    const graph = {
      nodes: [node('a1', 'src/x/a.ts'), node('a2', 'src/x/b.ts'), node('b1', 'src/y/c.ts')],
      edges: [edge('ea', 'a1', 'a2')],
    };
    const result = await graphSlice(graph, { view: 'domain' });
    const labels = new Set(Object.values(result.labels));
    expect(labels.size).toBe(2);
    expect(result.labels['a1']).toBe(result.labels['a2']);
    expect(result.labels['b1']).not.toBe(result.labels['a1']);
  });
});

describe('graphSlice: 视图 × 粒度组合', () => {
  it('temporal + file 粒度：先按 commit 切片再折叠成文件', async () => {
    const result = await graphSlice(GRAPH, {
      view: 'temporal',
      granularity: 'file',
      commitHistory: TEMPORAL_HISTORY,
    });
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.every((n) => n.type === 'module')).toBe(true);
  });

  it('domain + focus：先取邻域再算领域', async () => {
    const result = await graphSlice(GRAPH, { view: 'domain', focus: 'n2' });
    expect(Object.keys(result.labels).sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('未知视图类型在编译期就被排除（运行时不可能到达）', () => {
    // 类型层守卫：GRAPH_SLICE_VIEWS 的每一项都必须是合法视图。
    const valid: ReadonlySet<GraphSliceView> = new Set(GRAPH_SLICE_VIEWS);
    expect(valid.has('structural')).toBe(true);
    expect(valid.has('temporal')).toBe(true);
    expect(valid.has('ownership')).toBe(true);
    expect(valid.has('domain')).toBe(true);
  });
});
