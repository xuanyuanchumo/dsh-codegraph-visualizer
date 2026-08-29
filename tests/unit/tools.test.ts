// Unit tests for Host tool factory — graph_status/graph_data/graph_symbol/graph_impact
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchMergedGraph, summarizeGraph, makeRepo } from '../../src/tools.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';
import type { GraphData } from '../../src/types/index.ts';

describe('fetchMergedGraph', () => {
  it('should merge codegraph + lens when source=both', async () => {
    const invoke = async (tool: string) => {
      if (tool === 'codegraph_graph') {
        return { nodes: [{ id: 'n1', name: 'fA', kind: 'function', file: 'a.ts', line: 1 }], edges: [] };
      }
      if (tool === 'lens_analyze') {
        return { symbols: [{ id: 's1', name: 'ClassB', scope: 'g', file: 'b.ts', line: 2, category: 'class' }], references: [] };
      }
      return null;
    };
    const data = await fetchMergedGraph(invoke, 'repo-1', 'both');
    expect(data.nodes).toHaveLength(2);
    expect(data.metadata.repoId).toBe('repo-1');
  });

  it('should use only codegraph when source=codegraph', async () => {
    const invoke = async (tool: string) => {
      if (tool === 'codegraph_graph') return { nodes: [{ id: 'n1', name: 'fA', kind: 'function', file: 'a.ts', line: 1 }], edges: [] };
      return null;
    };
    const data = await fetchMergedGraph(invoke, 'repo-1', 'codegraph');
    expect(data.nodes).toHaveLength(1);
  });

  it('should use only lens when source=lens', async () => {
    const invoke = async (tool: string) => {
      if (tool === 'lens_analyze') return { symbols: [{ id: 's1', name: 'C', scope: 'g', file: 'b.ts', line: 2, category: 'class' }], references: [] };
      return null;
    };
    const data = await fetchMergedGraph(invoke, 'repo-1', 'lens');
    expect(data.nodes).toHaveLength(1);
  });

  it('should return empty graph when both sources unavailable', async () => {
    const invoke = async () => null;
    const data = await fetchMergedGraph(invoke, 'repo-1', 'both');
    expect(data.nodes).toHaveLength(0);
    expect(data.edges).toHaveLength(0);
  });

  it('should default to both when source omitted', async () => {
    const invoke = async (tool: string) => {
      if (tool === 'codegraph_graph') return { nodes: [{ id: 'n1', name: 'f', kind: 'function', file: 'a', line: 1 }], edges: [] };
      if (tool === 'lens_analyze') return { symbols: [{ id: 's1', name: 'c', scope: 'g', file: 'b', line: 2, category: 'class' }], references: [] };
      return null;
    };
    const data = await fetchMergedGraph(invoke, 'repo-1');
    expect(data.nodes).toHaveLength(2);
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