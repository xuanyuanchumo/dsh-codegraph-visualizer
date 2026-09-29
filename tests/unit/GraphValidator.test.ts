import { describe, it, expect } from 'vitest';
import { validateGraphData } from '../../src/shared/GraphValidator.ts';
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
});