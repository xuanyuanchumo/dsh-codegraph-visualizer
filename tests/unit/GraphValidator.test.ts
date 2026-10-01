import { describe, it, expect } from 'vitest';
import {
  validateGraphData,
  sanitizeGraphData,
  coerceNode,
  coerceEdge,
  coerceGraphData,
  filterSelfLoopEdges,
  sanitizeTypedGraph,
} from '../../src/shared/GraphValidator.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';

describe('GraphValidator', () => {
  it('validates well-formed graph data', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'src/foo.ts', properties: {} },
        { id: 'n2', label: 'Bar', type: 'class', filePath: 'src/bar.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 1 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);
    expect(issues).toHaveLength(0);
  });

  it('normalizes node type aliases', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'func', filePath: 'src/foo.ts', properties: {} },
        { id: 'n2', label: 'Bar', type: 'cls', filePath: 'src/bar.ts', properties: {} },
        { id: 'n3', label: 'Baz', type: 'iface', filePath: 'src/baz.ts', properties: {} },
      ],
      edges: [],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 3, edgeCount: 0 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.nodes[0]!.type).toBe('function');
    expect(data.nodes[1]!.type).toBe('class');
    expect(data.nodes[2]!.type).toBe('interface');
    expect(issues.filter(i => i.level === 'auto-corrected')).toHaveLength(0);
  });

  it('normalizes edge type aliases', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'src/foo.ts', properties: {} },
        { id: 'n2', label: 'Bar', type: 'class', filePath: 'src/bar.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'calls', properties: {} },
        { id: 'e2', source: 'n1', target: 'n2', type: 'extends', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 2 },
    };

    const { data } = validateGraphData(input);
    expect(data.edges[0]!.type).toBe('call');
    expect(data.edges[1]!.type).toBe('extend');
  });

  it('auto-fixes missing fields with defaults', () => {
    const input = {
      nodes: [
        { id: 'n1', type: 'function', properties: {} },
      ],
      edges: [],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 1, edgeCount: 0 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.nodes[0]!.label).toBe('n1');
    expect(data.nodes[0]!.filePath).toBe('');
    expect(issues.some(i => i.message.includes('label missing'))).toBe(true);
    expect(issues.some(i => i.message.includes('filePath missing'))).toBe(true);
  });

  it('drops nodes with missing id', () => {
    const input = {
      nodes: [
        { label: 'noId', type: 'function', filePath: 'src/foo.ts', properties: {} },
        { id: 'n2', label: 'hasId', type: 'class', filePath: 'src/bar.ts', properties: {} },
      ],
      edges: [],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 0 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0]!.id).toBe('n2');
    expect(issues.some(i => i.level === 'dropped' && i.message.includes('missing or invalid id'))).toBe(true);
  });

  it('drops edges with missing source or target', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'src/foo.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'nonexistent', type: 'call', properties: {} },
        { id: 'e2', source: 'missing', target: 'n1', type: 'call', properties: {} },
        { id: 'e3', source: 'n1', target: 'n1', type: 'call', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 1, edgeCount: 3 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0]!.id).toBe('e3');
    expect(issues.filter(i => i.level === 'dropped')).toHaveLength(2);
  });

  it('drops duplicate node ids', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'first', type: 'function', filePath: 'a.ts', properties: {} },
        { id: 'n1', label: 'second', type: 'class', filePath: 'b.ts', properties: {} },
      ],
      edges: [],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 0 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0]!.label).toBe('first');
    expect(issues.some(i => i.level === 'dropped' && i.message.includes('duplicate'))).toBe(true);
  });

  it('clamps edge weight to [0, 1]', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
        { id: 'n2', label: 'bar', type: 'function', filePath: 'b.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', weight: -0.5, properties: {} },
        { id: 'e2', source: 'n1', target: 'n2', type: 'call', weight: 2.0, properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 2 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.edges[0]!.weight).toBe(0);
    expect(data.edges[1]!.weight).toBe(1);
    expect(issues.filter(i => i.level === 'auto-corrected' && i.message.includes('weight'))).toHaveLength(2);
  });

  it('handles null/undefined input gracefully', () => {
    const { data, issues } = validateGraphData(null);
    expect(data.nodes).toHaveLength(0);
    expect(data.edges).toHaveLength(0);
    expect(issues.some(i => i.level === 'fatal')).toBe(true);
  });

  it('handles non-array nodes/edges gracefully', () => {
    const input = {
      nodes: 'not an array',
      edges: 42,
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 0, edgeCount: 0 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.nodes).toHaveLength(0);
    expect(data.edges).toHaveLength(0);
    expect(issues.some(i => i.level === 'auto-corrected' && i.message.includes('not an array'))).toBe(true);
  });

  it('preserves layers when valid', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
      ],
      edges: [],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 1, edgeCount: 0 },
      layers: [{ id: 'l1', name: 'Layer 1', nodeIds: ['n1'] }],
    };

    const { data } = validateGraphData(input);
    expect(data.layers).toBeDefined();
    expect(data.layers).toHaveLength(1);
    expect(data.layers![0]!.id).toBe('l1');
  });

  it('auto-corrects unknown node type to function', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'unknown_type', filePath: 'a.ts', properties: {} },
      ],
      edges: [],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 1, edgeCount: 0 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.nodes[0]!.type).toBe('function');
    expect(issues.some(i => i.level === 'auto-corrected' && i.message.includes('unknown type'))).toBe(true);
  });

  it('auto-generates metadata when missing', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
      ],
      edges: [],
    };

    const { data, issues } = validateGraphData(input);
    expect(issues.some(i => i.level === 'auto-corrected' && i.message.includes('metadata missing'))).toBe(true);
    expect(data.metadata.nodeCount).toBe(1);
    expect(data.metadata.edgeCount).toBe(0);
  });

  it('auto-corrects unknown edge type to association', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
        { id: 'n2', label: 'bar', type: 'class', filePath: 'b.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'unknown_edge', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 1 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.edges[0]!.type).toBe('association');
    expect(issues.some(i => i.level === 'auto-corrected' && i.message.includes('unknown type'))).toBe(true);
  });

  it('auto-corrects invalid edge direction', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
        { id: 'n2', label: 'bar', type: 'class', filePath: 'b.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', direction: 'sideways', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 1 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.edges[0]!.direction).toBe('forward');
    expect(issues.some(i => i.level === 'auto-corrected' && i.message.includes('direction'))).toBe(true);
  });

  it('drops duplicate edge ids', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
        { id: 'n2', label: 'bar', type: 'class', filePath: 'b.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
        { id: 'e1', source: 'n2', target: 'n1', type: 'call', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 2 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.edges).toHaveLength(1);
    expect(issues.some(i => i.level === 'dropped' && i.message.includes('duplicate edge'))).toBe(true);
  });

  it('sanitizes node tags and properties', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', tags: null, properties: null },
      ],
      edges: [],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 1, edgeCount: 0 },
    };

    const { data } = validateGraphData(input);
    expect(data.nodes[0]!.tags).toEqual([]);
    expect(data.nodes[0]!.properties).toEqual({});
  });

  it('sanitizes edge properties', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
        { id: 'n2', label: 'bar', type: 'class', filePath: 'b.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: null },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 1 },
    };

    const { data } = validateGraphData(input);
    expect(data.edges[0]!.properties).toEqual({});
  });

  it('drops edges with missing source', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', target: 'n1', type: 'call', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 1, edgeCount: 1 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.edges).toHaveLength(0);
    expect(issues.some(i => i.level === 'dropped' && i.message.includes('source'))).toBe(true);
  });

  it('drops edges with missing target', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', type: 'call', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 1, edgeCount: 1 },
    };

    const { data, issues } = validateGraphData(input);
    expect(data.edges).toHaveLength(0);
    expect(issues.some(i => i.level === 'dropped' && i.message.includes('target'))).toBe(true);
  });
});

describe('sanitizeGraphData', () => {
  it('sanitizes well-formed graph data', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'src/foo.ts', properties: {} },
        { id: 'n2', label: 'Bar', type: 'class', filePath: 'src/bar.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 1 },
    };

    const { data, issues } = sanitizeGraphData(input);
    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);
    expect(issues).toHaveLength(0);
  });

  it('handles null/undefined input gracefully', () => {
    const { data, issues } = sanitizeGraphData(null);
    expect(data.nodes).toHaveLength(0);
    expect(data.edges).toHaveLength(0);
    expect(issues.some(i => i.level === 'fatal')).toBe(true);
  });

  it('handles non-object input gracefully', () => {
    const { data, issues } = sanitizeGraphData('not an object');
    expect(data.nodes).toHaveLength(0);
    expect(data.edges).toHaveLength(0);
    expect(issues.some(i => i.level === 'fatal')).toBe(true);
  });

  it('auto-fixes missing fields with defaults', () => {
    const input = {
      nodes: [
        { id: 'n1', type: 'function', properties: {} },
      ],
      edges: [],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 1, edgeCount: 0 },
    };

    const { data, issues } = sanitizeGraphData(input);
    expect(data.nodes[0]!.label).toBe('n1');
    expect(data.nodes[0]!.filePath).toBe('');
    expect(issues.some(i => i.message.includes('label missing'))).toBe(true);
  });

  it('normalizes node type aliases', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'func', filePath: 'src/foo.ts', properties: {} },
      ],
      edges: [],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 1, edgeCount: 0 },
    };

    const { data } = sanitizeGraphData(input);
    expect(data.nodes[0]!.type).toBe('function');
  });

  it('normalizes edge type aliases', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
        { id: 'n2', label: 'bar', type: 'class', filePath: 'b.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'calls', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 1 },
    };

    const { data } = sanitizeGraphData(input);
    expect(data.edges[0]!.type).toBe('call');
  });

  it('drops nodes with missing id', () => {
    const input = {
      nodes: [
        { label: 'noId', type: 'function', filePath: 'src/foo.ts', properties: {} },
      ],
      edges: [],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 0, edgeCount: 0 },
    };

    const { data, issues } = sanitizeGraphData(input);
    expect(data.nodes).toHaveLength(0);
    expect(issues.some(i => i.level === 'dropped' && i.message.includes('missing or invalid id'))).toBe(true);
  });

  it('drops edges with missing source or target', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'nonexistent', type: 'call', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 1, edgeCount: 1 },
    };

    const { data, issues } = sanitizeGraphData(input);
    expect(data.edges).toHaveLength(1);
  });

  it('auto-generates metadata when missing', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
      ],
      edges: [],
    };

    const { data } = sanitizeGraphData(input);
    expect(data.metadata.nodeCount).toBe(1);
    expect(data.metadata.edgeCount).toBe(0);
  });

  it('clamps edge weight to [0, 1]', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
        { id: 'n2', label: 'bar', type: 'function', filePath: 'b.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', weight: -0.5, properties: {} },
        { id: 'e2', source: 'n1', target: 'n2', type: 'call', weight: 2.0, properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 2 },
    };

    const { data, issues } = sanitizeGraphData(input);
    expect(data.edges[0]!.weight).toBe(0);
    expect(data.edges[1]!.weight).toBe(1);
    expect(issues.filter(i => i.level === 'auto-corrected' && i.message.includes('weight'))).toHaveLength(2);
  });

  it('sanitizes null tags and properties on nodes', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', tags: null, properties: null },
      ],
      edges: [],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 1, edgeCount: 0 },
    };

    const { data } = sanitizeGraphData(input);
    expect(data.nodes[0]!.tags).toEqual([]);
    expect(data.nodes[0]!.properties).toEqual({});
  });

  it('sanitizes null properties on edges', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
        { id: 'n2', label: 'bar', type: 'class', filePath: 'b.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', properties: null },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 1 },
    };

    const { data } = sanitizeGraphData(input);
    expect(data.edges[0]!.properties).toEqual({});
  });

  it('handles non-array nodes/edges gracefully', () => {
    const input = {
      nodes: 'not an array',
      edges: 42,
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 0, edgeCount: 0 },
    };

    const { data } = sanitizeGraphData(input);
    expect(data.nodes).toHaveLength(0);
    expect(data.edges).toHaveLength(0);
  });

  it('preserves edge direction when valid', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
        { id: 'n2', label: 'bar', type: 'class', filePath: 'b.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call', direction: 'bidirectional', properties: {} },
        { id: 'e2', source: 'n1', target: 'n2', type: 'call', direction: 'backward', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 2 },
    };

    const { data } = sanitizeGraphData(input);
    expect(data.edges[0]!.direction).toBe('bidirectional');
    expect(data.edges[1]!.direction).toBe('backward');
  });

  it('auto-corrects unknown node type to function', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'totally_unknown', filePath: 'a.ts', properties: {} },
      ],
      edges: [],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 1, edgeCount: 0 },
    };

    const { data, issues } = sanitizeGraphData(input);
    expect(data.nodes[0]!.type).toBe('function');
    expect(issues.some(i => i.level === 'auto-corrected' && i.message.includes('unknown type'))).toBe(true);
  });

  it('auto-corrects unknown edge type to association', () => {
    const input = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
        { id: 'n2', label: 'bar', type: 'class', filePath: 'b.ts', properties: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'totally_unknown', properties: {} },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000, nodeCount: 2, edgeCount: 1 },
    };

    const { data, issues } = sanitizeGraphData(input);
    expect(data.edges[0]!.type).toBe('association');
    expect(issues.some(i => i.level === 'auto-corrected' && i.message.includes('unknown type'))).toBe(true);
  });
});
describe('coerceNode', () => {
  it('coerces a well-formed node object', () => {
    const raw = { id: 'n1', label: 'foo', type: 'function', filePath: 'src/foo.ts', lineNumber: 10, properties: { a: 1 } };
    const node = coerceNode(raw, 0);
    expect(node).not.toBeNull();
    expect(node!.id).toBe('n1');
    expect(node!.label).toBe('foo');
    expect(node!.type).toBe('function');
    expect(node!.filePath).toBe('src/foo.ts');
    expect(node!.lineNumber).toBe(10);
    expect(node!.properties).toEqual({ a: 1 });
  });

  it('uses name as label when label is missing', () => {
    const raw = { id: 'n1', name: 'barName', type: 'function', filePath: 'a.ts' };
    const node = coerceNode(raw, 0);
    expect(node!.label).toBe('barName');
  });

  it('uses id as label when both label and name are missing', () => {
    const raw = { id: 'n1', type: 'function', filePath: 'a.ts' };
    const node = coerceNode(raw, 0);
    expect(node!.label).toBe('n1');
  });

  it('generates id from index when id is missing', () => {
    const raw = { label: 'foo', type: 'function', filePath: 'a.ts' };
    const node = coerceNode(raw, 5);
    expect(node!.id).toBe('node-5');
  });

  it('uses file as filePath when filePath is missing', () => {
    const raw = { id: 'n1', label: 'foo', type: 'function', file: 'src/bar.ts' };
    const node = coerceNode(raw, 0);
    expect(node!.filePath).toBe('src/bar.ts');
  });

  it('uses line as lineNumber when lineNumber is missing', () => {
    const raw = { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts', line: 42 };
    const node = coerceNode(raw, 0);
    expect(node!.lineNumber).toBe(42);
  });

  it('defaults type to variable when type is unknown', () => {
    const raw = { id: 'n1', label: 'foo', type: 'totally_unknown', filePath: 'a.ts' };
    const node = coerceNode(raw, 0);
    expect(node!.type).toBe('variable');
  });

  it('normalizes alias types', () => {
    const raw = { id: 'n1', label: 'foo', type: 'func', filePath: 'a.ts' };
    const node = coerceNode(raw, 0);
    expect(node!.type).toBe('function');
  });

  it('returns null for null input', () => {
    expect(coerceNode(null, 0)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(coerceNode('string', 0)).toBeNull();
    expect(coerceNode(42, 0)).toBeNull();
    expect(coerceNode(undefined, 0)).toBeNull();
  });

  it('defaults properties to empty object when missing', () => {
    const raw = { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts' };
    const node = coerceNode(raw, 0);
    expect(node!.properties).toEqual({});
  });

  it('defaults lineNumber to 0 when missing', () => {
    const raw = { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts' };
    const node = coerceNode(raw, 0);
    expect(node!.lineNumber).toBe(0);
  });
});

describe('coerceEdge', () => {
  it('coerces a well-formed edge object', () => {
    const raw = { id: 'e1', source: 'n1', target: 'n2', type: 'call', direction: 'forward', weight: 0.5, properties: { a: 1 } };
    const edge = coerceEdge(raw, 0);
    expect(edge).not.toBeNull();
    expect(edge!.id).toBe('e1');
    expect(edge!.source).toBe('n1');
    expect(edge!.target).toBe('n2');
    expect(edge!.type).toBe('call');
    expect(edge!.direction).toBe('forward');
    expect(edge!.weight).toBe(0.5);
    expect(edge!.properties).toEqual({ a: 1 });
  });

  it('uses from/to as source/target when source/target are missing', () => {
    const raw = { id: 'e1', from: 'n1', to: 'n2', type: 'call' };
    const edge = coerceEdge(raw, 0);
    expect(edge!.source).toBe('n1');
    expect(edge!.target).toBe('n2');
  });

  it('returns null when both source and from are missing', () => {
    const raw = { id: 'e1', target: 'n2', type: 'call' };
    expect(coerceEdge(raw, 0)).toBeNull();
  });

  it('returns null when both target and to are missing', () => {
    const raw = { id: 'e1', source: 'n1', type: 'call' };
    expect(coerceEdge(raw, 0)).toBeNull();
  });

  it('generates id from index when id is missing', () => {
    const raw = { source: 'n1', target: 'n2', type: 'call' };
    const edge = coerceEdge(raw, 3);
    expect(edge!.id).toBe('edge-3');
  });

  it('defaults type to dependency when type is unknown', () => {
    const raw = { id: 'e1', source: 'n1', target: 'n2', type: 'totally_unknown' };
    const edge = coerceEdge(raw, 0);
    expect(edge!.type).toBe('dependency');
  });

  it('normalizes alias edge types', () => {
    const raw = { id: 'e1', source: 'n1', target: 'n2', type: 'calls' };
    const edge = coerceEdge(raw, 0);
    expect(edge!.type).toBe('call');
  });

  it('defaults direction to forward when invalid', () => {
    const raw = { id: 'e1', source: 'n1', target: 'n2', type: 'call', direction: 'sideways' };
    const edge = coerceEdge(raw, 0);
    expect(edge!.direction).toBe('forward');
  });

  it('accepts bidirectional direction', () => {
    const raw = { id: 'e1', source: 'n1', target: 'n2', type: 'call', direction: 'bidirectional' };
    const edge = coerceEdge(raw, 0);
    expect(edge!.direction).toBe('bidirectional');
  });

  it('accepts backward direction', () => {
    const raw = { id: 'e1', source: 'n1', target: 'n2', type: 'call', direction: 'backward' };
    const edge = coerceEdge(raw, 0);
    expect(edge!.direction).toBe('backward');
  });

  it('defaults weight to 1 when missing or invalid', () => {
    const raw = { id: 'e1', source: 'n1', target: 'n2', type: 'call' };
    const edge = coerceEdge(raw, 0);
    expect(edge!.weight).toBe(1);
  });

  it('defaults weight to 1 when out of [0, 1] range', () => {
    const raw1 = { id: 'e1', source: 'n1', target: 'n2', type: 'call', weight: -0.5 };
    const raw2 = { id: 'e2', source: 'n1', target: 'n2', type: 'call', weight: 2.0 };
    expect(coerceEdge(raw1, 0)!.weight).toBe(1);
    expect(coerceEdge(raw2, 0)!.weight).toBe(1);
  });

  it('returns null for null input', () => {
    expect(coerceEdge(null, 0)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(coerceEdge('string', 0)).toBeNull();
    expect(coerceEdge(42, 0)).toBeNull();
  });

  it('defaults properties to empty object when missing', () => {
    const raw = { id: 'e1', source: 'n1', target: 'n2', type: 'call' };
    const edge = coerceEdge(raw, 0);
    expect(edge!.properties).toEqual({});
  });
});

describe('coerceGraphData', () => {
  it('coerces well-formed graph data', () => {
    const raw = {
      nodes: [
        { id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts' },
        { id: 'n2', label: 'bar', type: 'class', filePath: 'b.ts' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'call' },
      ],
      metadata: { repoId: 'repo1', timestamp: 1000 },
    };
    const data = coerceGraphData(raw);
    expect(data).not.toBeNull();
    expect(data!.nodes).toHaveLength(2);
    expect(data!.edges).toHaveLength(1);
    expect(data!.metadata.repoId).toBe('repo1');
    expect(data!.metadata.timestamp).toBe(1000);
  });

  it('filters out edges with missing endpoints', () => {
    const raw = {
      nodes: [{ id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts' }],
      edges: [
        { id: 'e1', source: 'n1', target: 'nonexistent', type: 'call' },
        { id: 'e2', source: 'n1', target: 'n1', type: 'call' },
      ],
    };
    const data = coerceGraphData(raw);
    expect(data!.edges).toHaveLength(1);
    expect(data!.edges[0]!.id).toBe('e2');
  });

  it('returns null when no nodes after coercion', () => {
    const raw = { nodes: [], edges: [] };
    expect(coerceGraphData(raw)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(coerceGraphData(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(coerceGraphData('string')).toBeNull();
  });

  it('defaults metadata when missing', () => {
    const raw = {
      nodes: [{ id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts' }],
      edges: [],
    };
    const data = coerceGraphData(raw);
    expect(data!.metadata.repoId).toMatch(/^workspace-/);
    expect(data!.metadata.timestamp).toBeGreaterThan(0);
    expect(data!.metadata.truncated).toBe(false);
    expect(data!.metadata.totalNodeCount).toBe(1);
    expect(data!.metadata.totalEdgeCount).toBe(0);
  });

  it('uses metadata totalNodeCount/totalEdgeCount when provided', () => {
    const raw = {
      nodes: [{ id: 'n1', label: 'foo', type: 'function', filePath: 'a.ts' }],
      edges: [],
      metadata: { repoId: 'r1', timestamp: 500, truncated: true, totalNodeCount: 100, totalEdgeCount: 50 },
    };
    const data = coerceGraphData(raw);
    expect(data!.metadata.truncated).toBe(true);
    expect(data!.metadata.totalNodeCount).toBe(100);
    expect(data!.metadata.totalEdgeCount).toBe(50);
  });

  it('handles non-array nodes/edges', () => {
    const raw = { nodes: 'not array', edges: 42 };
    expect(coerceGraphData(raw)).toBeNull();
  });
});

describe('filterSelfLoopEdges', () => {
  it('filters out self-loop edges', () => {
    const edges: GraphEdge[] = [
      { id: 'e1' as any, source: 'n1' as any, target: 'n2' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
      { id: 'e2' as any, source: 'n1' as any, target: 'n1' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
      { id: 'e3' as any, source: 'n2' as any, target: 'n3' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
      { id: 'e4' as any, source: 'n3' as any, target: 'n3' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
    ];
    const result = filterSelfLoopEdges(edges);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('e1');
    expect(result[1]!.id).toBe('e3');
  });

  it('returns all edges when no self-loops', () => {
    const edges: GraphEdge[] = [
      { id: 'e1' as any, source: 'n1' as any, target: 'n2' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
      { id: 'e2' as any, source: 'n2' as any, target: 'n3' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
    ];
    expect(filterSelfLoopEdges(edges)).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(filterSelfLoopEdges([])).toHaveLength(0);
  });

  it('filters all edges when all are self-loops', () => {
    const edges: GraphEdge[] = [
      { id: 'e1' as any, source: 'n1' as any, target: 'n1' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
      { id: 'e2' as any, source: 'n2' as any, target: 'n2' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
    ];
    expect(filterSelfLoopEdges(edges)).toHaveLength(0);
  });
});

describe('sanitizeTypedGraph', () => {
  it('sanitizes well-formed nodes and edges', () => {
    const nodes: GraphNode[] = [
      { id: 'n1' as any, label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
      { id: 'n2' as any, label: 'bar', type: 'class', filePath: 'b.ts', properties: {} },
    ];
    const edges: GraphEdge[] = [
      { id: 'e1' as any, source: 'n1' as any, target: 'n2' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
    ];
    const result = sanitizeTypedGraph(nodes, edges);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it('drops nodes with missing id, label, type, or filePath', () => {
    const nodes: GraphNode[] = [
      { id: '' as any, label: 'noId', type: 'function', filePath: 'a.ts', properties: {} },
      { id: 'n2' as any, label: '', type: 'function', filePath: 'b.ts', properties: {} },
      { id: 'n3' as any, label: 'noType', type: '' as any, filePath: 'c.ts', properties: {} },
      { id: 'n4' as any, label: 'noPath', type: 'function', filePath: '', properties: {} },
      { id: 'n5' as any, label: 'valid', type: 'class', filePath: 'd.ts', properties: {} },
    ];
    const result = sanitizeTypedGraph(nodes, []);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.id).toBe('n5');
  });

  it('drops duplicate node ids', () => {
    const nodes: GraphNode[] = [
      { id: 'n1' as any, label: 'first', type: 'function', filePath: 'a.ts', properties: {} },
      { id: 'n1' as any, label: 'second', type: 'class', filePath: 'b.ts', properties: {} },
    ];
    const result = sanitizeTypedGraph(nodes, []);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.label).toBe('first');
  });

  it('drops edges with missing id, source, or target', () => {
    const nodes: GraphNode[] = [
      { id: 'n1' as any, label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
      { id: 'n2' as any, label: 'bar', type: 'class', filePath: 'b.ts', properties: {} },
    ];
    const edges: GraphEdge[] = [
      { id: '' as any, source: 'n1' as any, target: 'n2' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
      { id: 'e2' as any, source: '' as any, target: 'n2' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
      { id: 'e3' as any, source: 'n1' as any, target: '' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
      { id: 'e4' as any, source: 'n1' as any, target: 'n2' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
    ];
    const result = sanitizeTypedGraph(nodes, edges);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.id).toBe('e4');
  });

  it('drops self-loop edges', () => {
    const nodes: GraphNode[] = [
      { id: 'n1' as any, label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
    ];
    const edges: GraphEdge[] = [
      { id: 'e1' as any, source: 'n1' as any, target: 'n1' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
    ];
    const result = sanitizeTypedGraph(nodes, edges);
    expect(result.edges).toHaveLength(0);
  });

  it('drops edges with non-existent endpoints', () => {
    const nodes: GraphNode[] = [
      { id: 'n1' as any, label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
    ];
    const edges: GraphEdge[] = [
      { id: 'e1' as any, source: 'n1' as any, target: 'nonexistent' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
    ];
    const result = sanitizeTypedGraph(nodes, edges);
    expect(result.edges).toHaveLength(0);
  });

  it('drops duplicate edge ids', () => {
    const nodes: GraphNode[] = [
      { id: 'n1' as any, label: 'foo', type: 'function', filePath: 'a.ts', properties: {} },
      { id: 'n2' as any, label: 'bar', type: 'class', filePath: 'b.ts', properties: {} },
    ];
    const edges: GraphEdge[] = [
      { id: 'e1' as any, source: 'n1' as any, target: 'n2' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
      { id: 'e1' as any, source: 'n2' as any, target: 'n1' as any, type: 'call', direction: 'forward', weight: 1, properties: {} },
    ];
    const result = sanitizeTypedGraph(nodes, edges);
    expect(result.edges).toHaveLength(1);
  });

  it('handles empty input', () => {
    const result = sanitizeTypedGraph([], []);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});