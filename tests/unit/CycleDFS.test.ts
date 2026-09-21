import { describe, it, expect } from 'vitest';
import { detectCyclesDFS } from '../../src/shared/analysis/CycleDFS.ts';
import type { AdjacencyMap } from '../../src/shared/analysis/AdjacencyList.ts';

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
});