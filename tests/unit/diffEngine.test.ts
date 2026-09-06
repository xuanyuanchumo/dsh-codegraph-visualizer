import { describe, it, expect } from 'vitest';
import { computeGraphDiff, diffToGraphData } from '../../src/merger/DiffEngine.ts';
import { makeNode, makeEdge } from '../helpers.ts';

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
});