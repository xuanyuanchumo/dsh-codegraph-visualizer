// P0-6 fingerprint: the snapshot key must depend on graph *content* only.
//
// The regression this suite exists for: the snapshot hash used to be
// `${nodeCount}:${edgeCount}:${metadata.timestamp}`, so two scans of an unchanged repository never
// collided and `idx_snapshots_repo_hash UNIQUE(repo_id, snapshot_hash)` was dead weight. Any future
// edit that folds a clock reading back into the fingerprint has to turn these tests red.
import { describe, it, expect } from 'vitest';

import {
  hash64,
  stableStringify,
  canonicalizeNode,
  canonicalizeEdge,
  computeContentHash,
  computeGraphFingerprint,
  computeGraphEtag,
  etagKeyForChildren,
  etagKeyForOutline,
  etagKeyForAst,
  etagKeyForEdges,
  resolveAstBudget,
} from '../../src/shared/graphFingerprint.ts';
import { SYMBOL_AST } from '../../src/shared/constants.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';
import type { GraphData } from '../../src/types/index.ts';

function graph(overrides: Partial<GraphData['metadata']> = {}): GraphData {
  const data = makeGraphData(
    [
      makeNode('a', 'alpha', 'function', 'src/a.ts', 10, { kind: 'file' }),
      makeNode('b', 'beta', 'class', 'src/b.ts', 20, { kind: 'file' }, 'a'),
    ],
    [makeEdge('e1', 'a', 'b', 'call', { weight: 1 })],
  );
  Object.assign(data.metadata, overrides);
  return data;
}

describe('hash64', () => {
  // Golden vectors pin the exact lane arithmetic. If the digest implementation changes, these break
  // on purpose: stored snapshot hashes would stop matching and the change needs a VERSION bump.
  it('matches the recorded golden vectors', () => {
    expect(hash64('')).toBe('811c9dc59e3779b9');
    expect(hash64('a')).toBe('e40c292ce954cf08');
    expect(hash64('abc')).toBe('1a47e90b58756287');
    expect(hash64('hello world')).toBe('d58b3fa773ce8683');
    expect(hash64('中文')).toBe('494cca8e858bb2b2');
  });

  it('always renders 16 lowercase hex digits', () => {
    for (const input of ['', 'x', 'a'.repeat(1000), '🙂']) {
      expect(hash64(input)).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('is deterministic and separates near-identical inputs', () => {
    expect(hash64('abc')).toBe(hash64('abc'));
    expect(hash64('abc')).not.toBe(hash64('abd'));
    expect(hash64('ab')).not.toBe(hash64('ba'));
  });
});

describe('stableStringify', () => {
  it('sorts object keys so insertion order is irrelevant', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts keys recursively', () => {
    const left = { outer: { z: 1, a: { y: 2, b: 3 } } };
    const right = { outer: { a: { b: 3, y: 2 }, z: 1 } };
    expect(stableStringify(left)).toBe(stableStringify(right));
  });

  it('drops undefined object values but keeps array slots', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableStringify([1, undefined, 3])).toBe('[1,undefined,3]');
  });

  it('handles primitives, nulls and non-finite numbers', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('undefined');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(true)).toBe('true');
    expect(stableStringify(1.5)).toBe('1.5');
    expect(stableStringify(Number.NaN)).toBe('null');
    expect(stableStringify(Number.POSITIVE_INFINITY)).toBe('null');
    expect(stableStringify(10n)).toBe('10n');
  });
});

describe('canonicalizeNode / canonicalizeEdge', () => {
  it('encodes the structural node fields in a fixed order', () => {
    const node = makeNode('n1', 'label', 'function', 'src/x.ts', 7, { k: 'v' }, 'parent');
    expect(canonicalizeNode(node)).toBe(
      ['n', 'n1', 'label', 'function', 'src/x.ts', '7', 'parent', '', '{"k":"v"}'].join('\u0001'),
    );
  });

  it('tolerates a missing lineNumber, parentId and layer', () => {
    const bare = {
      id: 'n2' as never,
      label: 'l',
      type: 'module' as const,
      filePath: 'src/y.ts',
      properties: {},
    };
    expect(canonicalizeNode(bare)).toBe(['n', 'n2', 'l', 'module', 'src/y.ts', '0', '', '', '{}'].join('\u0001'));
  });

  it('includes layer because it is derived from filePath', () => {
    const plain = makeNode('n3', 'l', 'function', 'src/z.ts', 1);
    const layered = { ...plain, layer: 'ui' };
    expect(canonicalizeNode(plain)).not.toBe(canonicalizeNode(layered));
  });

  it('encodes the structural edge fields in a fixed order', () => {
    const edge = { ...makeEdge('e1', 'a', 'b', 'call', { k: 1 }), direction: 'backward' as const, weight: 0.5 };
    expect(canonicalizeEdge(edge)).toBe(
      ['e', 'e1', 'a', 'b', 'call', 'backward', '0.5', '{"k":1}'].join('\u0001'),
    );
  });

  it('renders an absent direction and weight as empty fields', () => {
    expect(canonicalizeEdge(makeEdge('e2', 'a', 'b', 'import'))).toBe(
      ['e', 'e2', 'a', 'b', 'import', '', '', '{}'].join('\u0001'),
    );
  });
});

describe('computeContentHash', () => {
  it('prefixes the fingerprint version', () => {
    expect(computeContentHash('abc')).toBe('v1:1a47e90b58756287');
  });

  it('hashes empty content deterministically', () => {
    expect(computeContentHash('')).toBe('v1:811c9dc59e3779b9');
  });

  it('distinguishes one-character edits', () => {
    expect(computeContentHash('const a = 1;')).not.toBe(computeContentHash('const a = 2;'));
  });
});

describe('computeGraphFingerprint', () => {
  it('is stable across repeated calls on the same data', () => {
    const data = graph();
    expect(computeGraphFingerprint(data)).toBe(computeGraphFingerprint(data));
  });

  it('carries the version prefix and a 16 hex digit body', () => {
    expect(computeGraphFingerprint(graph())).toMatch(/^v1:[0-9a-f]{16}$/);
  });

  // The core P0-6 requirement: a re-scan of unchanged content must not mint a new snapshot key.
  it('ignores metadata.timestamp', () => {
    const first = graph({ timestamp: 1 });
    const second = graph({ timestamp: Date.now() });
    expect(computeGraphFingerprint(first)).toBe(computeGraphFingerprint(second));
  });

  it('ignores metadata.repoId', () => {
    const first = graph();
    const second = { ...first, metadata: { ...first.metadata, repoId: 'other-repo' as never } };
    expect(computeGraphFingerprint(first)).toBe(computeGraphFingerprint(second));
  });

  it('ignores node and edge ordering', () => {
    const data = graph();
    const shuffled: GraphData = {
      nodes: [...data.nodes].reverse(),
      edges: [...data.edges],
      metadata: { ...data.metadata },
    };
    expect(computeGraphFingerprint(shuffled)).toBe(computeGraphFingerprint(data));
  });

  it('ignores the key insertion order of properties', () => {
    const left = makeGraphData(
      [makeNode('a', 'alpha', 'function', 'src/a.ts', 10, { x: 1, y: { p: 1, q: 2 } })],
      [],
    );
    const right = makeGraphData(
      [makeNode('a', 'alpha', 'function', 'src/a.ts', 10, { y: { q: 2, p: 1 }, x: 1 })],
      [],
    );
    expect(computeGraphFingerprint(left)).toBe(computeGraphFingerprint(right));
  });

  it('changes when a node label changes', () => {
    const before = graph();
    const after = { ...before, nodes: [makeNode('a', 'renamed', 'function', 'src/a.ts', 10, { kind: 'file' }), before.nodes[1]!] };
    expect(computeGraphFingerprint(after)).not.toBe(computeGraphFingerprint(before));
  });

  it('changes when a node moves to another file or line', () => {
    const before = graph();
    const moved = {
      ...before,
      nodes: [makeNode('a', 'alpha', 'function', 'src/moved.ts', 11, { kind: 'file' }), before.nodes[1]!],
    };
    expect(computeGraphFingerprint(moved)).not.toBe(computeGraphFingerprint(before));
  });

  it('changes when node properties change', () => {
    const before = graph();
    const after = {
      ...before,
      nodes: [makeNode('a', 'alpha', 'function', 'src/a.ts', 10, { kind: 'symbol' }), before.nodes[1]!],
    };
    expect(computeGraphFingerprint(after)).not.toBe(computeGraphFingerprint(before));
  });

  it('changes when an edge target changes', () => {
    const before = graph();
    const after = { ...before, edges: [makeEdge('e1', 'a', 'a', 'call', { weight: 1 })] };
    expect(computeGraphFingerprint(after)).not.toBe(computeGraphFingerprint(before));
  });

  it('changes when an edge is removed', () => {
    const before = graph();
    const after = { ...before, edges: [] };
    expect(computeGraphFingerprint(after)).not.toBe(computeGraphFingerprint(before));
  });

  it('changes when the node count changes', () => {
    const before = graph();
    const after = { ...before, nodes: [...before.nodes, makeNode('c', 'gamma', 'module', 'src/c.ts', 1)] };
    expect(computeGraphFingerprint(after)).not.toBe(computeGraphFingerprint(before));
  });

  it('hashes an empty graph deterministically', () => {
    const empty = computeGraphFingerprint(makeGraphData([], []));
    expect(empty).toMatch(/^v1:[0-9a-f]{16}$/);
    expect(empty).toBe(computeGraphFingerprint(makeGraphData([], [])));
    expect(empty).not.toBe(computeGraphFingerprint(graph()));
  });

  // Truncation is part of the observed shape: a slimmed 50-node payload and a full 2000-node payload
  // must not share a key even if the visible node records happen to coincide.
  it('changes when truncation metadata changes', () => {
    const full = graph();
    const slim = graph({ truncated: true, totalNodeCount: 2000, totalEdgeCount: 5000 });
    expect(computeGraphFingerprint(slim)).not.toBe(computeGraphFingerprint(full));
    expect(computeGraphFingerprint(graph({ truncated: true }))).toBe(
      computeGraphFingerprint(graph({ truncated: true })),
    );
  });

  it('treats totalNodeCount/totalEdgeCount as part of the fingerprint', () => {
    const a = graph({ totalNodeCount: 2, totalEdgeCount: 1 });
    const b = graph({ totalNodeCount: 3, totalEdgeCount: 1 });
    expect(computeGraphFingerprint(a)).not.toBe(computeGraphFingerprint(b));
  });

  it('falls back to the observed lengths when totals are absent', () => {
    const withTotals = graph({ totalNodeCount: 2, totalEdgeCount: 1 });
    const withoutTotals = graph();
    expect(computeGraphFingerprint(withTotals)).toBe(computeGraphFingerprint(withoutTotals));
  });
});

// P0-R16-02：ETag 不是内容寻址，而是**身份定域**的弱校验器。它与 `computeGraphFingerprint`
// 解决的是两个不同问题，故意不共用实现：
//   - 指纹要遍历全图（每次扫描算一次），用来判断"内容是否变化"；
//   - ETag 在每次 `/data` 请求上都要算，用来判断"这个请求方问的还是不是同一份资源"。
// 因此 ETag 必须同时含 revision、工作区身份与资源维度。少了任何一维，"校验器与被校验资源
// 无关"这类缺陷就会换一个形状重现（Round 15 / Round 16 / Round 17 已各出现一次）。
describe('computeGraphEtag', () => {
  it('carries the weak-validator prefix and a 16 hex digit body', () => {
    expect(computeGraphEtag('/repo/a', 1, 'graph')).toMatch(/^W\/"1-[0-9a-f]{16}"$/);
  });

  it('is stable for the same identity, revision and resource', () => {
    expect(computeGraphEtag('/repo/a', 7, 'graph')).toBe(computeGraphEtag('/repo/a', 7, 'graph'));
  });

  // 两个工作区在同一毫秒各产生一版图时，裸时间戳会撞车 ⇒ 服务端回 304 ⇒ 真实更新被静默丢弃。
  it('distinguishes two workspaces that share the same revision', () => {
    expect(computeGraphEtag('/repo/a', 5, 'graph')).not.toBe(computeGraphEtag('/repo/b', 5, 'graph'));
  });

  it('distinguishes revisions', () => {
    expect(computeGraphEtag('/repo/a', 5, 'graph')).not.toBe(computeGraphEtag('/repo/a', 6, 'graph'));
  });

  // 少了资源维度就能拿 `/data` 的校验值让 `/children` 回 304——调用方拿到的是"这个资源没变"
  // 的假结论，而它请求的是另一个资源。
  it('distinguishes resources that share the same identity and revision', () => {
    const resources = ['graph', 'bootstrap', 'children', 'outline', 'ast', 'edges'] as const;
    const seen = new Set(resources.map((r) => computeGraphEtag('/repo/a', 5, r)));
    expect(seen.size).toBe(resources.length);
  });

  // 身份缺失（首次加载、`repoId` 尚未确定）时不得抛错，也不得与"空字符串身份"的图混淆。
  it('handles a missing repoId without throwing', () => {
    expect(computeGraphEtag(null, 1, 'graph')).toMatch(/^W\/"1-[0-9a-f]{16}"$/);
    expect(computeGraphEtag(undefined, 1, 'graph')).toBe(computeGraphEtag(null, 1, 'graph'));
    expect(computeGraphEtag('', 1, 'graph')).toBe(computeGraphEtag(null, 1, 'graph'));
  });

  // P3-R18-02 深一层：资源维度只够区分"端点"，不够区分"同一端点的不同参数"。
  //
  // 缓存图只有一个槽（`getLastGraphData()`），所以 `children(nodeA)` 与 `children(nodeB)`
  // 在 (工作区, 版本, 资源) 三维下会算出**同一个校验值**。客户端拿 A 的校验值问 B 就会收到
  // 304，而它手上没有 B 的子节点 ⇒ B 永远展开不出来，且没有任何错误可见。
  // 这与 P0-R16-02 是同一类缺陷：校验器必须与被校验的**那一次请求**有关，而不是与被校验的资源类有关。
  describe('request keys', () => {
    it('changes the validator when the request key changes', () => {
      const base = computeGraphEtag('/repo/a', 5, 'children');
      expect(computeGraphEtag('/repo/a', 5, 'children', etagKeyForChildren('n1', null, 50))).not.toBe(base);
    });

    it('omitting the request key keeps the legacy byte shape', () => {
      // 在途客户端手里可能还有 `/data`、`/bootstrap` 的旧校验值；加了第 4 个可选参数后
      // 省略它必须产生**逐字节相同**的字符串，否则已部署客户端会全量重取一次。
      expect(computeGraphEtag('/repo/a', 1, 'graph', undefined)).toBe(computeGraphEtag('/repo/a', 1, 'graph'));
    });

    it('two different nodes never share a children validator', () => {
      // 这条就是本机制存在的理由：把节点维度写进请求键。
      const a = computeGraphEtag('/repo/a', 5, 'children', etagKeyForChildren('nodeA', null, 50));
      const b = computeGraphEtag('/repo/a', 5, 'children', etagKeyForChildren('nodeB', null, 50));
      expect(a).not.toBe(b);
    });

    it('pagination parameters are part of the children key', () => {
      // 第 2 页与第 1 页是两个不同载荷；少了 cursor 维度会让第 2 页请求命中第 1 页的校验值。
      const p1 = etagKeyForChildren('n1', null, 50);
      const p2 = etagKeyForChildren('n1', 'cursor-1', 50);
      const p1b = etagKeyForChildren('n1', null, 100);
      expect(p1).not.toBe(p2);
      expect(p1).not.toBe(p1b);
      // 反向自检：同一组参数必须稳定（键是纯函数，不含时间/随机）。
      expect(etagKeyForChildren('n1', null, 50)).toBe(p1);
    });

    it('outline keys distinguish files', () => {
      expect(etagKeyForOutline('f1')).not.toBe(etagKeyForOutline('f2'));
      expect(etagKeyForOutline('f1')).toBe(etagKeyForOutline('f1'));
    });

    it('ast keys distinguish cursor and budget', () => {
      const k = etagKeyForAst('sym1', 0, 800);
      expect(etagKeyForAst('sym1', 800, 800)).not.toBe(k);
      expect(etagKeyForAst('sym1', 0, 400)).not.toBe(k);
      expect(etagKeyForAst('sym1', 0, 800)).toBe(k);
    });

    it('edges keys distinguish scope, cursor, limit and detail', () => {
      const k = etagKeyForEdges('n1', 'file', 0, 100, false);
      expect(etagKeyForEdges('n1', 'symbol', 0, 100, false)).not.toBe(k);
      expect(etagKeyForEdges('n1', 'file', 100, 100, false)).not.toBe(k);
      expect(etagKeyForEdges('n1', 'file', 0, 500, false)).not.toBe(k);
      // `detail` 决定这一页是聚合摘要还是原始边：同一 (from, scope, cursor, limit) 下
      // 聚合页与明细页的载荷完全不同，少算这一维就会用聚合页的校验值让明细请求收 304。
      expect(etagKeyForEdges('n1', 'file', 0, 100, true)).not.toBe(k);
      expect(etagKeyForEdges('n1', 'file', 0, 100, false)).toBe(k);
    });

    it('a request key cannot collide with a bare resource validator', () => {
      // 键的字符串形状必须与 `resource` 本身不同，否则 `computeGraphEtag` 里的拼接
      // 可能让"带键"与"不带键"产生同一条 identity。
      expect(computeGraphEtag('/repo/a', 5, 'children', 'children')).not.toBe(
        computeGraphEtag('/repo/a', 5, 'children'),
      );
    });
  });

  // `resolveAstBudget` 是 host 与客户端**共用**的预算解析。客户端从不发 `budget` 参数，
  // 所以两侧都算出 `SYMBOL_AST.MAX_NODES`——但"两侧相等"必须是**算出来的**而不是各写常量：
  // 一旦 host 改了预算上限而客户端写死旧值，请求键会静默分叉，校验值永远匹配不上，
  // 表现是"缓存永不生效"而没有任何测试会红。
  describe('resolveAstBudget', () => {
    it('falls back to the max node budget when the parameter is absent', () => {
      expect(resolveAstBudget(null)).toBe(800);
      expect(resolveAstBudget(undefined)).toBe(800);
      expect(resolveAstBudget('')).toBe(800);
    });

    it('clamps to the configured maximum', () => {
      expect(resolveAstBudget('99999')).toBe(800);
      expect(resolveAstBudget('200')).toBe(200);
    });

    it('treats unparsable input as absent instead of zero', () => {
      // `parseInt('abc')` 是 NaN；若直接用 NaN 做预算，`slice(0, NaN)` 会返回空页，
      // 且请求键里出现 `ast:sym:0:NaN` —— 一个所有畸形请求共用的键。
      expect(resolveAstBudget('abc')).toBe(800);
      expect(resolveAstBudget('-5')).toBe(800);
    });

    it('the fallback is the same constant the host route clamps against', () => {
      // 反向自检：确保上面几个数字不是"碰巧"，而是真的绑定在 SYMBOL_AST 上。
      expect(resolveAstBudget(null)).toBe(SYMBOL_AST.MAX_NODES);
    });
  });
});
