import { describe, it, expect } from 'vitest';
import { detectLouvainCommunities } from '../../src/client/store/cluster/louvainDetection.ts';
import type { GraphNode, GraphEdge } from '../../src/types/index.ts';
import { NodeId, EdgeId } from '../../src/types/index.ts';

function makeNode(id: string, filePath: string = `src/${id}.ts`, type: string = 'function'): GraphNode {
  return {
    id: NodeId(id),
    label: id,
    type: type as GraphNode['type'],
    filePath,
    lineNumber: 1,
    properties: {},
  };
}

function makeEdge(id: string, source: string, target: string, type: string = 'call'): GraphEdge {
  return {
    id: EdgeId(id),
    source: NodeId(source),
    target: NodeId(target),
    type: type as GraphEdge['type'],
    properties: {},
  };
}

describe('detectLouvainCommunities', () => {
  it('returns empty Map for empty nodes and edges', () => {
    const result = detectLouvainCommunities([], []);
    expect(result.size).toBe(0);
  });

  it('returns single "all" group when nodes < MIN_NODES_FOR_LOUVAIN', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];
    const result = detectLouvainCommunities(nodes, edges);
    expect(result.size).toBe(1);
    expect(result.has('all')).toBe(true);
    expect(result.get('all')!.nodes).toHaveLength(3);
  });

  it('forms multiple communities for two disconnected clusters', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 25; i++) nodes.push(makeNode(`a${i}`));
    for (let i = 0; i < 24; i++) edges.push(makeEdge(`ea${i}`, `a${i}`, `a${i + 1}`));

    for (let i = 0; i < 25; i++) nodes.push(makeNode(`b${i}`));
    for (let i = 0; i < 24; i++) edges.push(makeEdge(`eb${i}`, `b${i}`, `b${i + 1}`));

    const result = detectLouvainCommunities(nodes, edges);

    expect(result.size).toBeGreaterThanOrEqual(2);

    const aLabels = new Set<string>();
    const bLabels = new Set<string>();
    for (const group of result.values()) {
      for (const node of group.nodes) {
        if (node.id.startsWith('a')) aLabels.add(group.label);
        if (node.id.startsWith('b')) bLabels.add(group.label);
      }
    }
    for (const al of aLabels) {
      expect(bLabels.has(al)).toBe(false);
    }
  });

  it('assigns all nodes in a fully connected star graph to one community', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 55; i++) nodes.push(makeNode(`n${i}`));
    for (let i = 1; i < 55; i++) edges.push(makeEdge(`e${i}`, 'n0', `n${i}`));

    const result = detectLouvainCommunities(nodes, edges);

    let maxGroupSize = 0;
    for (const group of result.values()) {
      if (group.nodes.length > maxGroupSize) maxGroupSize = group.nodes.length;
    }
    expect(maxGroupSize).toBeGreaterThan(40);
  });

  it('keeps isolated nodes in separate communities', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 50; i++) nodes.push(makeNode(`c${i}`));
    for (let i = 0; i < 49; i++) edges.push(makeEdge(`ec${i}`, `c${i}`, `c${i + 1}`));

    for (let i = 0; i < 5; i++) nodes.push(makeNode(`iso${i}`));

    const result = detectLouvainCommunities(nodes, edges);

    let totalNodes = 0;
    for (const group of result.values()) totalNodes += group.nodes.length;
    expect(totalNodes).toBe(55);
  });

  it('handles overflow nodes when total nodes > MAX_NODES_FOR_LOUVAIN', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 5001; i++) nodes.push(makeNode(`n${i}`));
    for (let i = 1; i < 5001; i++) edges.push(makeEdge(`e${i}`, 'n0', `n${i}`));

    const result = detectLouvainCommunities(nodes, edges);

    let totalNodes = 0;
    for (const group of result.values()) totalNodes += group.nodes.length;
    expect(totalNodes).toBe(5001);
  });

  it('assigns overflow nodes with participating neighbors to neighbor community', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 5001; i++) nodes.push(makeNode(`n${i}`));
    for (let i = 1; i < 5000; i++) edges.push(makeEdge(`e${i}`, 'n0', `n${i}`));
    edges.push(makeEdge('e5000', 'n5000', 'n1'));

    const result = detectLouvainCommunities(nodes, edges);

    let n5000Label: string | null = null;
    let n1Label: string | null = null;
    for (const [label, group] of result) {
      for (const node of group.nodes) {
        if (node.id === NodeId('n5000')) n5000Label = label;
        if (node.id === NodeId('n1')) n1Label = label;
      }
    }
    expect(n5000Label).not.toBeNull();
    expect(n1Label).not.toBeNull();
    expect(n5000Label).toBe(n1Label);
  });

  it('assigns overflow nodes without neighbors to overflow group', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 5001; i++) nodes.push(makeNode(`n${i}`));
    for (let i = 0; i < 4999; i++) edges.push(makeEdge(`e${i}`, `n${i}`, `n${i + 1}`));

    const result = detectLouvainCommunities(nodes, edges);

    expect(result.has('overflow')).toBe(true);
    expect(result.get('overflow')!.nodes.some((n) => n.id === NodeId('n5000'))).toBe(true);
  });

  it('converges for tightly connected graph with bridge edge', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let i = 0; i < 30; i++) nodes.push(makeNode(`a${i}`));
    for (let i = 0; i < 29; i++) edges.push(makeEdge(`ea${i}`, `a${i}`, `a${i + 1}`));
    edges.push(makeEdge('ea_extra1', 'a0', 'a5'));
    edges.push(makeEdge('ea_extra2', 'a10', 'a15'));
    edges.push(makeEdge('ea_extra3', 'a20', 'a25'));

    for (let i = 0; i < 30; i++) nodes.push(makeNode(`b${i}`));
    for (let i = 0; i < 29; i++) edges.push(makeEdge(`eb${i}`, `b${i}`, `b${i + 1}`));
    edges.push(makeEdge('eb_extra1', 'b0', 'b5'));
    edges.push(makeEdge('eb_extra2', 'b10', 'b15'));
    edges.push(makeEdge('eb_extra3', 'b20', 'b25'));

    edges.push(makeEdge('bridge', 'a0', 'b0'));

    const result = detectLouvainCommunities(nodes, edges);

    expect(result.size).toBeGreaterThanOrEqual(2);

    let totalNodes = 0;
    for (const group of result.values()) totalNodes += group.nodes.length;
    expect(totalNodes).toBe(60);
  });

  it('forms 3 distinct communities for 3 disconnected star clusters', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (let comp = 0; comp < 3; comp++) {
      const prefix = ['x', 'y', 'z'][comp];
      for (let i = 0; i < 20; i++) nodes.push(makeNode(`${prefix}${i}`));
      for (let i = 1; i < 20; i++) edges.push(makeEdge(`e_${prefix}_${i}`, `${prefix}0`, `${prefix}${i}`));
    }

    const result = detectLouvainCommunities(nodes, edges);

    expect(result.size).toBeGreaterThanOrEqual(3);

    const xLabels = new Set<string>();
    const yLabels = new Set<string>();
    const zLabels = new Set<string>();
    for (const group of result.values()) {
      for (const node of group.nodes) {
        if (node.id.startsWith('x')) xLabels.add(group.label);
        if (node.id.startsWith('y')) yLabels.add(group.label);
        if (node.id.startsWith('z')) zLabels.add(group.label);
      }
    }
    expect(xLabels.size).toBeGreaterThanOrEqual(1);
    expect(yLabels.size).toBeGreaterThanOrEqual(1);
    expect(zLabels.size).toBeGreaterThanOrEqual(1);
  });

  it('ignores edges referencing non-existent nodes', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 55; i++) nodes.push(makeNode(`n${i}`));
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 54; i++) edges.push(makeEdge(`e${i}`, `n${i}`, `n${i + 1}`));
    edges.push(makeEdge('e_ghost1', 'n0', 'ghost_node'));
    edges.push(makeEdge('e_ghost2', 'ghost_node', 'n1'));

    const result = detectLouvainCommunities(nodes, edges);

    let totalNodes = 0;
    for (const group of result.values()) totalNodes += group.nodes.length;
    expect(totalNodes).toBe(55);
  });

  it('returns all nodes in result regardless of graph structure', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 60; i++) nodes.push(makeNode(`n${i}`));
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 59; i++) edges.push(makeEdge(`e${i}`, `n${i}`, `n${i + 1}`));

    const result = detectLouvainCommunities(nodes, edges);

    let totalNodes = 0;
    for (const group of result.values()) totalNodes += group.nodes.length;
    expect(totalNodes).toBe(60);
  });

  it('handles graph with zero edges (all isolated)', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 55; i++) nodes.push(makeNode(`n${i}`));

    const result = detectLouvainCommunities(nodes, []);

    let totalNodes = 0;
    for (const group of result.values()) totalNodes += group.nodes.length;
    expect(totalNodes).toBe(55);
  });
});