import { describe, it, expect } from 'vitest';
import { coerceNode, coerceEdge, validateGraphData } from '../../src/client/validators.ts';

describe('coerceNode', () => {
  it('should return null for non-object raw', () => {
    expect(coerceNode(null, 0)).toBeNull();
    expect(coerceNode(undefined, 0)).toBeNull();
    expect(coerceNode('string', 0)).toBeNull();
    expect(coerceNode(42, 0)).toBeNull();
  });

  it('should generate default id from index when missing', () => {
    const node = coerceNode({ label: 'foo' }, 3);
    expect(node).not.toBeNull();
    expect(node!.id).toBe('node-3');
  });

  it('should use label field for label', () => {
    const node = coerceNode({ id: 'n1', label: 'myFunc' }, 0);
    expect(node!.label).toBe('myFunc');
  });

  it('should fall back to name field when label missing', () => {
    const node = coerceNode({ id: 'n1', name: 'myFunc' }, 0);
    expect(node!.label).toBe('myFunc');
  });

  it('should fall back to id when both label and name missing', () => {
    const node = coerceNode({ id: 'n1' }, 0);
    expect(node!.label).toBe('n1');
  });

  it('should preserve valid type values', () => {
    for (const type of ['function', 'class', 'variable', 'module', 'interface', 'type'] as const) {
      const node = coerceNode({ id: 'n1', label: 'x', type }, 0);
      expect(node!.type).toBe(type);
    }
  });

  it('should fall back to variable for invalid type', () => {
    const node = coerceNode({ id: 'n1', label: 'x', type: 'unknown' }, 0);
    expect(node!.type).toBe('variable');
  });

  it('should use filePath field', () => {
    const node = coerceNode({ id: 'n1', label: 'x', filePath: '/src/foo.ts' }, 0);
    expect(node!.filePath).toBe('/src/foo.ts');
  });

  it('should fall back to file alias when filePath missing', () => {
    const node = coerceNode({ id: 'n1', label: 'x', file: '/src/foo.ts' }, 0);
    expect(node!.filePath).toBe('/src/foo.ts');
  });

  it('should use lineNumber field', () => {
    const node = coerceNode({ id: 'n1', label: 'x', lineNumber: 42 }, 0);
    expect(node!.lineNumber).toBe(42);
  });

  it('should fall back to line alias when lineNumber missing', () => {
    const node = coerceNode({ id: 'n1', label: 'x', line: 42 }, 0);
    expect(node!.lineNumber).toBe(42);
  });

  it('should default lineNumber to 0 when missing', () => {
    const node = coerceNode({ id: 'n1', label: 'x' }, 0);
    expect(node!.lineNumber).toBe(0);
  });

  it('should fall back to empty object for non-object properties', () => {
    const node = coerceNode({ id: 'n1', label: 'x', properties: 'bad' }, 0);
    expect(node!.properties).toEqual({});
  });

  it('should preserve object properties', () => {
    const props = { key: 'value', nested: { a: 1 } };
    const node = coerceNode({ id: 'n1', label: 'x', properties: props }, 0);
    expect(node!.properties).toEqual(props);
  });
});

describe('coerceEdge', () => {
  it('should return null for non-object raw', () => {
    expect(coerceEdge(null, 0)).toBeNull();
    expect(coerceEdge(undefined, 0)).toBeNull();
    expect(coerceEdge('string', 0)).toBeNull();
  });

  it('should generate default id from index when missing', () => {
    const edge = coerceEdge({ source: 'a', target: 'b' }, 2);
    expect(edge).not.toBeNull();
    expect(edge!.id).toBe('edge-2');
  });

  it('should use source field', () => {
    const edge = coerceEdge({ id: 'e1', source: 'a', target: 'b' }, 0);
    expect(edge!.source).toBe('a');
  });

  it('should fall back to from alias when source missing', () => {
    const edge = coerceEdge({ id: 'e1', from: 'a', target: 'b' }, 0);
    expect(edge!.source).toBe('a');
  });

  it('should return null when source and from both missing', () => {
    const edge = coerceEdge({ id: 'e1', target: 'b' }, 0);
    expect(edge).toBeNull();
  });

  it('should use target field', () => {
    const edge = coerceEdge({ id: 'e1', source: 'a', target: 'b' }, 0);
    expect(edge!.target).toBe('b');
  });

  it('should fall back to to alias when target missing', () => {
    const edge = coerceEdge({ id: 'e1', source: 'a', to: 'b' }, 0);
    expect(edge!.target).toBe('b');
  });

  it('should return null when target and to both missing', () => {
    const edge = coerceEdge({ id: 'e1', source: 'a' }, 0);
    expect(edge).toBeNull();
  });

  it('should preserve valid type values', () => {
    for (const type of ['call', 'import', 'extend', 'implement', 'dependency'] as const) {
      const edge = coerceEdge({ id: 'e1', source: 'a', target: 'b', type }, 0);
      expect(edge!.type).toBe(type);
    }
  });

  it('should fall back to dependency for invalid type', () => {
    const edge = coerceEdge({ id: 'e1', source: 'a', target: 'b', type: 'unknown' }, 0);
    expect(edge!.type).toBe('dependency');
  });

  it('should fall back to empty object for non-object properties', () => {
    const edge = coerceEdge({ id: 'e1', source: 'a', target: 'b', properties: 42 }, 0);
    expect(edge!.properties).toEqual({});
  });
});

describe('validateGraphData', () => {
  it('should return null for non-object raw', () => {
    expect(validateGraphData(null)).toBeNull();
    expect(validateGraphData(undefined)).toBeNull();
    expect(validateGraphData('string')).toBeNull();
    expect(validateGraphData(42)).toBeNull();
  });

  it('should fall back to empty arrays for non-array nodes/edges', () => {
    const result = validateGraphData({ nodes: 'bad', edges: 'bad' });
    expect(result).toBeNull();
  });

  it('should return null when no valid nodes after filtering', () => {
    const result = validateGraphData({ nodes: [], edges: [] });
    expect(result).toBeNull();
  });

  it('should return null when all nodes are invalid', () => {
    const result = validateGraphData({ nodes: [null, 'bad', 42], edges: [] });
    expect(result).toBeNull();
  });

  it('should use metadata.repoId when provided', () => {
    const result = validateGraphData({
      nodes: [{ id: 'n1', label: 'x' }],
      metadata: { repoId: 'my-repo' },
    });
    expect(result).not.toBeNull();
    expect(result!.metadata.repoId).toBe('my-repo');
  });

  it('should generate default repoId when missing', () => {
    const result = validateGraphData({
      nodes: [{ id: 'n1', label: 'x' }],
    });
    expect(result).not.toBeNull();
    expect(result!.metadata.repoId).toMatch(/^workspace-\d+$/);
  });

  it('should use metadata.timestamp when it is a number', () => {
    const result = validateGraphData({
      nodes: [{ id: 'n1', label: 'x' }],
      metadata: { timestamp: 12345 },
    });
    expect(result).not.toBeNull();
    expect(result!.metadata.timestamp).toBe(12345);
  });

  it('should use Date.now() when timestamp is not a number', () => {
    const before = Date.now();
    const result = validateGraphData({
      nodes: [{ id: 'n1', label: 'x' }],
      metadata: { timestamp: 'bad' },
    });
    const after = Date.now();
    expect(result).not.toBeNull();
    expect(result!.metadata.timestamp).toBeGreaterThanOrEqual(before);
    expect(result!.metadata.timestamp).toBeLessThanOrEqual(after);
  });

  it('should correctly calculate nodeCount and edgeCount', () => {
    const result = validateGraphData({
      nodes: [{ id: 'n1', label: 'a' }, { id: 'n2', label: 'b' }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });
    expect(result).not.toBeNull();
    expect(result!.metadata.nodeCount).toBe(2);
    expect(result!.metadata.edgeCount).toBe(1);
  });

  it('should filter out invalid nodes and edges', () => {
    const result = validateGraphData({
      nodes: [{ id: 'n1', label: 'a' }, null, 'bad'],
      edges: [{ id: 'e1', source: 'n1', target: 'n1' }, null],
    });
    expect(result).not.toBeNull();
    expect(result!.nodes.length).toBe(1);
    expect(result!.edges.length).toBe(1);
  });
});