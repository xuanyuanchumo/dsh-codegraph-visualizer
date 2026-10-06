import { describe, it, expect } from 'vitest';
import { collectFunctionBodyCandidates } from '../../src/client/utils/functionBudgetCandidates.ts';
import type { GraphEdge, GraphNode } from '../../src/types/index.ts';
import { EdgeId, NodeId } from '../../src/types/index.ts';

function node(id: string, type: GraphNode['type']): GraphNode {
  return {
    id: NodeId(id),
    label: id,
    type,
    filePath: `src/${id}.ts`,
    properties: {},
  };
}

function edge(id: string, source: string, target: string): GraphEdge {
  return { id: EdgeId(id), source: NodeId(source), target: NodeId(target), type: 'call', properties: {} };
}

describe('collectFunctionBodyCandidates', () => {
  it('puts the selected function itself first', () => {
    const fnA = node('fn-a', 'function');
    const fnB = node('fn-b', 'function');

    const result = collectFunctionBodyCandidates({ node: fnA, rawNodes: [fnA, fnB], rawEdges: [] });

    expect(result).toEqual(['fn-a', 'fn-b']);
  });

  it('excludes the node itself when it is not a function', () => {
    const mod = node('mod-1', 'module');
    const fnA = node('fn-a', 'function');

    const result = collectFunctionBodyCandidates({ node: mod, rawNodes: [mod, fnA], rawEdges: [] });

    expect(result).toEqual(['fn-a']);
    expect(result).not.toContain('mod-1');
  });

  it('prefers call neighbours over the rawNodes fallback order', () => {
    // fn-z sorts before fn-b in rawNodes, so seeing fn-b before fn-z proves the
    // edge-priority tier ran before the fallback tier.
    const fnA = node('fn-a', 'function');
    const fnZ = node('fn-z', 'function');
    const fnB = node('fn-b', 'function');

    const result = collectFunctionBodyCandidates({
      node: fnA,
      rawNodes: [fnA, fnZ, fnB],
      rawEdges: [edge('e1', 'fn-a', 'fn-b')],
    });

    expect(result).toEqual(['fn-a', 'fn-b', 'fn-z']);
  });

  it('treats edges as undirected', () => {
    const fnA = node('fn-a', 'function');
    const fnC = node('fn-c', 'function');

    const result = collectFunctionBodyCandidates({
      node: fnA,
      rawNodes: [fnA, fnC],
      rawEdges: [edge('e1', 'fn-c', 'fn-a')],
    });

    expect(result).toContain('fn-c');
  });

  it('includes cluster child functions in declaration order', () => {
    const cluster = node('cluster__src', 'module');
    const fnA = node('fn-a', 'function');
    const fnB = node('fn-b', 'function');
    const cls = node('cls-1', 'class');

    const result = collectFunctionBodyCandidates({
      node: cluster,
      rawNodes: [cluster, fnA, fnB, cls],
      rawEdges: [],
      clusterChildIds: ['fn-b', 'cls-1', 'fn-a'],
    });

    // fn-b first (cluster order), cls-1 dropped (not a function), fn-a next.
    expect(result).toEqual(['fn-b', 'fn-a']);
  });

  it('deduplicates a node reachable through several tiers', () => {
    const fnA = node('fn-a', 'function');
    const fnB = node('fn-b', 'function');

    const result = collectFunctionBodyCandidates({
      node: fnA,
      rawNodes: [fnA, fnB],
      rawEdges: [edge('e1', 'fn-a', 'fn-b'), edge('e2', 'fn-b', 'fn-a')],
      clusterChildIds: ['fn-b'],
    });

    expect(result).toEqual(['fn-a', 'fn-b']);
    expect(new Set(result).size).toBe(result.length);
  });

  it('ignores ids that are absent from rawNodes', () => {
    const fnA = node('fn-a', 'function');

    const result = collectFunctionBodyCandidates({
      node: fnA,
      rawNodes: [fnA],
      rawEdges: [edge('e1', 'fn-a', 'ghost')],
      clusterChildIds: ['ghost'],
    });

    expect(result).toEqual(['fn-a']);
  });

  it('returns an empty list when no function body is reachable', () => {
    const mod = node('mod-1', 'module');
    const cls = node('cls-1', 'class');

    const result = collectFunctionBodyCandidates({ node: mod, rawNodes: [mod, cls], rawEdges: [] });

    expect(result).toEqual([]);
  });
});
