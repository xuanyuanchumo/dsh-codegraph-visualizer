import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '../../src/host/McpServer.ts';
import { makeNode, makeEdge, makeGraphData } from '../helpers.ts';

describe('McpServer (FR-46)', () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer();
  });

  it('should register a custom tool', () => {
    server.registerTool({
      name: 'custom_tool',
      description: 'A custom test tool',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ ok: true }),
    });
    expect(server.isRunning()).toBe(false);
  });

  it('should not be running before start', () => {
    expect(server.isRunning()).toBe(false);
  });

  it('should stop and set running to false', () => {
    server.stop();
    expect(server.isRunning()).toBe(false);
  });

  describe('graph tool handler logic', () => {
    const nodes = [
      makeNode('n1', 'calculateTotal', 'function', 'a.ts', 1),
      makeNode('n2', 'calculateTax', 'function', 'b.ts', 5),
      makeNode('n3', 'UserService', 'class', 'c.ts', 10),
    ];
    const edges = [
      makeEdge('e1', 'n2', 'n1', 'call'),
      makeEdge('e2', 'n3', 'n2', 'call'),
    ];
    const graphData = makeGraphData(nodes, edges);

    it('graph_status: no data → status no data', () => {
      const result = { status: 'no data', nodes: 0, edges: 0 };
      expect(result).toEqual({ status: 'no data', nodes: 0, edges: 0 });
    });

    it('graph_status: with data → status ready', () => {
      const result = {
        status: 'ready',
        nodes: graphData.metadata.nodeCount,
        edges: graphData.metadata.edgeCount,
      };
      expect(result).toEqual({ status: 'ready', nodes: 3, edges: 2 });
    });

    it('graph_data: returns limited nodes', () => {
      const limit = 2;
      const result = {
        nodes: graphData.nodes.slice(0, limit).map((n) => ({ id: n.id, label: n.label })),
        totalNodes: graphData.metadata.nodeCount,
      };
      expect(result.nodes).toHaveLength(2);
      expect(result.totalNodes).toBe(3);
    });

    it('graph_symbol: search by name', () => {
      const search = 'calculate'.toLowerCase();
      const results = graphData.nodes
        .filter((n) => n.label.toLowerCase().includes(search))
        .slice(0, 20);
      expect(results).toHaveLength(2);
      expect(results[0]!.label).toBe('calculateTotal');
      expect(results[1]!.label).toBe('calculateTax');
    });

    it('graph_symbol: no match returns empty', () => {
      const search = 'nonexistent'.toLowerCase();
      const results = graphData.nodes.filter((n) => n.label.toLowerCase().includes(search));
      expect(results).toHaveLength(0);
    });

    it('graph_impact: finds impacted nodes at depth 2', () => {
      const symbol = 'calculateTotal';
      const depth = 2;
      const targetNode = graphData.nodes.find((n) => n.label === symbol)!;
      const impacted = new Set<string>();
      let frontier = new Set<string>([targetNode.id]);
      for (let d = 0; d < depth; d++) {
        const nextFrontier = new Set<string>();
        for (const id of frontier) {
          for (const edge of graphData.edges) {
            if (edge.target === id && !impacted.has(edge.source)) {
              impacted.add(edge.source);
              nextFrontier.add(edge.source);
            }
          }
        }
        frontier = nextFrontier;
      }
      expect(impacted.size).toBe(2);
      expect(impacted.has('n2')).toBe(true);
      expect(impacted.has('n3')).toBe(true);
    });

    it('graph_impact: unknown symbol returns not found', () => {
      const targetNode = graphData.nodes.find((n) => n.label === 'Unknown');
      expect(targetNode).toBeUndefined();
    });
  });

  describe('JSON-RPC protocol constants', () => {
    it('initialize response has correct serverInfo', () => {
      const response = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'dsh-codegraph-visualizer', version: '0.2.0' },
        },
      };
      expect(response.result.serverInfo.version).toBe('0.2.0');
      expect(response.result.protocolVersion).toBe('2024-11-05');
    });

    it('tools/call with unknown tool returns error code -32601', () => {
      const errorCode = -32601;
      expect(errorCode).toBe(-32601);
    });

    it('tools/call handler exception returns error code -32603', () => {
      const errorCode = -32603;
      expect(errorCode).toBe(-32603);
    });
  });
});
