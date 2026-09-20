import { describe, it, expect } from 'vitest';
import { computeGraphDiff, diffToGraphData } from '../../src/merger/DiffEngine.ts';
import { makeNode, makeEdge } from '../helpers.ts';
import type { GraphEdge } from '../../src/types/index.ts';

describe('DiffEngine (FR-24)', () => {
  it('should detect added nodes', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const afterNodes = [
      makeNode('n1', 'A', 'function', 'a.ts', 1),
      makeNode('n2', 'B', 'class', 'b.ts', 5),
    ];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.addedNodes).toHaveLength(1);
    expect(diff.addedNodes[0]!.id).toBe('n2');
    expect(diff.removedNodes).toHaveLength(0);
    expect(diff.modifiedNodes).toHaveLength(0);
  });

  it('should detect removed nodes', () => {
    const beforeNodes = [
      makeNode('n1', 'A', 'function', 'a.ts', 1),
      makeNode('n2', 'B', 'class', 'b.ts', 5),
    ];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.removedNodes).toHaveLength(1);
    expect(diff.removedNodes[0]!.id).toBe('n2');
    expect(diff.addedNodes).toHaveLength(0);
  });

  it('should detect modified nodes (label change)', () => {
    const beforeNodes = [makeNode('n1', 'oldName', 'function', 'a.ts', 1)];
    const afterNodes = [makeNode('n1', 'newName', 'function', 'a.ts', 1)];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
    expect(diff.modifiedNodes[0]!.label).toBe('newName');
  });

  it('should detect modified nodes (type change)', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const afterNodes = [makeNode('n1', 'A', 'class', 'a.ts', 1)];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('should detect added edges', () => {
    const beforeEdges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const afterEdges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n2', 'n3', 'import'),
    ];
    const diff = computeGraphDiff([], beforeEdges, [], afterEdges);
    expect(diff.addedEdges).toHaveLength(1);
    expect(diff.addedEdges[0]!.id).toBe('e2');
  });

  it('should detect removed edges', () => {
    const beforeEdges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n2', 'n3', 'import'),
    ];
    const afterEdges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const diff = computeGraphDiff([], beforeEdges, [], afterEdges);
    expect(diff.removedEdges).toHaveLength(1);
    expect(diff.removedEdges[0]!.id).toBe('e2');
  });

  it('should detect modified edges (type change)', () => {
    const beforeEdges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const afterEdges = [makeEdge('e1', 'n1', 'n2', 'import')];
    const diff = computeGraphDiff([], beforeEdges, [], afterEdges);
    expect(diff.modifiedEdges).toHaveLength(1);
    expect(diff.modifiedEdges[0]!.type).toBe('import');
  });

  it('should detect modified edges (source change)', () => {
    const beforeEdges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const afterEdges = [makeEdge('e1', 'n3', 'n2', 'call')];
    const diff = computeGraphDiff([], beforeEdges, [], afterEdges);
    expect(diff.modifiedEdges).toHaveLength(1);
  });

  it('should handle empty graphs', () => {
    const diff = computeGraphDiff([], [], [], []);
    expect(diff.addedNodes).toHaveLength(0);
    expect(diff.removedNodes).toHaveLength(0);
    expect(diff.modifiedNodes).toHaveLength(0);
    expect(diff.addedEdges).toHaveLength(0);
    expect(diff.removedEdges).toHaveLength(0);
    expect(diff.modifiedEdges).toHaveLength(0);
  });

  it('should handle identical graphs (no diff)', () => {
    const nodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const edges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const diff = computeGraphDiff(nodes, edges, nodes, edges);
    expect(diff.addedNodes).toHaveLength(0);
    expect(diff.removedNodes).toHaveLength(0);
    expect(diff.modifiedNodes).toHaveLength(0);
    expect(diff.addedEdges).toHaveLength(0);
    expect(diff.removedEdges).toHaveLength(0);
    expect(diff.modifiedEdges).toHaveLength(0);
  });

  it('should convert diff to graph data with status properties', () => {
    const diff = {
      addedNodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      removedNodes: [makeNode('n2', 'B', 'class', 'b.ts', 5)],
      modifiedNodes: [makeNode('n3', 'C', 'variable', 'c.ts', 10)],
      addedEdges: [makeEdge('e1', 'n1', 'n3', 'call')],
      removedEdges: [makeEdge('e2', 'n2', 'n3', 'import')],
      modifiedEdges: [makeEdge('e3', 'n1', 'n2', 'extend')],
    };
    const result = diffToGraphData(diff);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(3);
    expect(result.nodes[0]!.properties.diffStatus).toBe('added');
    expect(result.nodes[1]!.properties.diffStatus).toBe('modified');
    expect(result.nodes[2]!.properties.diffStatus).toBe('removed');
    expect(result.edges[0]!.properties.diffStatus).toBe('added');
    expect(result.edges[1]!.properties.diffStatus).toBe('modified');
    expect(result.edges[2]!.properties.diffStatus).toBe('removed');
  });

  it('should detect modified nodes (filePath change)', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const afterNodes = [makeNode('n1', 'A', 'function', 'b.ts', 1)];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('should detect modified nodes (lineNumber change)', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 10)];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('should detect modified nodes (parentId change)', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, {}, 'p1')];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, {}, 'p2')];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('should detect modified nodes (properties change)', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { exported: true })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { exported: false })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('should not mark modified when properties are deeply equal', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { exported: true, nested: { a: 1 } })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { nested: { a: 1 }, exported: true })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(0);
  });

  it('should detect modified nodes (properties key count change)', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { a: 1 })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { a: 1, b: 2 })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('should detect modified edges (target change)', () => {
    const beforeEdges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const afterEdges = [makeEdge('e1', 'n1', 'n3', 'call')];
    const diff = computeGraphDiff([], beforeEdges, [], afterEdges);
    expect(diff.modifiedEdges).toHaveLength(1);
  });

  it('should handle diffToGraphData with empty diff', () => {
    const diff = {
      addedNodes: [],
      removedNodes: [],
      modifiedNodes: [],
      addedEdges: [],
      removedEdges: [],
      modifiedEdges: [],
    };
    const result = diffToGraphData(diff);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('should preserve existing properties when adding diffStatus', () => {
    const diff = {
      addedNodes: [makeNode('n1', 'A', 'function', 'a.ts', 1, { custom: 'value' })],
      removedNodes: [],
      modifiedNodes: [],
      addedEdges: [],
      removedEdges: [],
      modifiedEdges: [],
    };
    const result = diffToGraphData(diff);
    expect(result.nodes[0]!.properties.custom).toBe('value');
    expect(result.nodes[0]!.properties.diffStatus).toBe('added');
  });

  it('deepEqual: null vs non-null returns false', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: null })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: 1 })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('deepEqual: different types (object vs primitive) returns false', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: { a: 1 } })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: 'str' })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('deepEqual: nested object difference detected', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { nested: { a: 1, b: 2 } })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { nested: { a: 1, b: 3 } })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('deepEqual: different key names detected', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { a: 1, b: 2 })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { a: 1, c: 2 })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('deepEqual: both null properties are equal', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: null })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: null })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(0);
  });

  // ---- Enhanced tests for diffToGraphData ----

  it('diffToGraphData: preserves existing edge properties when adding diffStatus', () => {
    const diff = {
      addedNodes: [],
      removedNodes: [],
      modifiedNodes: [],
      addedEdges: [makeEdge('e1', 'n1', 'n2', 'call', { weight: 5 })],
      removedEdges: [],
      modifiedEdges: [],
    };
    const result = diffToGraphData(diff);
    expect(result.edges[0]!.properties.weight).toBe(5);
    expect(result.edges[0]!.properties.diffStatus).toBe('added');
  });

  it('diffToGraphData: preserves existing properties on modified and removed edges', () => {
    const diff = {
      addedNodes: [],
      removedNodes: [],
      modifiedNodes: [],
      addedEdges: [],
      removedEdges: [makeEdge('e1', 'n1', 'n2', 'call', { weight: 3 })],
      modifiedEdges: [makeEdge('e2', 'n2', 'n3', 'import', { weight: 7 })],
    };
    const result = diffToGraphData(diff);
    expect(result.edges[0]!.properties.weight).toBe(7);
    expect(result.edges[0]!.properties.diffStatus).toBe('modified');
    expect(result.edges[1]!.properties.weight).toBe(3);
    expect(result.edges[1]!.properties.diffStatus).toBe('removed');
  });

  it('diffToGraphData: does not mutate original diff objects', () => {
    const addedNode = makeNode('n1', 'A', 'function', 'a.ts', 1, { custom: 'val' });
    const addedEdge = makeEdge('e1', 'n1', 'n2', 'call', { weight: 1 });
    const diff = {
      addedNodes: [addedNode],
      removedNodes: [],
      modifiedNodes: [],
      addedEdges: [addedEdge],
      removedEdges: [],
      modifiedEdges: [],
    };
    diffToGraphData(diff);
    // Original objects should not have diffStatus added
    expect(addedNode.properties.diffStatus).toBeUndefined();
    expect(addedEdge.properties.diffStatus).toBeUndefined();
  });

  it('diffToGraphData: handles all six categories simultaneously', () => {
    const diff = {
      addedNodes: [makeNode('n1', 'A', 'function', 'a.ts', 1)],
      removedNodes: [makeNode('n2', 'B', 'class', 'b.ts', 5)],
      modifiedNodes: [makeNode('n3', 'C', 'variable', 'c.ts', 10)],
      addedEdges: [makeEdge('e1', 'n1', 'n3', 'call')],
      removedEdges: [makeEdge('e2', 'n2', 'n3', 'import')],
      modifiedEdges: [makeEdge('e3', 'n1', 'n2', 'extend')],
    };
    const result = diffToGraphData(diff);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(3);
    // Nodes: added, modified, removed (in that order)
    expect(result.nodes[0]!.id).toBe('n1');
    expect(result.nodes[0]!.properties.diffStatus).toBe('added');
    expect(result.nodes[1]!.id).toBe('n3');
    expect(result.nodes[1]!.properties.diffStatus).toBe('modified');
    expect(result.nodes[2]!.id).toBe('n2');
    expect(result.nodes[2]!.properties.diffStatus).toBe('removed');
    // Edges: added, modified, removed (in that order)
    expect(result.edges[0]!.id).toBe('e1');
    expect(result.edges[0]!.properties.diffStatus).toBe('added');
    expect(result.edges[1]!.id).toBe('e3');
    expect(result.edges[1]!.properties.diffStatus).toBe('modified');
    expect(result.edges[2]!.id).toBe('e2');
    expect(result.edges[2]!.properties.diffStatus).toBe('removed');
  });

  // ---- Enhanced tests for computeGraphDiff comprehensive scenarios ----

  it('computeGraphDiff: handles simultaneous node and edge changes', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const afterNodes = [
      makeNode('n1', 'A-renamed', 'function', 'a.ts', 1),
      makeNode('n2', 'B', 'class', 'b.ts', 5),
    ];
    const beforeEdges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const afterEdges = [
      makeEdge('e1', 'n1', 'n2', 'import'),
      makeEdge('e2', 'n2', 'n1', 'extend'),
    ];
    const diff = computeGraphDiff(beforeNodes, beforeEdges, afterNodes, afterEdges);
    expect(diff.addedNodes).toHaveLength(1);
    expect(diff.addedNodes[0]!.id).toBe('n2');
    expect(diff.modifiedNodes).toHaveLength(1);
    expect(diff.modifiedNodes[0]!.label).toBe('A-renamed');
    expect(diff.removedNodes).toHaveLength(0);
    expect(diff.addedEdges).toHaveLength(1);
    expect(diff.addedEdges[0]!.id).toBe('e2');
    expect(diff.modifiedEdges).toHaveLength(1);
    expect(diff.modifiedEdges[0]!.type).toBe('import');
    expect(diff.removedEdges).toHaveLength(0);
  });

  it('computeGraphDiff: does not mutate input arrays', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const afterNodes = [
      makeNode('n1', 'A', 'function', 'a.ts', 1),
      makeNode('n2', 'B', 'class', 'b.ts', 5),
    ];
    const beforeEdges: GraphEdge[] = [];
    const afterEdges: GraphEdge[] = [];
    computeGraphDiff(beforeNodes, beforeEdges, afterNodes, afterEdges);
    expect(beforeNodes).toHaveLength(1);
    expect(afterNodes).toHaveLength(2);
    expect(beforeEdges).toHaveLength(0);
    expect(afterEdges).toHaveLength(0);
  });

  // ---- Enhanced tests for deepEqual edge cases ----

  it('deepEqual: array vs object with same numeric keys are detected as different', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: [1, 2] })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: { 0: 1, 1: 2 } })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('deepEqual: deeply nested equal objects are not flagged as modified', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, {
      level1: { level2: { level3: { value: 42 } } },
    })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, {
      level1: { level2: { level3: { value: 42 } } },
    })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(0);
  });

  it('deepEqual: deeply nested different objects are detected', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, {
      level1: { level2: { level3: { value: 42 } } },
    })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, {
      level1: { level2: { level3: { value: 99 } } },
    })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('deepEqual: empty objects are equal', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, {})];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, {})];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(0);
  });

  it('deepEqual: object with null value vs undefined key detected as modified', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: null })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, {})];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  // ---- Edge modification detection completeness ----

  it('computeGraphDiff: edge with same id but all three fields changed is modified once', () => {
    const beforeEdges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const afterEdges = [makeEdge('e1', 'n3', 'n4', 'import')];
    const diff = computeGraphDiff([], beforeEdges, [], afterEdges);
    expect(diff.modifiedEdges).toHaveLength(1);
    expect(diff.modifiedEdges[0]!.source).toBe('n3');
    expect(diff.modifiedEdges[0]!.target).toBe('n4');
    expect(diff.modifiedEdges[0]!.type).toBe('import');
  });

  it('computeGraphDiff: edge unchanged by properties only is not modified', () => {
    const beforeEdges = [makeEdge('e1', 'n1', 'n2', 'call', { weight: 5 })];
    const afterEdges = [makeEdge('e1', 'n1', 'n2', 'call', { weight: 10 })];
    const diff = computeGraphDiff([], beforeEdges, [], afterEdges);
    // Edge properties changes are NOT tracked as modifications (only type/source/target)
    expect(diff.modifiedEdges).toHaveLength(0);
  });

  it('computeGraphDiff: multiple added and removed nodes and edges', () => {
    const beforeNodes = [
      makeNode('n1', 'A', 'function', 'a.ts', 1),
      makeNode('n2', 'B', 'class', 'b.ts', 5),
    ];
    const afterNodes = [
      makeNode('n2', 'B', 'class', 'b.ts', 5),
      makeNode('n3', 'C', 'variable', 'c.ts', 10),
      makeNode('n4', 'D', 'interface', 'd.ts', 15),
    ];
    const beforeEdges = [
      makeEdge('e1', 'n1', 'n2', 'call'),
      makeEdge('e2', 'n2', 'n3', 'import'),
    ];
    const afterEdges = [
      makeEdge('e2', 'n2', 'n3', 'import'),
      makeEdge('e3', 'n3', 'n4', 'dependency'),
    ];
    const diff = computeGraphDiff(beforeNodes, beforeEdges, afterNodes, afterEdges);
    expect(diff.addedNodes).toHaveLength(2);
    expect(diff.addedNodes.map(n => n.id)).toContain('n3');
    expect(diff.addedNodes.map(n => n.id)).toContain('n4');
    expect(diff.removedNodes).toHaveLength(1);
    expect(diff.removedNodes[0]!.id).toBe('n1');
    expect(diff.modifiedNodes).toHaveLength(0);
    expect(diff.addedEdges).toHaveLength(1);
    expect(diff.addedEdges[0]!.id).toBe('e3');
    expect(diff.removedEdges).toHaveLength(1);
    expect(diff.removedEdges[0]!.id).toBe('e1');
    expect(diff.modifiedEdges).toHaveLength(0);
  });

  // ---- deepEqual array boundary tests ----

  it('deepEqual: arrays of different lengths are detected as different (modified)', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: [1, 2] })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: [1, 2, 3] })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('deepEqual: arrays of same length but different elements are detected as different (modified)', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: [1, 2, 3] })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: [1, 2, 4] })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('deepEqual: arrays with nested objects - equal arrays are not flagged as modified', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: [{ a: 1 }, { b: 2 }] })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: [{ a: 1 }, { b: 2 }] })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(0);
  });

  it('deepEqual: arrays with nested objects - different nested objects are detected (modified)', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: [{ a: 1 }, { b: 2 }] })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: [{ a: 1 }, { b: 3 }] })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  it('deepEqual: empty arrays are equal (not modified)', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: [] })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: [] })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(0);
  });

  it('deepEqual: array vs non-array object returns false (modified)', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: [1, 2] })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: { length: 2 } })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  // ---- deepEqual circular reference tests ----

  it('deepEqual: circular references with same structure are equal (not modified)', () => {
    const objA: Record<string, unknown> = {};
    objA.self = objA;
    const objB: Record<string, unknown> = {};
    objB.self = objB;
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: objA })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: objB })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(0);
  });

  it('deepEqual: circular references with different structure are detected (modified)', () => {
    const objA: Record<string, unknown> = {};
    objA.self = objA;
    const objC: Record<string, unknown> = {};
    objC.self = {}; // different: points to a separate empty object, not itself
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: objA })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { x: objC })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  // ---- deepEqual depth limit tests ----

  it('deepEqual: objects within depth limit are compared normally (not modified)', () => {
    let before: Record<string, unknown> = { value: 42 };
    let after: Record<string, unknown> = { value: 42 };
    // Create 40 levels of nesting (well within MAX_DEEP_EQUAL_DEPTH of 50)
    for (let i = 0; i < 40; i++) {
      before = { nested: before };
      after = { nested: after };
    }
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { deep: before })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { deep: after })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(0);
  });

  it('deepEqual: exceeds MAX_DEEP_EQUAL_DEPTH (50) returns false (modified)', () => {
    let before: Record<string, unknown> = { value: 42 };
    let after: Record<string, unknown> = { value: 42 };
    // Create 55 levels of nesting (exceeds MAX_DEEP_EQUAL_DEPTH of 50)
    for (let i = 0; i < 55; i++) {
      before = { nested: before };
      after = { nested: after };
    }
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { deep: before })];
    const afterNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1, { deep: after })];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.modifiedNodes).toHaveLength(1);
  });

  // ---- computeGraphDiff boundary tests ----

  it('computeGraphDiff: only node changes with no edges', () => {
    const beforeNodes = [makeNode('n1', 'A', 'function', 'a.ts', 1)];
    const afterNodes = [
      makeNode('n1', 'A-renamed', 'function', 'a.ts', 1),
      makeNode('n2', 'B', 'class', 'b.ts', 5),
    ];
    const diff = computeGraphDiff(beforeNodes, [], afterNodes, []);
    expect(diff.addedNodes).toHaveLength(1);
    expect(diff.addedNodes[0]!.id).toBe('n2');
    expect(diff.modifiedNodes).toHaveLength(1);
    expect(diff.modifiedNodes[0]!.label).toBe('A-renamed');
    expect(diff.removedNodes).toHaveLength(0);
    expect(diff.addedEdges).toHaveLength(0);
    expect(diff.removedEdges).toHaveLength(0);
    expect(diff.modifiedEdges).toHaveLength(0);
  });

  it('computeGraphDiff: only edge changes with no nodes', () => {
    const beforeEdges = [makeEdge('e1', 'n1', 'n2', 'call')];
    const afterEdges = [
      makeEdge('e1', 'n1', 'n2', 'import'),
      makeEdge('e2', 'n3', 'n4', 'extend'),
    ];
    const diff = computeGraphDiff([], beforeEdges, [], afterEdges);
    expect(diff.addedEdges).toHaveLength(1);
    expect(diff.addedEdges[0]!.id).toBe('e2');
    expect(diff.modifiedEdges).toHaveLength(1);
    expect(diff.modifiedEdges[0]!.type).toBe('import');
    expect(diff.removedEdges).toHaveLength(0);
    expect(diff.addedNodes).toHaveLength(0);
    expect(diff.removedNodes).toHaveLength(0);
    expect(diff.modifiedNodes).toHaveLength(0);
  });
});