import { describe, it, expect } from 'vitest';
import { computeReachCounts } from '../../src/shared/analysis/batchReach.ts';
import { bfsReachCount } from '../../src/shared/analysis/GraphBFS.ts';
import { CORE_FUNCTION } from '../../src/shared/constants.ts';

const MAX_BFS_NODES = CORE_FUNCTION.MAX_BFS_NODES;

function adjacencyOf(entries: Array<[string, string[]]>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [source, targets] of entries) map.set(source, targets);
  return map;
}

/** 独立的精确 BFS（测试侧参照物，故意不复用被测实现）。 */
function exactReach(out: ReadonlyMap<string, readonly string[]>, start: string): number {
  const seen = new Set<string>([start]);
  const queue: string[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    for (const next of out.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size - 1;
}

/** 确定性 PRNG（mulberry32）：随机对照测试必须可复现，绝不能依赖 Math.random。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chain(nodeCount: number): { nodes: string[]; out: Map<string, string[]> } {
  const nodes: string[] = [];
  for (let i = 0; i < nodeCount; i++) nodes.push(`n${i}`);
  const out = new Map<string, string[]>();
  for (let i = 0; i < nodeCount - 1; i++) out.set(`n${i}`, [`n${i + 1}`]);
  return { nodes, out };
}

describe('computeReachCounts (batchReach)', () => {
  it('returns an empty map for an empty node set', () => {
    const result = computeReachCounts(new Map(), []);
    expect(result.size).toBe(0);
  });

  it('counts 0 for isolated nodes', () => {
    const result = computeReachCounts(new Map(), ['a', 'b', 'c']);
    expect(result.get('a')).toBe(0);
    expect(result.get('b')).toBe(0);
    expect(result.get('c')).toBe(0);
  });

  it('counts a simple chain correctly', () => {
    const out = adjacencyOf([
      ['a', ['b']],
      ['b', ['c']],
      ['c', []],
    ]);
    const result = computeReachCounts(out, ['a', 'b', 'c']);
    expect(result.get('a')).toBe(2);
    expect(result.get('b')).toBe(1);
    expect(result.get('c')).toBe(0);
  });

  it('does not double count a diamond join (a→b,a→c,b→d,c→d)', () => {
    const out = adjacencyOf([
      ['a', ['b', 'c']],
      ['b', ['d']],
      ['c', ['d']],
      ['d', []],
    ]);
    const result = computeReachCounts(out, ['a', 'b', 'c', 'd']);
    expect(result.get('a')).toBe(3);
    expect(result.get('b')).toBe(1);
    expect(result.get('c')).toBe(1);
    expect(result.get('d')).toBe(0);
  });

  it('treats a 2-cycle (a↔b) as one SCC with reach 1 each', () => {
    const out = adjacencyOf([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const result = computeReachCounts(out, ['a', 'b']);
    expect(result.get('a')).toBe(1);
    expect(result.get('b')).toBe(1);
  });

  it('treats a 3-cycle as one SCC with reach 2 each', () => {
    const out = adjacencyOf([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]);
    const result = computeReachCounts(out, ['a', 'b', 'c']);
    expect(result.get('a')).toBe(2);
    expect(result.get('b')).toBe(2);
    expect(result.get('c')).toBe(2);
  });

  it('ignores self loops (reach stays 0)', () => {
    const out = adjacencyOf([['a', ['a']]]);
    const result = computeReachCounts(out, ['a']);
    expect(result.get('a')).toBe(0);
  });

  it('counts duplicated edges once', () => {
    const out = adjacencyOf([
      ['a', ['b', 'b', 'b']],
      ['b', []],
    ]);
    const result = computeReachCounts(out, ['a', 'b']);
    expect(result.get('a')).toBe(1);
  });

  it('adds the SCC size to the successor closure (a↔b, b→c)', () => {
    const out = adjacencyOf([
      ['a', ['b']],
      ['b', ['a', 'c']],
      ['c', []],
    ]);
    const result = computeReachCounts(out, ['a', 'b', 'c']);
    expect(result.get('a')).toBe(2);
    expect(result.get('b')).toBe(2);
    expect(result.get('c')).toBe(0);
  });

  it('ignores edges whose endpoints are outside the node set', () => {
    const out = adjacencyOf([
      ['a', ['ghost', 'b']],
      ['b', []],
    ]);
    const result = computeReachCounts(out, ['a', 'b']);
    expect(result.get('a')).toBe(1);
    expect(result.has('ghost')).toBe(false);
  });

  it('deduplicates repeated node ids in the node list', () => {
    const out = adjacencyOf([
      ['a', ['b']],
      ['b', []],
    ]);
    const result = computeReachCounts(out, ['a', 'b', 'a', 'b']);
    expect(result.size).toBe(2);
    expect(result.get('a')).toBe(1);
  });

  it('handles disconnected components independently', () => {
    const out = adjacencyOf([
      ['a', ['b']],
      ['b', ['c']],
      ['c', []],
      ['x', ['y']],
      ['y', []],
    ]);
    const result = computeReachCounts(out, ['a', 'b', 'c', 'x', 'y', 'z']);
    expect(result.get('a')).toBe(2);
    expect(result.get('x')).toBe(1);
    expect(result.get('z')).toBe(0);
  });

  it('never counts the node itself', () => {
    const out = adjacencyOf([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const result = computeReachCounts(out, ['a', 'b']);
    for (const count of result.values()) expect(count).toBeLessThan(2);
  });

  it('is deterministic across repeated calls', () => {
    const out = adjacencyOf([
      ['a', ['b', 'c']],
      ['b', ['d']],
      ['c', ['d']],
      ['d', ['a']],
    ]);
    const nodes = ['a', 'b', 'c', 'd'];
    expect([...computeReachCounts(out, nodes)]).toEqual([...computeReachCounts(out, nodes)]);
  });

  it.each([33, 32, 64, 65])('crosses the 32-bit word boundary correctly (%i chain nodes)', (nodeCount) => {
    const { nodes, out } = chain(nodeCount);
    const result = computeReachCounts(out, nodes);
    expect(result.get('n0')).toBe(nodeCount - 1);
    expect(result.get(`n${nodeCount - 1}`)).toBe(0);
    expect(result.get('n1')).toBe(nodeCount - 2);
  });

  it('computes exact reach on a 601-node chain (0→1→…→600)', () => {
    const { nodes, out } = chain(601);
    const result = computeReachCounts(out, nodes);
    expect(result.get('n0')).toBe(600);
    expect(result.get('n300')).toBe(300);
    expect(result.get('n600')).toBe(0);
  });

  it('on >500 chains the legacy truncated value is an order-dependent under-estimate (old ≤ new)', () => {
    const { nodes, out } = chain(601);
    const result = computeReachCounts(out, nodes);
    const exact = result.get('n0')!;
    const legacy = bfsReachCount(out, 'n0', MAX_BFS_NODES);
    expect(exact).toBe(600);
    expect(legacy).toBeLessThanOrEqual(exact);
    // 旧实现的截断位置：长链上停在 visited.size == 500，返回 499
    expect(legacy).toBe(MAX_BFS_NODES - 1);
  });

  it('handles a 2000-node chain without exploding the stack', () => {
    const { nodes, out } = chain(2000);
    const result = computeReachCounts(out, nodes);
    expect(result.get('n0')).toBe(1999);
    expect(result.get('n1999')).toBe(0);
  });

  it('matches an independent exact BFS on 300 random graphs (≤ 30 nodes)', () => {
    for (let group = 0; group < 300; group++) {
      const random = mulberry32(0x5eed + group);
      const nodeCount = 2 + Math.floor(random() * 29);
      const nodes: string[] = [];
      for (let i = 0; i < nodeCount; i++) nodes.push(`v${i}`);

      const out = new Map<string, string[]>();
      for (const source of nodes) out.set(source, []);
      for (const source of nodes) {
        for (const target of nodes) {
          if (random() < 0.12) out.get(source)!.push(target);
        }
      }

      const result = computeReachCounts(out, nodes);
      for (const id of nodes) {
        const expected = exactReach(out, id);
        expect(result.get(id), `group ${group} node ${id}`).toBe(expected);
      }
    }
  });

  it('agrees with the legacy implementation node-by-node while exact < MAX_BFS_NODES', () => {
    for (let group = 0; group < 300; group++) {
      const random = mulberry32(0xa11ce + group);
      const nodeCount = 2 + Math.floor(random() * 29);
      const nodes: string[] = [];
      for (let i = 0; i < nodeCount; i++) nodes.push(`v${i}`);

      const out = new Map<string, string[]>();
      for (const source of nodes) out.set(source, []);
      for (const source of nodes) {
        for (const target of nodes) {
          if (random() < 0.15) out.get(source)!.push(target);
        }
      }

      const result = computeReachCounts(out, nodes);
      for (const id of nodes) {
        const exact = result.get(id)!;
        const legacy = bfsReachCount(out, id, MAX_BFS_NODES);
        // 随机小图（≤ 30 节点）的精确值必然 < 500 → 契约要求逐节点相等
        expect(exact).toBeLessThan(MAX_BFS_NODES);
        expect(legacy, `group ${group} node ${id}`).toBe(exact);
      }
    }
  });
});
