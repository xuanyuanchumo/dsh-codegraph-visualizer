/**
 * 关键词查询纯函数（graphify P0-2 / GF-P0-2）：关键词 → 种子 → 子图 → 预算内文本。
 *
 * 为什么这些断言长这样（对应研究文档里的三条验收）：
 * 1. **三分支**：装得下 / 只有边装不下 / 节点也装不下，其中中间那支最容易做错——
 *    「节点全在 + over-budget 告示」必须同时成立，只断言「截断了」会放过把节点也丢掉实现；
 * 2. **种子优先**：预算极小的高连接度 hub + 低度数种子 ⇒ 种子必须仍在输出里；
 * 3. **每词保底**：一词精确命中无关节点、另一词只子串命中相关节点 ⇒ 两个种子都要在；
 * 4. **中文 token 估算**：不能按 `len/3` 校准，否则截断永不触发（用真实中文串钉住）。
 */

import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  renderSubgraphText,
  selectSeeds,
  tokenizeQuery,
  type KeywordEdge,
  type KeywordNode,
  type SeedMatch,
} from '../../../src/xuanji/query/keyword-query.ts';

function node(id: string, label = id, filePath?: string): KeywordNode {
  return filePath === undefined ? { id, label } : { id, label, filePath };
}

function edge(source: string, target: string, type = 'call'): KeywordEdge {
  return { source, target, type };
}

describe('estimateTokens：中文必须按 1 token/字 标定', () => {
  it('空串为 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('纯中文：n 个字约 n token（不是 n/3）', () => {
    const text = '依赖环检测';
    expect(estimateTokens(text)).toBe(5);
    // 旧口径 len/3 会把 5 个字算成 2 —— 这正是「截断永不触发」的来源。
    expect(Math.ceil(text.length / 3)).toBeLessThan(estimateTokens(text));
  });

  it('英文按 3.5 字符/token 且向上取整', () => {
    expect(estimateTokens('abcd')).toBe(2); // ceil(4/3.5)
    expect(estimateTokens('abcdefg')).toBe(2); // ceil(7/3.5)
    expect(estimateTokens('abcdefgh')).toBe(3); // ceil(8/3.5)=3
  });

  it('中英混排按两类字符分别计权', () => {
    // 2 个汉字 + 7 个英文字符 ⇒ 2 + 2 = 4
    expect(estimateTokens('依赖 detect')).toBe(4);
  });
});

describe('tokenizeQuery：CJK 单字 + 连续片段 + ASCII 标识符', () => {
  it('ASCII 标识符整段保留、转小写、去重', () => {
    expect(tokenizeQuery('buildForwardAdjacency BuildForwardAdjacency')).toEqual([
      'buildforwardadjacency',
    ]);
  });

  it('中文切单字，同时保留连续片段（整体命中 + 单字召回）', () => {
    const terms = tokenizeQuery('依赖环');
    expect(terms[0]).toBe('依赖环');
    expect(terms).toEqual(['依赖环', '依', '赖', '环']);
  });

  it('中英混排按出现顺序输出，丢弃单字符 ASCII 噪声', () => {
    expect(tokenizeQuery('graph 检测 a')).toEqual(['graph', '检测', '检', '测']);
  });

  it('空查询 / 纯标点返回空数组（调用方据此报「没有可查的词」）', () => {
    expect(tokenizeQuery('')).toEqual([]);
    expect(tokenizeQuery('  --  ')).toEqual([]);
  });
});

describe('selectSeeds：分级加分 + 断层截断 + 每词保底', () => {
  const nodes: KeywordNode[] = [
    node('n1', 'graphStore', 'src/client/store/graphStore.ts'),
    node('n2', 'GraphStoreBuilder', 'src/store/builder.ts'),
    node('n3', 'unrelatedThing', 'src/other.ts'),
    node('n4', '依赖环检测', 'src/analysis/cycles.ts'),
  ];

  it('精确 > 前缀 > 子串 > 路径，且得分可解释', () => {
    const seeds = selectSeeds(nodes, ['graphstore'], { maxK: 10, gapRatio: 0 });
    expect(seeds[0]!.id).toBe('n1');
    expect(seeds[0]!.score).toBe(1000);
    const prefix = seeds.find((seed) => seed.id === 'n2')!;
    expect(prefix.score).toBe(100);
    expect(prefix.matchedTerms).toEqual(['graphstore']);
  });

  it('路径维度只在标签不命中时生效（弱匹配 0.5 分）', () => {
    const seeds = selectSeeds(nodes, ['store'], { maxK: 10, gapRatio: 0 });
    const byId = new Map(seeds.map((seed) => [seed.id, seed.score]));
    expect(byId.get('n1')).toBe(1); // graphStore 含 'store' → 子串 1 分
    expect(byId.get('n3')).toBeUndefined(); // 完全不命中
  });

  it('每词保底：一个词精确命中无关节点，另一个词仍必须有种子', () => {
    const corpus = [node('exact', 'buildForwardAdjacency'), node('zh', '依赖环检测')];
    // 第一个词 1000 分精确命中 exact；'环' 只以子串 1 分命中 zh。
    const withoutGuarantee = selectSeeds(corpus, ['buildforwardadjacency', '环'], { maxK: 1, gapRatio: 0.2 });
    // 断层截断 + maxK=1 会试图只留 exact，但保底把 zh 拉回来。
    expect(withoutGuarantee.map((seed) => seed.id).sort()).toEqual(['exact', 'zh']);
  });

  it('断层截断：远低于最高分的候选被丢弃（gapRatio 生效），保底除外', () => {
    const corpus = [node('a', 'alpha'), node('b', 'alphabet'), node('c', 'zeta')];
    const seeds = selectSeeds(corpus, ['alpha'], { maxK: 10, gapRatio: 0.5 });
    // alpha=1000, alphabet=100（>=500? 否）⇒ 只剩 a
    expect(seeds.map((seed) => seed.id)).toEqual(['a']);
  });

  it('maxK 约束非保底部分，输出顺序确定（分数 → label → id）', () => {
    const corpus = [node('z', 'sameName'), node('a', 'sameName'), node('m', 'sameNameX')];
    const seeds = selectSeeds(corpus, ['samename'], { maxK: 2, gapRatio: 0 });
    expect(seeds.map((seed) => seed.id)).toEqual(['a', 'z']);
  });

  it('没有命中时返回空数组（不返回低分噪声）', () => {
    expect(selectSeeds(nodes, ['zzzzz'], { maxK: 3 })).toEqual([]);
    expect(selectSeeds([], ['x'], {})).toEqual([]);
    expect(selectSeeds(nodes, [], {})).toEqual([]);
  });
});

describe('renderSubgraphText：超预算三分支', () => {
  /** 星形：seed0 直接连 n 个叶子（depth=1 时全部叶子都在邻域内）。 */
  function starGraph(leaves = 30): { nodes: KeywordNode[]; edges: KeywordEdge[]; seeds: SeedMatch[] } {
    const nodes: KeywordNode[] = [node('seed0', 'seed0')];
    const edges: KeywordEdge[] = [];
    for (let i = 0; i < leaves; i++) {
      nodes.push(node('leaf' + i, 'leaf' + i));
      edges.push(edge('seed0', 'leaf' + i));
    }
    return {
      nodes,
      edges,
      seeds: [{ id: 'seed0', label: 'seed0', score: 1, matchedTerms: ['seed0'] }],
    };
  }

  it('分支 1（fits）：预算足够时返回完整节点 + 边，truncated=false', () => {
    const graph = starGraph(2);
    const result = renderSubgraphText(graph, graph.seeds, { depth: 1, tokenBudget: 10_000 });
    expect(result.reason).toBe('fits');
    expect(result.truncated).toBe(false);
    expect(result.text).toContain('NODE seed0');
    expect(result.text).toContain('EDGE seed0 -> leaf0');
    expect(result.tokens).toBe(estimateTokens(result.text));
  });

  it('分支 2（nodes-only）：节点全在、边装不下 ⇒ 完整节点 + over-budget 告示', () => {
    const graph = starGraph(30);
    const full = renderSubgraphText(graph, graph.seeds, { depth: 1, tokenBudget: 10_000 });
    // 预算设在「节点文本（含 header）装得下、整份装不下」之间
    const [header, ...rest] = full.text.split('\n');
    const nodesText = [header!, ...rest.filter((line) => line.startsWith('NODE'))].join('\n');
    const nodesOnlyTokens = estimateTokens(nodesText);
    const budget = nodesOnlyTokens + 40;
    expect(budget).toBeLessThan(full.tokens);

    const result = renderSubgraphText(graph, graph.seeds, { depth: 1, tokenBudget: budget });
    expect(result.reason).toBe('nodes-only');
    expect(result.truncated).toBe(true);
    // 节点必须在（这是最容易做错的一支）
    expect(result.text).toContain('NODE leaf29');
    expect(result.text).not.toContain('EDGE ');
    expect(result.text).toContain('over budget');
  });

  it('分支 3（truncated）：连节点都装不下 ⇒ 顶部 [!] TRUNCATED + 真的够用的预算值', () => {
    const graph = starGraph(30);
    const full = renderSubgraphText(graph, graph.seeds, { depth: 1, tokenBudget: 10_000 });
    const result = renderSubgraphText(graph, graph.seeds, { depth: 1, tokenBudget: 40 });

    expect(result.reason).toBe('truncated');
    expect(result.text.startsWith('[!] TRUNCATED')).toBe(true);
    expect(result.tokens).toBeLessThanOrEqual(40);
    // 告示里的 full= 必须真的够（否则是在骗调用方）
    expect(full.tokens).toBeLessThanOrEqual(10_000);
    expect(result.text).toContain(`full=${full.tokens}`);
  });

  it('种子优先：预算极小也保留种子，叶子可以被截断', () => {
    const graph = starGraph(30);
    const result = renderSubgraphText(graph, graph.seeds, { depth: 1, tokenBudget: 30 });
    expect(result.text).toContain('seed0');
  });

  it('depth 控制邻域：depth=0 只有种子节点，没有边', () => {
    const graph = starGraph(3);
    const result = renderSubgraphText(graph, graph.seeds, { depth: 0, tokenBudget: 10_000 });
    expect(result.nodeCount).toBe(1);
    expect(result.edgeCount).toBe(0);
    expect(result.text).not.toContain('leaf0');
  });

  it('标签控制字符被清洗（LLM 上下文注入防护）', () => {
    const graph = {
      nodes: [node('evil', 'bad\nlabel\u0000with\tcontrol')],
      edges: [] as KeywordEdge[],
      seeds: [{ id: 'evil', label: 'evil', score: 1, matchedTerms: ['bad'] }],
    };
    const result = renderSubgraphText(graph, graph.seeds, { depth: 0, tokenBudget: 10_000 });
    expect(result.text).toContain('NODE evil bad label with control');
    expect(result.text.split('\n').length).toBe(2); // header + 单行 NODE
  });

  it('无种子匹配时返回明确提示（不渲染空壳）', () => {
    const graph = starGraph(2);
    const result = renderSubgraphText(graph, [], { depth: 1, tokenBudget: 100 });
    expect(result.reason).toBe('fits');
    expect(result.nodeCount).toBe(0);
    expect(result.text).toContain('No seed matched');
  });
});
