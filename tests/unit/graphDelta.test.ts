import { describe, it, expect } from 'vitest';
import {
  applyGraphDelta,
  canApplyGraphDelta,
  isEmptyGraphDelta,
  graphDeltaSize,
} from '../../src/shared/graphDelta.ts';
import type { GraphDelta } from '../../src/types/index.ts';
import { makeNode, makeEdge } from '../helpers.ts';

function emptyDelta(overrides: Partial<GraphDelta> = {}): GraphDelta {
  return {
    addedNodes: [], removedNodes: [], modifiedNodes: [],
    addedEdges: [], removedEdges: [], modifiedEdges: [],
    ...overrides,
  };
}

describe('isEmptyGraphDelta', () => {
  it('is true only when every bucket is empty', () => {
    expect(isEmptyGraphDelta(emptyDelta())).toBe(true);
  });

  it('is false when a single node was added', () => {
    expect(isEmptyGraphDelta(emptyDelta({ addedNodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)] }))).toBe(false);
  });

  it('is false when a single edge was removed', () => {
    expect(isEmptyGraphDelta(emptyDelta({ removedEdges: [makeEdge('e1', 'n1', 'n2', 'call')] }))).toBe(false);
  });
});

describe('graphDeltaSize', () => {
  it('sums the three node buckets and the three edge buckets separately', () => {
    const delta = emptyDelta({
      addedNodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      removedNodes: [makeNode('n2', 'B', 'function', 'b.ts', 1), makeNode('n3', 'C', 'function', 'c.ts', 1)],
      modifiedNodes: [makeNode('n4', 'D', 'function', 'd.ts', 1)],
      addedEdges: [makeEdge('e1', 'n1', 'n2', 'call')],
      removedEdges: [makeEdge('e2', 'n2', 'n3', 'call')],
      modifiedEdges: [],
    });
    expect(graphDeltaSize(delta)).toEqual({ nodes: 4, edges: 2 });
  });

  it('reports zeroes for an empty delta', () => {
    expect(graphDeltaSize(emptyDelta())).toEqual({ nodes: 0, edges: 0 });
  });
});

describe('applyGraphDelta', () => {
  it('appends added nodes and edges', () => {
    const current = { nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)], edges: [] };
    const delta = emptyDelta({
      addedNodes: [makeNode('n2', 'B', 'function', 'b.ts', 1)],
      addedEdges: [makeEdge('e1', 'n1', 'n2', 'call')],
    });
    const next = applyGraphDelta(current, delta);
    expect(next.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
    expect(next.edges.map((e) => e.id)).toEqual(['e1']);
  });

  it('drops removed nodes and edges', () => {
    const current = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1), makeNode('n2', 'B', 'function', 'b.ts', 1)],
      edges: [makeEdge('e1', 'n1', 'n2', 'call')],
    };
    const delta = emptyDelta({
      removedNodes: [makeNode('n2', 'B', 'function', 'b.ts', 1)],
      removedEdges: [makeEdge('e1', 'n1', 'n2', 'call')],
    });
    const next = applyGraphDelta(current, delta);
    expect(next.nodes.map((n) => n.id)).toEqual(['n1']);
    expect(next.edges).toEqual([]);
  });

  it('replaces a modified node in place rather than duplicating it', () => {
    const current = { nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)], edges: [] };
    const delta = emptyDelta({ modifiedNodes: [makeNode('n1', 'A renamed', 'function', 'a.ts', 9)] });
    const next = applyGraphDelta(current, delta);
    expect(next.nodes).toHaveLength(1);
    expect(next.nodes[0]!.label).toBe('A renamed');
    expect(next.nodes[0]!.lineNumber).toBe(9);
  });

  it('replaces a modified edge in place rather than duplicating it', () => {
    const current = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1), makeNode('n2', 'B', 'function', 'b.ts', 1)],
      edges: [makeEdge('e1', 'n1', 'n2', 'call')],
    };
    const delta = emptyDelta({ modifiedEdges: [makeEdge('e1', 'n1', 'n2', 'import')] });
    const next = applyGraphDelta(current, delta);
    expect(next.edges).toHaveLength(1);
    expect(next.edges[0]!.type).toBe('import');
  });

  // The diff engine reports removals as the *before* state and additions/modifications as the
  // *after* state. An id that moves between buckets within one delta must not be resurrected.
  it('applies removals before upserts so a re-bucketed id does not come back', () => {
    const current = {
      nodes: [makeNode('n1', 'old', 'function', 'a.ts', 1)],
      edges: [],
    };
    const delta = emptyDelta({
      removedNodes: [makeNode('n1', 'old', 'function', 'a.ts', 1)],
      addedNodes: [makeNode('n1', 'new', 'class', 'a.ts', 5)],
    });
    const next = applyGraphDelta(current, delta);
    expect(next.nodes).toHaveLength(1);
    expect(next.nodes[0]!.label).toBe('new');
    expect(next.nodes[0]!.type).toBe('class');
  });

  it('leaves untouched entries alone', () => {
    const keepNode = makeNode('keep', 'K', 'function', 'k.ts', 1);
    const keepEdge = makeEdge('keep-e', 'keep', 'keep', 'call');
    const current = { nodes: [keepNode, makeNode('gone', 'G', 'function', 'g.ts', 1)], edges: [keepEdge] };
    const delta = emptyDelta({ removedNodes: [makeNode('gone', 'G', 'function', 'g.ts', 1)] });
    const next = applyGraphDelta(current, delta);
    expect(next.nodes.map((n) => n.id)).toEqual(['keep']);
    expect(next.edges.map((e) => e.id)).toEqual(['keep-e']);
  });

  it('does not mutate the input skeleton', () => {
    const current = { nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)], edges: [] };
    const delta = emptyDelta({ addedNodes: [makeNode('n2', 'B', 'function', 'b.ts', 1)] });
    applyGraphDelta(current, delta);
    expect(current.nodes).toHaveLength(1);
  });

  it('is a no-op for an empty delta', () => {
    const current = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      edges: [makeEdge('e1', 'n1', 'n1', 'call')],
    };
    const next = applyGraphDelta(current, emptyDelta());
    expect(next.nodes).toHaveLength(1);
    expect(next.edges).toHaveLength(1);
  });
});

describe('canApplyGraphDelta', () => {
  it('accepts a delta whose removals all exist in the current revision', () => {
    const current = { nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)], edges: [] };
    const delta = emptyDelta({ removedNodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)] });
    expect(canApplyGraphDelta(current, delta)).toBe(true);
  });

  it('rejects a delta that removes a node the client never had', () => {
    const current = { nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)], edges: [] };
    const delta = emptyDelta({ removedNodes: [makeNode('missing', 'X', 'function', 'x.ts', 1)] });
    expect(canApplyGraphDelta(current, delta)).toBe(false);
  });

  it('rejects a delta that modifies a node the client never had', () => {
    const current = { nodes: [], edges: [] };
    const delta = emptyDelta({ modifiedNodes: [makeNode('missing', 'X', 'function', 'x.ts', 1)] });
    expect(canApplyGraphDelta(current, delta)).toBe(false);
  });

  it('rejects a delta that removes an edge the client never had', () => {
    const current = { nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)], edges: [] };
    const delta = emptyDelta({ removedEdges: [makeEdge('ghost', 'n1', 'n1', 'call')] });
    expect(canApplyGraphDelta(current, delta)).toBe(false);
  });

  it('rejects a delta that modifies an edge the client never had', () => {
    const current = { nodes: [], edges: [] };
    const delta = emptyDelta({ modifiedEdges: [makeEdge('ghost', 'n1', 'n2', 'call')] });
    expect(canApplyGraphDelta(current, delta)).toBe(false);
  });

  // A dangling edge would be published to the renderer and dropped there with a warning; refusing
  // the whole delta makes the caller reload instead, which is the honest outcome.
  it('rejects an added edge whose target is absent from the result', () => {
    const current = { nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)], edges: [] };
    const delta = emptyDelta({ addedEdges: [makeEdge('e1', 'n1', 'nowhere', 'call')] });
    expect(canApplyGraphDelta(current, delta)).toBe(false);
  });

  it('accepts an added edge whose far endpoint is added by the same delta', () => {
    const current = { nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)], edges: [] };
    const delta = emptyDelta({
      addedNodes: [makeNode('n2', 'B', 'function', 'b.ts', 1)],
      addedEdges: [makeEdge('e1', 'n1', 'n2', 'call')],
    });
    expect(canApplyGraphDelta(current, delta)).toBe(true);
  });

  it('accepts an added edge into a node the delta modifies', () => {
    const current = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1), makeNode('n2', 'B', 'function', 'b.ts', 1)],
      edges: [],
    };
    const delta = emptyDelta({
      modifiedNodes: [makeNode('n2', 'B', 'function', 'b.ts', 2)],
      addedEdges: [makeEdge('e1', 'n1', 'n2', 'call')],
    });
    expect(canApplyGraphDelta(current, delta)).toBe(true);
  });

  // Removing a node while adding an edge into it is contradictory; the removal wins, so the edge
  // would dangle and the delta must be refused.
  it('rejects an added edge into a node the same delta removes', () => {
    const current = {
      nodes: [makeNode('n1', 'A', 'function', 'a.ts', 1), makeNode('n2', 'B', 'function', 'b.ts', 1)],
      edges: [],
    };
    const delta = emptyDelta({
      removedNodes: [makeNode('n2', 'B', 'function', 'b.ts', 1)],
      addedEdges: [makeEdge('e1', 'n1', 'n2', 'call')],
    });
    expect(canApplyGraphDelta(current, delta)).toBe(false);
  });

  it('accepts an empty delta against any revision', () => {
    expect(canApplyGraphDelta({ nodes: [], edges: [] }, emptyDelta())).toBe(true);
  });
});
