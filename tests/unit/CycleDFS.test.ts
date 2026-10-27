import { describe, it, expect } from 'vitest';
import {
  boothMinimalRotation,
  detectCyclesDFS,
  hasCycle,
  isMinimalRotation,
  minimalRotationIndex,
} from '../../src/shared/analysis/CycleDFS.ts';
import type { AdjacencyMap } from '../../src/shared/analysis/AdjacencyList.ts';
import {
  boothMinimalRotation as libBoothMinimalRotation,
  isMinimalRotation as libIsMinimalRotation,
  minimalRotationIndex as libMinimalRotationIndex,
} from '../../src/xuanji/ops/booth.ts';
import { hasCycleInAdjacency } from '../../src/xuanji/ops/cycle-existence.ts';

function makeAdjacency(entries: [string, string[]][]): AdjacencyMap {
  const map: AdjacencyMap = new Map();
  for (const [k, v] of entries) map.set(k, v);
  return map;
}

describe('detectCyclesDFS', () => {
  it('returns empty array for empty adjacency map', () => {
    const adjacency = makeAdjacency([]);
    expect(detectCyclesDFS(adjacency)).toEqual([]);
  });

  it('returns empty array for DAG (no cycles)', () => {
    const adjacency = makeAdjacency([
      ['a', ['b', 'c']],
      ['b', ['d']],
      ['c', ['d']],
      ['d', []],
    ]);
    expect(detectCyclesDFS(adjacency)).toEqual([]);
  });

  it('detects self-loop', () => {
    const adjacency = makeAdjacency([
      ['a', ['a']],
    ]);
    const cycles = detectCyclesDFS(adjacency);
    expect(cycles.length).toBe(1);
    expect(cycles[0]).toContain('a');
  });

  it('detects simple two-node cycle (A->B->A)', () => {
    const adjacency = makeAdjacency([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const cycles = detectCyclesDFS(adjacency);
    expect(cycles.length).toBe(1);
    const cycle = cycles[0]!;
    expect(cycle).toContain('a');
    expect(cycle).toContain('b');
  });

  it('detects three-node cycle (A->B->C->A)', () => {
    const adjacency = makeAdjacency([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]);
    const cycles = detectCyclesDFS(adjacency);
    expect(cycles.length).toBe(1);
    const cycle = cycles[0]!;
    expect(cycle).toContain('a');
    expect(cycle).toContain('b');
    expect(cycle).toContain('c');
  });

  it('detects multiple independent cycles', () => {
    const adjacency = makeAdjacency([
      ['a', ['b']],
      ['b', ['a']],
      ['c', ['d']],
      ['d', ['c']],
    ]);
    const cycles = detectCyclesDFS(adjacency);
    expect(cycles.length).toBe(2);
  });

  it('detects nested cycles sharing a node', () => {
    const adjacency = makeAdjacency([
      ['a', ['b', 'c']],
      ['b', ['a']],
      ['c', ['a']],
    ]);
    const cycles = detectCyclesDFS(adjacency);
    expect(cycles.length).toBe(2);
  });

  it('deduplicates cycles with same nodes but different start points', () => {
    const adjacency = makeAdjacency([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]);
    const cycles = detectCyclesDFS(adjacency);
    expect(cycles.length).toBe(1);
  });

  it('handles disconnected components with and without cycles', () => {
    const adjacency = makeAdjacency([
      ['a', ['b']],
      ['b', ['a']],
      ['c', ['d']],
      ['d', []],
    ]);
    const cycles = detectCyclesDFS(adjacency);
    expect(cycles.length).toBe(1);
    expect(cycles[0]).toContain('a');
    expect(cycles[0]).toContain('b');
  });

  it('handles node with no outgoing edges', () => {
    const adjacency = makeAdjacency([
      ['a', []],
      ['b', ['a']],
    ]);
    expect(detectCyclesDFS(adjacency)).toEqual([]);
  });

  it('handles complex graph with mixed cycles and DAG', () => {
    const adjacency = makeAdjacency([
      ['a', ['b', 'c']],
      ['b', ['d']],
      ['c', ['e']],
      ['d', ['b']],
      ['e', ['f']],
      ['f', []],
    ]);
    const cycles = detectCyclesDFS(adjacency);
    expect(cycles.length).toBe(1);
    expect(cycles[0]).toContain('b');
    expect(cycles[0]).toContain('d');
  });

  it('handles large DAG without false positives', () => {
    const entries: [string, string[]][] = [];
    for (let i = 0; i < 100; i++) {
      entries.push([`n${i}`, i < 99 ? [`n${i + 1}`] : []]);
    }
    const adjacency = makeAdjacency(entries);
    expect(detectCyclesDFS(adjacency)).toEqual([]);
  });

  it('respects maxCycles limit and stops early', () => {
    const adjacency = makeAdjacency([
      ['a', ['b']],
      ['b', ['a']],
      ['c', ['d']],
      ['d', ['c']],
      ['e', ['f']],
      ['f', ['e']],
    ]);
    const cycles = detectCyclesDFS(adjacency, 2);
    expect(cycles.length).toBe(2);
  });

  it('maxCycles=1 returns at most one cycle', () => {
    const adjacency = makeAdjacency([
      ['a', ['b']],
      ['b', ['a']],
      ['c', ['d']],
      ['d', ['c']],
    ]);
    const cycles = detectCyclesDFS(adjacency, 1);
    expect(cycles.length).toBe(1);
  });

  it('maxCycles=0 returns empty array (no cycles requested)', () => {
    const adjacency = makeAdjacency([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    const cycles = detectCyclesDFS(adjacency, 0);
    expect(cycles.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // cycle-107 · C-1：库必须真正被执行（不是复制一份实现）
  // ---------------------------------------------------------------------------
  describe('璇玑库复用（引用相等，证明没有复制实现）', () => {
    it('re-exports the SAME boothMinimalRotation function object from xuanji/ops/booth', () => {
      // 引用相等：如果宿主又内联了一份 Booth，这里会是两个不同的函数对象
      expect(boothMinimalRotation).toBe(libBoothMinimalRotation);
    });

    it('re-exports the SAME minimalRotationIndex function object', () => {
      expect(minimalRotationIndex).toBe(libMinimalRotationIndex);
    });

    it('re-exports the SAME isMinimalRotation function object', () => {
      expect(isMinimalRotation).toBe(libIsMinimalRotation);
    });

    it('re-exports hasCycleInAdjacency as hasCycle (same function object)', () => {
      expect(hasCycle).toBe(hasCycleInAdjacency);
    });

    it('booth re-export keeps library behaviour (idempotent, rotation invariant)', () => {
      expect(boothMinimalRotation(['b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
      expect(boothMinimalRotation(boothMinimalRotation(['b', 'c', 'a']))).toEqual(['a', 'b', 'c']);
      expect(isMinimalRotation(['a', 'b', 'c'])).toBe(true);
      expect(minimalRotationIndex(['b', 'c', 'a'])).toBe(2);
      expect(boothMinimalRotation([])).toEqual([]);
    });
  });

  describe('hasCycle (库的早终止存在性判定)', () => {
    it('returns false for an empty adjacency map', () => {
      expect(hasCycle(makeAdjacency([]))).toBe(false);
    });

    it('returns false for a DAG', () => {
      const adjacency = makeAdjacency([
        ['a', ['b', 'c']],
        ['b', ['d']],
        ['c', ['d']],
        ['d', []],
      ]);
      expect(hasCycle(adjacency)).toBe(false);
    });

    it('returns true for a self loop', () => {
      expect(hasCycle(makeAdjacency([['a', ['a']]]))).toBe(true);
    });

    it('returns true for a multi-node cycle', () => {
      expect(hasCycle(makeAdjacency([
        ['a', ['b']],
        ['b', ['c']],
        ['c', ['a']],
      ]))).toBe(true);
    });

    it('agrees with detectCyclesDFS on 200 random graphs', () => {
      // 确定性 PRNG：随机对照必须可复现
      let state = 0x1234abcd;
      const random = (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };

      for (let group = 0; group < 200; group++) {
        const nodeCount = 2 + Math.floor(random() * 6);
        const ids: string[] = [];
        for (let i = 0; i < nodeCount; i++) ids.push(`v${i}`);

        const entries: [string, string[]][] = [];
        for (const id of ids) {
          const targets: string[] = [];
          for (const target of ids) {
            if (random() < 0.25) targets.push(target);
          }
          entries.push([id, targets]);
        }
        const adjacency = makeAdjacency(entries);

        expect(hasCycle(adjacency), `group ${group}`).toBe(detectCyclesDFS(adjacency).length > 0);
      }
    });
  });
});