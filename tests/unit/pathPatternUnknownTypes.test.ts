/**
 * cycle-135：ρ 的「拼错类型名」诊断（`unknownEdgeTypes`）。
 *
 * ## 为什么单独一个文件
 *
 * 这是**返回面契约**的变更，不是又一条枚举路径。它的核心不变量只有一条：
 *
 * > `calls+`（Σ 里没有 `calls`）与「这张图上没有 call 边」都返回 `paths: []`，
 * > 但前者必须带 `unknownEdgeTypes: ['calls']`，后者必须带 `unknownEdgeTypes: []`。
 *
 * 两者在返回面上同形时，调用方（模型或用户）无法区分「我写错了」与
 * 「图上确实没有这种关系」，必然误判——本仓库反复记录过「空集冒充结论」。
 *
 * 因此本文件的断言**只盯 `unknownEdgeTypes` 这一个字段**，不重复
 * `patternEnumerationAdapter.test.ts` 已经覆盖的枚举语义。
 *
 * ## 夹具为什么用「图上只有 call/import/dependency，没有 contains」
 *
 * `contains` 在 Σ 里**合法**，但这张图上没有 contains 边。用它当「合法但缺失」
 * 的样本，正好与「Σ 里没有」形成对照——两个不同的空结果原因。
 */
import { describe, it, expect } from 'vitest';
import { XuanjiAdapter } from '../../src/shared/analysis/XuanjiAdapter.ts';
import type { GraphData, GraphEdge, GraphNode } from '../../src/types/index.ts';

const node = (id: string, type: GraphNode['type'], filePath: string): GraphNode => ({
  id: id as GraphNode['id'],
  label: id.split(':').pop() ?? id,
  type,
  filePath,
  properties: {},
});

const edge = (source: string, target: string, type: GraphEdge['type']): GraphEdge => ({
  id: `${type}:${source}->${target}` as GraphEdge['id'],
  source: source as GraphEdge['source'],
  target: target as GraphEdge['target'],
  type,
  properties: {},
});

/**
 * 只有 `call` / `import` / `dependency` 三种边的图。
 *
 * 刻意**不含** `contains`：它合法但不在这张图上，是「合法但缺失」的样本。
 * 也**不含** `association` / `aggregation` / `composition`：它们是 Σ 成员但
 * 全仓无生产者，用来验证「Σ 合法但图上没有」同样归零且不报拼错。
 */
function makeGraph(): GraphData {
  const nodes: GraphNode[] = [
    node('file:main.ts', 'module', 'main.ts'),
    node('file:service.ts', 'module', 'service.ts'),
    node('sym:handler', 'function', 'main.ts'),
    node('sym:service', 'function', 'service.ts'),
    node('sym:dbClient', 'class', 'service.ts'),
  ];
  const edges: GraphEdge[] = [
    edge('sym:handler', 'sym:service', 'call'),
    edge('sym:service', 'sym:dbClient', 'import'),
  ];
  return {
    nodes,
    edges,
    metadata: { repoId: 'test' as GraphData['metadata']['repoId'], timestamp: 1, nodeCount: nodes.length, edgeCount: edges.length },
  };
}

function makeAdapter(): XuanjiAdapter {
  const adapter = new XuanjiAdapter();
  adapter.loadGraph(makeGraph());
  return adapter;
}

describe('ρ 的 unknownEdgeTypes 诊断', () => {
  it('把 Σ 里不存在的类型名（复数 `calls`）识别为拼错，并返回零结果', () => {
    const result = makeAdapter().pathsByPattern('calls+');
    expect(result.paths).toEqual([]);
    expect(result.unknownEdgeTypes).toEqual(['calls']);
  });

  it('大小写不匹配（`Call`）同样识别为拼错——tokenize 不归一化', () => {
    const result = makeAdapter().pathsByPattern('Call+');
    expect(result.unknownEdgeTypes).toEqual(['Call']);
    expect(result.paths).toEqual([]);
  });

  it('合法但本图没有的 Σ 成员（`contains`）**不**算拼错', () => {
    const result = makeAdapter().pathsByPattern('contains+');
    expect(result.unknownEdgeTypes).toEqual([]);
    expect(result.paths).toEqual([]);
  });

  it('三个「无生产者」的 Σ 成员（association/aggregation/composition）同样不算拼错', () => {
    const result = makeAdapter().pathsByPattern('association . aggregation . composition');
    expect(result.unknownEdgeTypes).toEqual([]);
    expect(result.paths).toEqual([]);
  });

  it('混合情形：`call . calls` 只把 `calls` 报为拼错，`call` 不报', () => {
    const result = makeAdapter().pathsByPattern('call . calls');
    expect(result.unknownEdgeTypes).toEqual(['calls']);
    // `call` 在图上存在但拼错段导致整条 ρ 无法匹配任何路径 —— 零结果是正确语义
    expect(result.paths).toEqual([]);
  });

  it('`patternEdgeTypes` 仍然回显拼错的名字（诊断用，说明「这条模式打算走哪些关系」）', () => {
    const result = makeAdapter().pathsByPattern('calls');
    // 排序后的顺序：calls 是唯一出现的类型，故为单元素
    expect(result.patternEdgeTypes).toEqual(['calls']);
  });

  it('全部类型名都合法时 `unknownEdgeTypes` 为空数组（不是 undefined）', () => {
    const result = makeAdapter().pathsByPattern('call+ . import?');
    expect(result.unknownEdgeTypes).toEqual([]);
    // 且这条路径确实能查到（call → import 链在图上存在）
    expect(result.paths.length).toBeGreaterThan(0);
  });

  it('ε（空模式）不产生 unknownEdgeTypes', () => {
    const result = makeAdapter().pathsByPattern('');
    expect(result.unknownEdgeTypes).toEqual([]);
  });

  it('`unknownEdgeTypes` 已排序，便于断言与展示', () => {
    // `zebra` 与 `calls` 的字典序：calls < zebra
    const result = makeAdapter().pathsByPattern('zebra . calls');
    expect(result.unknownEdgeTypes).toEqual(['calls', 'zebra']);
  });
});
