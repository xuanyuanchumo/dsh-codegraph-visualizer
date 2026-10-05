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
} from '../../src/shared/graphFingerprint.ts';
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
});
