// Unit tests for Host tool factory — graph_status/graph_data/graph_symbol/graph_impact
// Note: fetchMergedGraph delegates to CodeGraphAdapter which reads .codegraph/
// codegraph.db directly. In tests we test the pure transform functions which
// don't depend on the live .codegraph DB or the adapter mock.
import { describe, it, expect } from 'vitest';
import { fetchMergedGraph, summarizeGraph, makeRepo, pickBestMatch, normalizeImpact } from '../../src/tools.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';
import type { GraphData } from '../../src/types/index.ts';

describe('fetchMergedGraph', () => {
  it('should return empty graph when both sources unavailable', async () => {
    const data = await fetchMergedGraph(async () => null, 'repo-1', 'both');
    expect(data.nodes).toHaveLength(0);
    expect(data.edges).toHaveLength(0);
    expect(data.metadata.repoId).toBe('repo-1');
  });
});

describe('pickBestMatch', () => {
  it('should pick exact name match', () => {
    const raw = [{ name: 'multiply', kind: 'function', filePath: 'math.ts', startLine: 10 }];
    const result = pickBestMatch(raw, 'multiply');
    expect(result?.name).toBe('multiply');
  });

  it('should fall back to first result when no exact match', () => {
    const raw = [
      { name: 'add', kind: 'function', filePath: 'math.ts', startLine: 5 },
      { name: 'subtract', kind: 'function', filePath: 'math.ts', startLine: 15 },
    ];
    const result = pickBestMatch(raw, 'multiply');
    expect(result?.name).toBe('add');
  });

  it('should handle string payload', () => {
    const raw = JSON.stringify([{ name: 'foo', kind: 'function', filePath: 'x.ts', startLine: 1 }]);
    const result = pickBestMatch(raw, 'foo');
    expect(result?.name).toBe('foo');
  });

  it('should return null for empty payload', () => {
    expect(pickBestMatch(null, 'foo')).toBeNull();
    expect(pickBestMatch([], 'foo')).toBeNull();
  });
});

describe('normalizeImpact', () => {
  it('should normalize codegraph_impact payload', () => {
    const raw = { affected: ['foo', 'bar'], depth: 3 };
    const result = normalizeImpact(raw);
    expect(result?.affected).toEqual(['foo', 'bar']);
    expect(result?.depth).toBe(3);
  });

  it('should normalize with affectedNodes alias', () => {
    const raw = { affectedNodes: [{ name: 'x' }, { name: 'y' }], depth: 2 };
    const result = normalizeImpact(raw);
    expect(result?.affected).toEqual(['x', 'y']);
  });

  it('should handle string payload', () => {
    const raw = JSON.stringify({ affected: ['a', 'b'], depth: 1 });
    const result = normalizeImpact(raw);
    expect(result?.affected).toEqual(['a', 'b']);
  });

  it('should return null for invalid payload', () => {
    expect(normalizeImpact(null)).toBeNull();
    expect(normalizeImpact({})).toBeNull();
  });
});

describe('summarizeGraph (additional)', () => {
  it('should include edge relations in summary', () => {
    const data = makeGraphData(
      [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      [
        makeEdge('e1', 'n1', 'n2', 'call'),
        makeEdge('e2', 'n1', 'n3', 'import'),
      ],
    );
    const summary = summarizeGraph(data);
    expect(summary).toContain('call:1');
    expect(summary).toContain('import:1');
  });

  it('should show top edges up to 10', () => {
    const edges = Array.from({ length: 12 }, (_, i) => makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, 'call'));
    const data = makeGraphData([], edges);
    const summary = summarizeGraph(data);
    expect(summary).toContain('12 edges');
  });
});

describe('makeRepo', () => {
  it('should create a branded RepoId', () => {
    const id = makeRepo('my-repo');
    expect(id).toBe('my-repo');
    expect(typeof id).toBe('string');
  });
});
